'use strict';

const orderTransactionItemRepository = require('../../repositories/OrderTransactionItemRepository');
const transactionRepository = require('../../repositories/TransactionRepository');
const botUserRepository = require('../../repositories/BotUserRepository');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const productRepository = require('../../repositories/ProductRepository');
const modeService = require('../../services/modeService');
const moment = require('moment-timezone');
const { requireAdmin } = require('../../middleware/waAuth');
const { formatMoney } = require('../../database/models/money');
const clc = require('cli-color');

const TZ = 'Asia/Jakarta';
const MAX_MSG_LEN = 4000;
const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
const DATE_RANGE_RE = /^\d{2}\/\d{2}\/\d{4}-\d{2}\/\d{2}\/\d{4}$/;

function parseArgs(argStr) {
    const parts = argStr.trim().split(/\s+/).filter(Boolean);
    let productCode = null;
    let variantCode = null;
    let startDate = null;
    let endDate = null;
    const nonDateParts = [];

    for (const part of parts) {
        if (DATE_RANGE_RE.test(part)) {
            const d1 = part.slice(0, 10);
            const d2 = part.slice(11);
            startDate = moment.tz(d1, 'DD/MM/YYYY', TZ).startOf('day').toDate();
            endDate = moment.tz(d2, 'DD/MM/YYYY', TZ).endOf('day').toDate();
        } else if (DATE_RE.test(part)) {
            startDate = moment.tz(part, 'DD/MM/YYYY', TZ).startOf('day').toDate();
            endDate = moment.tz(part, 'DD/MM/YYYY', TZ).endOf('day').toDate();
        } else if (part !== '*') {
            nonDateParts.push(part);
        }
    }

    if (nonDateParts.length >= 1) productCode = nonDateParts[0].toUpperCase();
    if (nonDateParts.length >= 2) variantCode = nonDateParts[1];

    if (!startDate) {
        startDate = moment().tz(TZ).startOf('day').toDate();
        endDate = moment().tz(TZ).endOf('day').toDate();
    }

    return { productCode, variantCode, startDate, endDate };
}

function buildItemsBasePipeline(productCode, variantCode, startDate, endDate, excludeReseller = false) {
    const txMatch = {
        'transaction.isSuccess': true,
        'transaction.isCanceled': false,
        $or: [
            { 'transaction.transaction_type': 'product' },
            { 'transaction.transaction_type': { $exists: false } }
        ]
    };
    if (excludeReseller) txMatch['transaction.is_reseller_order'] = { $ne: true };

    const stages = [
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        {
            $lookup: {
                from: 'order_transactions',
                let: { txObjId: { $toObjectId: '$order_transaction_id' } },
                pipeline: [
                    { $match: { $expr: { $eq: ['$_id', '$$txObjId'] } } },
                    { $project: { isSuccess: 1, isCanceled: 1, transaction_type: 1, user_id: 1, is_reseller_order: 1 } }
                ],
                as: 'transaction'
            }
        },
        { $unwind: '$transaction' },
        { $match: txMatch }
    ];

    if (productCode && !variantCode) {
        stages.push({ $match: { $or: [
            { product_code: new RegExp(`^${productCode}$`, 'i') },
            { codeVariant: new RegExp(`^${productCode}$`, 'i') }
        ] } });
    } else if (productCode) {
        stages.push({ $match: { product_code: new RegExp(`^${productCode}$`, 'i') } });
    }
    if (variantCode) {
        stages.push({ $match: { codeVariant: new RegExp(`^${variantCode}$`, 'i') } });
    }

    return stages;
}

function buildTransactionLogPipeline(productCode, variantCode, startDate, endDate, excludeReseller = false) {
    const txMatch = {
        'tx.isSuccess': true,
        'tx.isCanceled': false,
        $or: [
            { 'tx.transaction_type': 'product' },
            { 'tx.transaction_type': { $exists: false } }
        ]
    };
    if (excludeReseller) txMatch['tx.is_reseller_order'] = { $ne: true };

    const stages = [
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        {
            $lookup: {
                from: 'order_transactions',
                let: { txObjId: { $toObjectId: '$order_transaction_id' } },
                pipeline: [
                    { $match: { $expr: { $eq: ['$_id', '$$txObjId'] } } },
                    { $project: { isSuccess: 1, isCanceled: 1, transaction_type: 1, user_id: 1, payment_method_code: 1, createdAt: 1, transactionId: 1, is_reseller_order: 1 } }
                ],
                as: 'tx'
            }
        },
        { $unwind: '$tx' },
        { $match: txMatch }
    ];

    if (productCode && !variantCode) {
        stages.push({ $match: { $or: [
            { product_code: new RegExp(`^${productCode}$`, 'i') },
            { codeVariant: new RegExp(`^${productCode}$`, 'i') }
        ] } });
    } else if (productCode) {
        stages.push({ $match: { product_code: new RegExp(`^${productCode}$`, 'i') } });
    }
    if (variantCode) {
        stages.push({ $match: { codeVariant: new RegExp(`^${variantCode}$`, 'i') } });
    }

    stages.push({ $sort: { 'tx.createdAt': 1, createdAt: 1 } });
    return stages;
}

