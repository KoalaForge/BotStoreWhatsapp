const clc = require('cli-color');
const moment = require('moment-timezone');
const productRepository = require('../../repositories/ProductRepository');
const orderTransactionItemRepository = require('../../repositories/OrderTransactionItemRepository');
const botUserRepository = require('../../repositories/BotUserRepository');
const botUserBalanceRepository = require('../../repositories/BotUserBalanceRepository');
const settingsService = require('../../services/settingsService');
const { formatMoney } = require('../../database/models/money');
const screenState = require('../../state/screenState');
const { resolveBanner, sendWithBanner } = require('../../utils/bannerResolver');
const { buildCSInline } = require('./cs');
const { buildVariantItems } = require('../../utils/variantDisplayHelper');
const { buildGreeting } = require('../../utils/greetingHelper');
const { getCompanyName } = require('../../utils/getCompanyName');
const {
    renderWelcomeHeader,
    renderPanduanBlock,
    renderPintasanBlock,
    renderVariantCard,
    chunkMessage,
    MAX_WA_TEXT,
    MAX_WA_CAPTION
} = require('../../utils/menuFormatter');

const listProduct = async (ctx) => {
    try {
        const jid = ctx.from;
        const displayName = ctx.fromUser?.first_name || jid;
        const ownerId = ctx.repositoryContext?.ownerId;

        const [setting, userBalance, allProducts, soldMap] = await Promise.all([
            settingsService.getSettings(ctx),
            botUserBalanceRepository.findByUserId(ctx, jid),
            productRepository.findActiveProducts(ctx, { sort: { name: 1 } }),
            orderTransactionItemRepository.batchSoldCount(ctx)
        ]);

        botUserRepository.upsertWhatsappUser(ctx, jid, displayName).catch(() => {});

        if (!userBalance) {
            await botUserBalanceRepository.create(ctx, {
                userId: jid,
                balance: 0,
                totalTopUp: 0,
                totalSpent: 0
            }).catch(() => {});
        }

        const balance = userBalance?.balance || 0;

        if (allProducts.length === 0) {
            await ctx.reply('*Belum ada produk tersedia*');
            return;
        }

        const [companyName, variantsByProduct] = await Promise.all([
            getCompanyName(setting, ctx.state?.botId),
            Promise.all(allProducts.map(p => buildVariantItems(ctx, p, ownerId)))
        ]);

        const greeting = buildGreeting();
        const banner = resolveBanner(setting);
        const csLine = buildCSInline(setting?.csLinks);

        const lines = [];
        lines.push(renderWelcomeHeader(displayName, companyName, greeting));
        lines.push('');
        lines.push(renderPanduanBlock());
        lines.push('');
        lines.push(`💎 *Saldo* : ${formatMoney(balance)}`);
        if (csLine) {
            const csContent = csLine.replace(/^\*CS:\*\s*/, '');
            lines.push(`🛟 *CS*    : ${csContent}`);
        }
        lines.push('');
        lines.push(renderPintasanBlock());
        lines.push('');

        allProducts.forEach((product, i) => {
            const variants = variantsByProduct[i] || [];
            if (variants.length === 0) return;
            for (const v of variants) {
                const sold = soldMap.get(v.code) || 0;
                lines.push(renderVariantCard({
                    productName: product.name,
                    variant: v,
                    soldCount: sold
                }));
                lines.push('');
            }
        });

        lines.push('_Ketik nomor produk untuk lihat varian lengkap._');

        screenState.setScreen(jid, 'PRODUCT_LIST', {});

        const fullText = lines.join('\n');
        const firstMax = banner ? MAX_WA_CAPTION : MAX_WA_TEXT;
        const chunks = chunkMessage(fullText, firstMax, MAX_WA_TEXT);
        for (let i = 0; i < chunks.length; i++) {
            if (i === 0) {
                await sendWithBanner(ctx, chunks[i], banner);
            } else {
                await ctx.reply(chunks[i]);
            }
        }

    } catch (err) {
        console.log(err);
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Something error in file command/listProduct.js  ${err.message}`));
    }
};

module.exports = listProduct;
