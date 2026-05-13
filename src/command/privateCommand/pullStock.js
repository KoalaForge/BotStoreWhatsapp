const productVariantRepository = require('../../repositories/ProductVariantRepository');
const stockRepository = require('../../repositories/StockRepository');
const cycleService = require('../../services/cycleService');
const productVariantSnkRepository = require('../../repositories/ProductVariantSnkRepository');
const productRepository = require('../../repositories/ProductRepository');
const botUserRepository = require('../../repositories/BotUserRepository');
const resellerService = require('../../services/resellerService');
const ownerBalanceService = require('../../services/ownerBalanceService');
const orderTransactionItemService = require('../../services/orderTransactionItemService');
const orderService = require('../../services/orderService');
const modeService = require('../../services/modeService');
const moment = require('moment-timezone');
const clc = require('cli-color');
const { requireAdmin } = require('../../middleware/waAuth');
const transactionService = require('../../services/transactionService');
const waProductDeliveryService = require('../../services/waProductDeliveryService');
const { formatMoney } = require('../../database/models/money');
const { sanitizeErrorMessage } = require('../../utils/errorSanitizer');

function generateRandomCode() {
    const prefix = 'INV';
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const datePart = `${year}${month}${day}`;
    const randomNumber = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}${datePart}${randomNumber}`;
}

/**
 * Handle pullstock for reseller products (platform stock + owner balance deduction)
 */
async function pullStockReseller(ctx, codeVariant, quantity) {
    const ownerId = ctx.repositoryContext?.ownerId;

    const result = await resellerService.resolveVariantFromCallback(ctx, codeVariant);
    if (!result) {
        return ctx.reply(`Produk variant dengan kode *${codeVariant}* tidak ada.`);
    }

    const { platformVariant, config, resellerProduct } = result;
    const costPrice = await ctx.pricingService.calculatePrice(platformVariant, ownerId); // Admin pullStock: base price only, tier_pricing tidak apply (policy)
    const sellPrice = resellerService.calculateMarkup(costPrice, config.markup_type, config.markup_value);
    const markupPerUnit = sellPrice - costPrice;
    const totalCost = costPrice * quantity;
    const totalSellPrice = sellPrice * quantity;
    const totalProfit = markupPerUnit * quantity;
    const currentBalance = await ownerBalanceService.getAvailableBalance(ownerId);

    if (currentBalance < totalCost) {
        const kekurangan = totalCost - currentBalance;
        return ctx.reply(
            `*Saldo platform tidak cukup untuk pullstock*\n\n` +
            `Modal per item: ${formatMoney(costPrice)}\n` +
            `Jumlah: ${quantity}\n` +
            `Total modal: ${formatMoney(totalCost)}\n` +
            `Saldo saat ini: ${formatMoney(currentBalance)}\n` +
            `Kekurangan: ${formatMoney(kekurangan)}\n\n` +
            `Gunakan .topupplatform untuk menambah saldo.`
        );
    }

    const platformStockCount = await stockRepository.countPlatformStock(codeVariant);
    if (platformStockCount === 0) {
        return ctx.reply(`Produk variant dengan kode *${codeVariant}* tidak ada stok tersisa.`);
    }
    if (quantity > platformStockCount) {
        return ctx.reply(`Produk variant dengan kode *${codeVariant}* hanya tersisa ${platformStockCount}x`);
    }

    const stockResult = await orderService.processStockForPlatform(codeVariant, quantity, {
        productCode: resellerProduct.code,
        productName: resellerProduct.name,
        variantName: config.custom_name || platformVariant.name
    });

    const displayVariantName = config.custom_name || platformVariant.name;
    const formattedDate = moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
    const userJID = ctx.chat;
    const userId = ctx.from;
    const uniqCode = generateRandomCode();
    const paidAt = new Date();

    const platformRecord = await transactionService.createPlatformRecord({
        transactionId: uniqCode,
        user_id: ctx.repositoryContext?.ownerId,
        transaction_type: 'product',
        payment_method_code: 'manual',
        orderChannel: 'whatsapp',
        productCode: codeVariant,
        formattedDate: formattedDate,
        payment_fee: 0,
        orderQuantity: quantity,
        totalPrice: totalCost,
        chatId: userJID,
        messageId: null,
        is_reseller_order: true,
        balance_deducted: true,
        payment_status: 'paid'
    }, {
        items: [{
            codeVariant: codeVariant,
            quantity: quantity,
            unitPrice: costPrice,
            stockItems: stockResult.stockItems,
            productInfo: {
                productCode: resellerProduct.code,
                productName: resellerProduct.name,
                variantName: displayVariantName
            }
        }]
    });

    const platformTxId = platformRecord?.transactionId || uniqCode;

    let balanceDescription;
    try {
        const { formatBalanceHistoryDescription } = require('../../actions/confirmPayBalance');
        balanceDescription = formatBalanceHistoryDescription(
            'Pullstock', resellerProduct.name, displayVariantName, quantity, platformTxId, uniqCode
        );
    } catch (_e) {
        balanceDescription = `Pullstock ${resellerProduct.name} - ${displayVariantName} x${quantity}`;
    }

    const deductResult = await ownerBalanceService.deductForPurchase(ownerId, totalCost, {
        transactionId: uniqCode,
        description: balanceDescription
    });

    const settlementFields = modeService.isMultiMode() ? {
        paid_at: paidAt,
        is_settled: true,
        settled_at: paidAt
    } : {};

    await transactionService.createTransaction(ctx, {
        transactionId: uniqCode,
        user_id: userId,
        productCode: codeVariant,
        orderQuantity: quantity,
        formattedDate: formattedDate,
        payment_fee: 0,
        totalPrice: totalSellPrice,
        chatId: userJID,
        messageId: null,
        isSuccess: true,
        isDelivered: true,
        profit: parseInt(totalProfit),
        transaction_type: 'product',
        payment_method_code: 'manual',
        orderChannel: 'whatsapp',
        is_reseller_order: true,
        balance_deducted: true,
        ...settlementFields
    });

    if (platformRecord) {
        await transactionService.updatePlatformReference(ctx, uniqCode, platformRecord.transactionId);
        await cycleService.setCycleEligibilityForPlatformItems(platformRecord._id, paidAt);
    }

    await orderTransactionItemService.createTransactionItems(ctx, uniqCode, [{
        codeVariant: codeVariant,
        quantity: quantity,
        unitPrice: sellPrice,
        costPrice: costPrice,
        stockItems: stockResult.stockItems,
        productInfo: {
            productCode: resellerProduct.code,
            productName: resellerProduct.name,
            variantName: displayVariantName
        }
    }]);

    const ProductVariantSnkModel = require('../../database/models/productVariantSnkModels');
    const getVariantProductSnk = await ProductVariantSnkModel.findOne({ codeVariant: codeVariant, ownerId: null });

    const userData = await botUserRepository.findByWhatsappId(ctx, userId);
    const buyerName = userData?.usernameTelegram || userId;

    await waProductDeliveryService.deliverProductToCustomer(ctx.sock, userJID, ctx, {
        transactionId: uniqCode,
        productName: resellerProduct.name,
        variantName: displayVariantName,
        orderQuantity: quantity,
        totalPrice: totalSellPrice,
        paymentDate: formattedDate,
        orderData: stockResult.dataStock,
        snkContent: getVariantProductSnk?.content || null,
        snkTermsAndConditions: getVariantProductSnk?.termsAndConditions || null,
        snkWarrantyTerms: getVariantProductSnk?.warrantyTerms || null,
        buyer: buyerName,
        variantPrice: sellPrice,
        payment_method_code: 'manual',
        resellerInfo: {
            markupPerUnit: markupPerUnit,
            totalProfit: totalProfit,
            costPerUnit: costPrice,
            totalCost: totalCost,
            remainingBalance: deductResult.newBalance
        }
    });

    console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Reseller pullstock berhasil: ${uniqCode}, saldo sisa: ${deductResult.newBalance}`));
}