function buildTxBase(startDate, endDate, excludeReseller = false) {
    const match = {
        isSuccess: true,
        isCanceled: false,
        createdAt: { $gte: startDate, $lte: endDate },
        $or: [
            { transaction_type: 'product' },
            { transaction_type: { $exists: false } }
        ]
    };
    if (excludeReseller) match.is_reseller_order = { $ne: true };

    return [
        { $match: match },
        {
            $lookup: {
                from: 'order_transaction_items',
                let: { txId: { $toString: '$_id' } },
                pipeline: [
                    { $match: { $expr: { $eq: ['$order_transaction_id', '$$txId'] } } },
                    { $limit: 1 },
                    { $project: { _id: 1 } }
                ],
                as: '_itemCheck'
            }
        },
        { $match: { '_itemCheck': { $size: 0 } } },
        { $addFields: { _normCode: { $toUpper: { $ifNull: ['$productCode', 'UNKNOWN'] } } } }
    ];
}

async function queryTxFallbackLevel1(ctx, productCode, startDate, endDate, excludeReseller = false) {
    const pipeline = [...buildTxBase(startDate, endDate, excludeReseller)];

    if (productCode) {
        const variants = await productVariantRepository.find(ctx, { code: new RegExp(`^${productCode}$`, 'i') }).catch(() => []);
        const codes = [...new Set([productCode.toUpperCase(), ...variants.map(v => v.codeVariant.toUpperCase())])];
        pipeline.push({ $match: { _normCode: { $in: codes } } });
    }

    pipeline.push({
        $group: {
            _id: { _normCode: '$_normCode' },
            totalQuantity: { $sum: { $ifNull: ['$orderQuantity', 0] } },
            totalRevenue: { $sum: { $ifNull: ['$totalPrice', 0] } },
            totalProfit: { $sum: { $ifNull: ['$profit', 0] } },
            transactionCount: { $sum: 1 }
        }
    });

    const rawRows = await transactionRepository.aggregate(ctx, pipeline);

    return Promise.all(rawRows.map(async (row) => {
        const normCode = row._id._normCode;
        try {
            const variant = await productVariantRepository.findByCodeVariant(ctx, normCode);
            if (variant) {
                const product = await productRepository.findByCode(ctx, variant.code);
                return {
                    _id: {
                        product_code: variant.code,
                        product_name: product?.name || variant.code,
                        codeVariant: variant.codeVariant,
                        variant_name: variant.name
                    },
                    totalQuantity: row.totalQuantity,
                    totalRevenue: row.totalRevenue,
                    totalProfit: row.totalProfit,
                    transactionCount: row.transactionCount
                };
            }
        } catch { /* ignore */ }

        return {
            _id: {
                product_code: normCode,
                product_name: normCode,
                codeVariant: null,
                variant_name: null
            },
            totalQuantity: row.totalQuantity,
            totalRevenue: row.totalRevenue,
            totalProfit: row.totalProfit,
            transactionCount: row.transactionCount
        };
    }));
}

function buildTxLogFallback(productCode, variantCode, startDate, endDate, extraCodes = [], excludeReseller = false) {
    const stages = [...buildTxBase(startDate, endDate, excludeReseller)];

    if (variantCode) {
        stages.push({ $match: { _normCode: variantCode.toUpperCase() } });
    } else if (productCode) {
        const codes = [...new Set([productCode.toUpperCase(), ...extraCodes])];
        stages.push({ $match: { _normCode: { $in: codes } } });
    }

    stages.push({ $sort: { createdAt: 1 } });
    return stages;
}

