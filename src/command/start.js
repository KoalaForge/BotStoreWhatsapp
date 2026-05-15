const clc = require('cli-color');
const moment = require('moment-timezone');
const {
    sumUserTransactionAmount,
    countSoldStocks,
    sumUsersTransactionAmount
} = require('../utils/countUserOrders');
const botUserRepository = require('../repositories/BotUserRepository');
const botUserBalanceRepository = require('../repositories/BotUserBalanceRepository');
const settingsService = require('../services/settingsService');
const { formatMoney } = require('../database/models/money');
const modeService = require('../services/modeService');
const productRepository = require('../repositories/ProductRepository');
const listProduct = require('./publicCommand/listProduct');
const { buildGreeting } = require('../utils/greetingHelper');
const { getCompanyName } = require('../utils/getCompanyName');
const { renderWelcomeHeader } = require('../utils/menuFormatter');

const startCommand = async (ctx) => {
    try {
        const jid = ctx.from;
        const user = ctx.fromUser;

        // Check welcome feature flag before doing anything else.
        const earlySettings = await settingsService.getSettings(ctx);
        if (earlySettings?.welcomeEnabled === false) {
            return listProduct(ctx);
        }

        // Execute all DB queries in parallel
        const [setting, sumUserTransaction, soldStocks, totalUsers, userBalance, products] =
            await Promise.all([
                settingsService.getSettings(ctx),
                sumUserTransactionAmount(ctx, jid),
                countSoldStocks(ctx),
                botUserRepository.count(ctx, {}),
                botUserBalanceRepository.findByUserId(ctx, jid),
                productRepository.findActiveProducts(ctx, { sort: { name: 1 } })
            ]);

        // Create balance if not exists (non-blocking)
        if (!userBalance) {
            botUserBalanceRepository.create(ctx, {
                userId: jid,
                balance: 0,
                totalTopUp: 0,
                totalSpent: 0
            }).catch(err => console.log(clc.yellow("[ WARNING ]") + ` Failed to create balance: ${err.message}`));
        }

        const balance = userBalance?.balance || 0;

        // Banner logic
        let posterUrl = null;
        if (setting?.imageIntro) {
            posterUrl = `https://images.koalastore.digital/${setting.imageIntro}`;
        }

        // Sync user info on every /start (fire-and-forget)
        botUserRepository.upsertWhatsappUser(ctx, jid, user.first_name ?? null).catch(() => {});

        // Build message
        const displayName = user.first_name || user.phone || jid;
        const greeting = buildGreeting();
        const companyName = await getCompanyName(setting, ctx.state?.botId);

        let profileMessage = renderWelcomeHeader(displayName, companyName, greeting) + '\n\n';
        profileMessage += `*Info Pengguna*\n`;
        profileMessage += `> ID: ${ctx.phoneNumber}\n`;
        profileMessage += `> Nama: ${user.first_name || 'N/A'}\n`;
        profileMessage += `> Saldo: ${formatMoney(balance)}\n`;
        profileMessage += `> Total Transaksi: ${formatMoney(sumUserTransaction)}\n\n`;
        profileMessage += `*Statistik Bot*\n`;
        profileMessage += `> Terjual: ${soldStocks.toLocaleString('id-ID')} pcs\n`;
        profileMessage += `> Total Pengguna: ${totalUsers.toLocaleString('id-ID')}\n\n`;
        profileMessage += `*Pintasan*\n`;
        profileMessage += `.stok — Lihat stok produk\n`;
        profileMessage += `.saldo — Informasi saldo dan top-up\n`;
        profileMessage += `.vouchers — Lihat voucher diskon\n`;
        profileMessage += `cara order — Panduan order lengkap\n`;

        // Add product list
        if (products && products.length > 0) {
            profileMessage += `\n*List Produk*\n`;
            products.forEach((product, i) => {
                profileMessage += `${i + 1}. ${product.name}\n`;
            });
            profileMessage += `\n_Ketik nomor produk untuk memesan_`;
            profileMessage += `\n_Pintasan beli:_ \`buy <kode> 1\` _(QRIS)_ · \`buynow <kode> 1\` _(Saldo)_`;
            profileMessage += `\n_Angka di belakang = jumlah pcs (contoh:_ \`buy NETFLIX 5\`_)_`;
        } else {
            profileMessage += `\n_Belum ada produk tersedia_`;
        }

        // Send with banner image or text only
        if (posterUrl) {
            try {
                await ctx.sendImage(posterUrl, profileMessage);
            } catch (photoError) {
                console.log(clc.yellow("[ WARNING ]") + ` Failed to send photo: ${photoError.message}`);
                await ctx.reply(profileMessage);
            }
        } else {
            await ctx.reply(profileMessage);
        }

    } catch (err) {
        await ctx.reply('*Terjadi error saat menjalankan command!*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`Error in command/start.js: ${err.message}`)}`);
    }
};

module.exports = startCommand;