/**
 * Pull stock from a product variant (WhatsApp version).
 * Usage: .pullstock <codeVariant> [quantity]
 */
const pullStock = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const args = ctx.commandArgs || [];
        const codeVariant = args[0];
        let quantity = args[1] ? parseInt(args[1]) : 1;

        if (!codeVariant) {
            return ctx.reply(
                '*Format salah!*\n\n' +
                '*Penggunaan:*\n' +
                '`.pullstock <codeVariant> [jumlah]`\n\n' +
                '*Contoh:*\n' +
                '`.pullstock CANVA-1B`\n' +
                '`.pullstock CANVA-1B 3`'
            );
        }

        const getVariantProduct = await productVariantRepository.findByCodeVariant(ctx, codeVariant);

        if (!getVariantProduct) {
            return pullStockReseller(ctx, codeVariant, quantity);
        }

        const ownerId = ctx.repositoryContext?.ownerId;
        const price = await ctx.pricingService.calculatePrice(getVariantProduct, ownerId); // Admin pullStock: base price only, tier_pricing tidak apply (policy)
        const totalPayment = price * quantity;
        const getStock = await stockRepository.find(ctx, { codeVariant: codeVariant });
        const uniqCode = generateRandomCode();
        const userJID = ctx.chat;
        const userId = ctx.from;
        const getVariantProductSnk = await productVariantSnkRepository.findByCodeVariant(ctx, getVariantProduct.codeVariant);

        const totalStockAvailable = await stockRepository.count(ctx, { codeVariant: codeVariant });
        const getProduct = await productRepository.findByCode(ctx, getVariantProduct.code);
        const userData = await botUserRepository.findByWhatsappId(ctx, userId);
        const buyerName = userData?.usernameTelegram || userId;

        if (totalStockAvailable === 0) {
            return ctx.reply(`Produk variant dengan kode *${codeVariant}* tidak ada stok tersisa.`);
        }

        if (quantity > totalStockAvailable) {
            return ctx.reply(`Produk variant dengan kode *${codeVariant}* hanya tersisa ${totalStockAvailable}x`);
        }

        let dataStock = '';
        let totalStock = 0;
        let profit = 0;
        const stockItems = [];
        for (const stock of getStock) {
            if (totalStock >= quantity) break;

            dataStock += `${stock.dataStock}\n`;
            profit += stock.profit;
            stockItems.push(stock);

            await stockRepository.deleteOne(ctx, { dataStock: stock.dataStock });
            totalStock++;
        }

        const formattedDate = moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');

        await transactionService.createTransaction(ctx, {
            transactionId: uniqCode,
            user_id: userId,
            productCode: codeVariant,
            orderQuantity: quantity,
            formattedDate: formattedDate,
            payment_fee: 0,
            totalPrice: totalPayment,
            orderData: dataStock,
            chatId: userJID,
            messageId: null,
            isSuccess: true,
            isDelivered: true,
            profit: parseInt(profit),
            transaction_type: 'product',
            payment_method_code: 'manual',
            orderChannel: 'whatsapp'
        });

        await orderTransactionItemService.createTransactionItems(ctx, uniqCode, [{
            codeVariant: codeVariant,
            quantity: parseInt(quantity),
            unitPrice: price,
            costPrice: null,
            stockItems: stockItems,
            productInfo: {
                productCode: getVariantProduct.code,
                productName: getProduct.name,
                variantName: getVariantProduct.name
            }
        }]);

        await cycleService.setCycleEligibilityByTransactionId(ctx, uniqCode, new Date());

        await waProductDeliveryService.deliverProductToCustomer(ctx.sock, userJID, ctx, {
            transactionId: uniqCode,
            productName: getProduct.name,
            variantName: getVariantProduct?.name,
            orderQuantity: quantity,
            totalPrice: totalPayment,
            paymentDate: formattedDate,
            orderData: dataStock,
            snkContent: getVariantProductSnk?.content || null,
            snkTermsAndConditions: getVariantProductSnk?.termsAndConditions || null,
            snkWarrantyTerms: getVariantProductSnk?.warrantyTerms || null,
            buyer: buyerName,
            variantPrice: price,
            payment_method_code: 'manual'
        });

        console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Berhasil mengirim data produk ke ${userJID} (${uniqCode})`));

    } catch (err) {
        console.error(`[ ERROR ] [${moment().format('YYYY-MM-DD HH:mm:ss')}]:`, {
            userId: ctx.from,
            error: err.message,
            stack: err.stack,
        });
        await ctx.reply(`*Terjadi kesalahan, silakan coba lagi.*\n\n_${sanitizeErrorMessage(err)}_`);
    }
};

module.exports = pullStock;