async function queryLevel1(ctx, productCode, startDate, endDate, excludeReseller = false) {
    const itemsPipeline = [
        ...buildItemsBasePipeline(productCode, null, startDate, endDate, excludeReseller),
        {
            $group: {
                _id: {
                    product_code: '$product_code',
                    product_name: '$product_name',
                    codeVariant: '$codeVariant',
                    variant_name: '$variant_name'
                },
                totalQuantity: { $sum: '$quantity' },
                totalRevenue: { $sum: '$subtotal' },
                totalProfit: {
                    $sum: {
                        $reduce: {
                            input: '$data',
                            initialValue: 0,
                            in: { $add: ['$$value', { $ifNull: ['$$this.profit', 0] }] }
                        }
                    }
                },
                transactionCount: { $sum: 1 }
            }
        },
        { $sort: { '_id.product_code': 1, '_id.variant_name': 1 } }
    ];

    const [itemsRows, txRows] = await Promise.all([
        orderTransactionItemRepository.aggregate(ctx, itemsPipeline),
        queryTxFallbackLevel1(ctx, productCode, startDate, endDate, excludeReseller)
    ]);

    const map = new Map();
    for (const row of itemsRows) {
        const k = `${row._id.product_code}||${row._id.codeVariant || '__tx'}`;
        map.set(k, row);
    }
    for (const row of txRows) {
        const k = `${row._id.product_code}||${row._id.codeVariant || '__tx'}`;
        if (map.has(k)) {
            const e = map.get(k);
            e.totalQuantity += row.totalQuantity;
            e.totalRevenue += row.totalRevenue;
            e.totalProfit += row.totalProfit;
            e.transactionCount += row.transactionCount;
        } else {
            map.set(k, row);
        }
    }
    return Array.from(map.values());
}

async function queryTransactionLog(ctx, productCode, variantCode, startDate, endDate, excludeReseller = false) {
    const [itemsRows, variantsForProduct] = await Promise.all([
        orderTransactionItemRepository.aggregate(ctx, buildTransactionLogPipeline(productCode, variantCode, startDate, endDate, excludeReseller)),
        (productCode && !variantCode)
            ? productVariantRepository.find(ctx, { code: new RegExp(`^${productCode}$`, 'i') }).catch(() => [])
            : Promise.resolve([])
    ]);

    const extraCodes = variantsForProduct.map(v => v.codeVariant.toUpperCase());
    const txFallbackRows = await transactionRepository.aggregate(ctx, buildTxLogFallback(productCode, variantCode, startDate, endDate, extraCodes, excludeReseller));

    const uniqueFallbackCodes = [...new Set(txFallbackRows.map(r => r._normCode))];
    const variantInfoMap = {};
    await Promise.all(uniqueFallbackCodes.map(async (code) => {
        try {
            const variant = await productVariantRepository.findByCodeVariant(ctx, code);
            if (variant) {
                const product = await productRepository.findByCode(ctx, variant.code);
                variantInfoMap[code] = {
                    productCode: variant.code,
                    productName: product?.name || variant.code,
                    variantCode: variant.codeVariant,
                    variantName: variant.name
                };
            }
        } catch { /* ignore */ }
    }));

    const byTx = new Map();
    for (const row of itemsRows) {
        const txId = row.order_transaction_id;
        if (!byTx.has(txId)) {
            byTx.set(txId, {
                source: 'items',
                transactionId: txId,
                txCode: row.tx?.transactionId || txId,
                userId: row.tx?.user_id,
                paymentMethod: row.tx?.payment_method_code || 'manual',
                createdAt: row.tx?.createdAt || row.createdAt,
                itemLines: []
            });
        }
        byTx.get(txId).itemLines.push({
            productCode: row.product_code,
            productName: row.product_name,
            variantCode: row.codeVariant,
            variantName: row.variant_name,
            quantity: row.quantity,
            subtotal: row.subtotal,
            dataList: (row.data || []).map(d => d.dataStock).filter(Boolean)
        });
    }

    const allRows = [
        ...Array.from(byTx.values()),
        ...txFallbackRows.map(r => {
            const info = variantInfoMap[r._normCode];
            return {
                source: 'tx_fallback',
                transactionId: String(r._id),
                txCode: r.transactionId || String(r._id),
                userId: r.user_id,
                paymentMethod: r.payment_method_code || 'manual',
                createdAt: r.createdAt,
                itemLines: [{
                    productCode: info?.productCode || r._normCode,
                    productName: info?.productName || r._normCode,
                    variantCode: info?.variantCode || null,
                    variantName: info?.variantName || null,
                    quantity: r.orderQuantity || 0,
                    subtotal: r.totalPrice || 0,
                    dataList: r.orderData
                        ? r.orderData.trim().split('\n').filter(Boolean)
                        : []
                }]
            };
        })
    ];

    allRows.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const userIds = [...new Set(allRows.map(r => r.userId).filter(Boolean))];
    const userMap = {};
    await Promise.all(userIds.map(async (uid) => {
        try {
            const user = await botUserRepository.findByTelegramId(ctx, uid);
            userMap[uid] = user?.usernameTelegram || user?.userId || null;
        } catch {
            userMap[uid] = null;
        }
    }));

    return { allRows, userMap };
}

