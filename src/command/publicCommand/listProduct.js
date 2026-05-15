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
    renderVariantCard
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
        lines.push(renderWelcomeHeader(ctx.from, companyName, greeting));
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
            const productIndex = i + 1;
            for (const v of variants) {
                const sold = soldMap.get(v.code) || 0;
                lines.push(renderVariantCard({
                    productIndex,
                    productName: product.name,
                    variant: v,
                    soldCount: sold
                }));
                lines.push('');
            }
        });

        lines.push('_Ketik nomor produk (mis. `1`) untuk lihat semua varian._');
        lines.push('_Atau pakai pintasan langsung:_ `buy <kode> <jumlah>` _/_ `buynow <kode> <jumlah>`');

        screenState.setScreen(jid, 'PRODUCT_LIST', {});

        await sendWithBanner(ctx, lines.join('\n'), banner, { mentions: [ctx.jid] });

    } catch (err) {
        console.log(err);
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Something error in file command/listProduct.js  ${err.message}`));
    }
};

module.exports = listProduct;