function formatDateLabel(startDate, endDate) {
    const s = moment(startDate).tz(TZ);
    const e = moment(endDate).tz(TZ);
    return s.isSame(e, 'day')
        ? s.locale('id').format('dddd, DD MMMM YYYY')
        : `${s.format('DD/MM/YYYY')} — ${e.format('DD/MM/YYYY')}`;
}

function splitMessages(text) {
    if (text.length <= MAX_MSG_LEN) return [text];
    const parts = [];
    const lines = text.split('\n');
    let current = '';
    for (const line of lines) {
        const next = current ? current + '\n' + line : line;
        if (next.length > MAX_MSG_LEN) {
            if (current) parts.push(current);
            current = line;
        } else {
            current = next;
        }
    }
    if (current) parts.push(current);
    return parts;
}

function formatPaymentLabel(method) {
    if (!method) return 'Manual';
    const m = method.toLowerCase();
    if (m === 'balance' || m === 'saldo') return 'Saldo';
    if (m === 'manual') return 'Manual';
    if (m.includes('qris')) return 'QRIS';
    return method;
}

function formatLevel1(rows, startDate, endDate) {
    if (!rows.length) {
        return ['*Tidak ada data penjualan* pada periode tersebut.'];
    }

    const dateLabel = formatDateLabel(startDate, endDate);

    const byProduct = new Map();
    for (const row of rows) {
        const pc = row._id.product_code;
        if (!byProduct.has(pc)) {
            byProduct.set(pc, {
                productName: row._id.product_name,
                variants: [],
                totalQty: 0, totalRevenue: 0, totalProfit: 0, totalTrx: 0
            });
        }
        const p = byProduct.get(pc);
        p.variants.push(row);
        p.totalQty += row.totalQuantity;
        p.totalRevenue += row.totalRevenue;
        p.totalProfit += row.totalProfit;
        p.totalTrx += row.transactionCount;
    }

    const messages = [];
    let grandQty = 0, grandRevenue = 0, grandProfit = 0, grandTrx = 0;

    for (const [pc, p] of byProduct) {
        let text = `*REKAP PENJUALAN*\n${dateLabel}\n\n`;
        text += `*${p.productName} (${pc})*\n\n`;

        for (const v of p.variants) {
            text += `*${v._id.variant_name || v._id.codeVariant || 'Langsung'}*\n`;
            text += `- ${v.transactionCount} trx | ${v.totalQuantity} item\n`;
            text += `- Pendapatan: ${formatMoney(v.totalRevenue)}\n`;
            if (v.totalProfit > 0) text += `- Profit: ${formatMoney(v.totalProfit)}\n`;
            text += '\n';
        }

        text += `Subtotal: ${p.totalTrx} trx | ${p.totalQty} item\n`;
        text += `Pendapatan: *${formatMoney(p.totalRevenue)}*`;
        if (p.totalProfit > 0) text += ` | Profit: *${formatMoney(p.totalProfit)}*`;

        messages.push(...splitMessages(text));

        grandQty += p.totalQty;
        grandRevenue += p.totalRevenue;
        grandProfit += p.totalProfit;
        grandTrx += p.totalTrx;
    }

    if (byProduct.size > 1) {
        let summary = `\n*TOTAL KESELURUHAN*\n`;
        summary += `- ${grandTrx} transaksi | ${grandQty} item terjual\n`;
        summary += `- Pendapatan: *${formatMoney(grandRevenue)}*\n`;
        if (grandProfit > 0) summary += `- Profit: *${formatMoney(grandProfit)}*\n`;
        summary += `\n${moment().tz(TZ).format('DD/MM/YYYY HH:mm')} WIB`;
        messages.push(summary);
    } else if (messages.length > 0) {
        messages[messages.length - 1] += `\n\n${moment().tz(TZ).format('DD/MM/YYYY HH:mm')} WIB`;
    }

    return messages;
}

function formatTransactionLog({ allRows, userMap }, productCode, variantCode, startDate, endDate) {
    if (!allRows.length) {
        const target = variantCode ? variantCode : productCode;
        return [`*Tidak ada transaksi* untuk ${target} pada periode tersebut.`];
    }

    const dateLabel = formatDateLabel(startDate, endDate);
    const title = variantCode
        ? `*LOG TRANSAKSI*\n*${productCode} — ${variantCode}*`
        : `*LOG TRANSAKSI*\n*${productCode}*`;

    const byDate = new Map();
    for (const row of allRows) {
        const dateStr = moment(row.createdAt).tz(TZ).format('YYYY-MM-DD');
        if (!byDate.has(dateStr)) byDate.set(dateStr, []);
        byDate.get(dateStr).push(row);
    }

    const messages = [];
    let seq = 0;
    let grandTrx = 0, grandQty = 0, grandRevenue = 0;
    const uniqueBuyers = new Set();
    let currentText = `${title}\n${dateLabel}\n`;

    const flush = (next) => {
        if ((currentText + next).length > MAX_MSG_LEN) {
            if (currentText.trim()) messages.push(currentText);
            currentText = next;
        } else {
            currentText += next;
        }
    };

    for (const [dateStr, txRows] of byDate) {
        const dayLabel = moment(dateStr).tz(TZ).locale('id').format('dddd, DD MMM YYYY');
        flush(`\n\n*${dayLabel}*`);

        for (const tx of txRows) {
            seq++;
            grandTrx++;
            const time = moment(tx.createdAt).tz(TZ).format('HH:mm');
            const uid = tx.userId;
            const username = uid ? userMap[uid] : null;
            const buyerLabel = username ? `@${username}` : (uid ? String(uid) : 'Admin');
            if (uid) uniqueBuyers.add(String(uid));

            const payLabel = formatPaymentLabel(tx.paymentMethod);

            let txBlock = `\n\n*[${seq}]* ${time} WIB\n`;
            txBlock += `${buyerLabel} | ${payLabel}\n`;

            for (const item of tx.itemLines) {
                grandQty += item.quantity || 0;
                grandRevenue += item.subtotal || 0;

                if (variantCode) {
                    txBlock += `${item.quantity}x ${item.productName || item.productCode} | ${formatMoney(item.subtotal)}\n`;
                } else {
                    const variantLabel = item.variantName || item.variantCode || '—';
                    txBlock += `${item.quantity}x ${item.productName || item.productCode} — ${variantLabel} | ${formatMoney(item.subtotal)}\n`;
                }

                if (item.dataList.length > 0) {
                    txBlock += item.dataList.map(d => `   ${d}`).join('\n') + '\n';
                }
            }

            if (tx.txCode) txBlock += `${tx.txCode}\n`;

            flush(txBlock);
        }
    }

    const summaryText =
        `\n\n` +
        `*${grandTrx} transaksi | ${grandQty} item terjual*\n` +
        `${uniqueBuyers.size} pembeli unik\n` +
        `Pendapatan: *${formatMoney(grandRevenue)}*\n` +
        `${moment().tz(TZ).format('DD/MM/YYYY HH:mm')} WIB`;

    flush(summaryText);
    if (currentText.trim()) messages.push(currentText);

    return messages;
}

const recapProduct = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    try {
        const argStr = ctx.commandText || '';
        const { productCode, variantCode, startDate, endDate } = parseArgs(argStr);
        const excludeReseller = modeService.isSingleMode();

        let messages;

        if (productCode) {
            const result = await queryTransactionLog(ctx, productCode, variantCode, startDate, endDate, excludeReseller);
            messages = formatTransactionLog(result, productCode, variantCode, startDate, endDate);
        } else {
            const rows = await queryLevel1(ctx, null, startDate, endDate, excludeReseller);
            messages = formatLevel1(rows, startDate, endDate);
        }

        for (const msg of messages) {
            await ctx.reply(msg);
        }
    } catch (err) {
        console.log(err);
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(
            clc.red.bold('[ ERROR ]') +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.redBright(`Error in recapProduct: ${err.message}`)
        );
    }
};

module.exports = recapProduct;
