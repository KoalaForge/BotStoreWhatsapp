const clc = require('cli-color');
const moment = require('moment-timezone');
const variantBanService = require('../../services/variantBanService');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const productRepository = require('../../repositories/ProductRepository');
const botUserRepository = require('../../repositories/BotUserRepository');
const { requireAdmin } = require('../../middleware/waAuth');
const { stripPhone } = require('../../utils/jidHelper');

const PAGE_SIZE = 10;

function _logErr(where, err) {
    console.log(
        clc.red.bold('[ ERROR ]') + ` [${moment().format('HH:mm:ss')}]: ` +
        clc.redBright(`${where}: ${err.message}`)
    );
}

async function _lookupName(ctx, phone) {
    try {
        const user = await botUserRepository.findByWhatsappId(ctx, phone);
        return user?.usernameTelegram || null;
    } catch {
        return null;
    }
}


const banVariant = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try {
        const args = ctx.commandArgs || [];
        if (args.length < 2) {
            return ctx.reply(`*Format salah.*\n\nPenggunaan: .banvariant <codeVariant> <nomor> [alasan]\nContoh: .banvariant netflix-1bln 6281234567890 spam`);
        }
        const codeVariantRaw = args[0];
        const phone = stripPhone(args[1]);
        const reason = args.slice(2).join(' ').trim() || null;
        if (!phone) return ctx.reply('*Nomor tidak valid.*');

        const variant = await productVariantRepository.findByCodeVariant(ctx, codeVariantRaw);
        if (!variant) {
            return ctx.reply(`*Variant tidak ditemukan:* ${codeVariantRaw}`);
        }

        const existing = await variantBanService.findVariantBan(ctx, phone, variant.codeVariant);
        if (existing) {
            return ctx.reply(`User *${phone}* sudah diblokir dari variant *${variant.codeVariant}*.`);
        }

        await variantBanService.banVariant(ctx, {
            idWhatsapp: phone,
            codeVariant: variant.codeVariant,
            name: await _lookupName(ctx, phone),
            reason,
            adminId: ctx.from
        });

        return ctx.reply(`*Berhasil.* User *${phone}* diblokir dari variant *${variant.codeVariant}*.\nAlasan: ${reason || '-'}`);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        _logErr('banVariant', err);
    }
};

const banProduct = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try {
        const args = ctx.commandArgs || [];
        if (args.length < 2) {
            return ctx.reply(`*Format salah.*\n\nPenggunaan: .banproduct <productCode> <nomor> [alasan]\nContoh: .banproduct netflix 6281234567890 spam`);
        }
        const productCodeRaw = args[0];
        const phone = stripPhone(args[1]);
        const reason = args.slice(2).join(' ').trim() || null;
        if (!phone) return ctx.reply('*Nomor tidak valid.*');

        const product = await productRepository.findByCode(ctx, productCodeRaw);
        if (!product) {
            return ctx.reply(`*Produk tidak ditemukan:* ${productCodeRaw}`);
        }

        const existing = await variantBanService.findProductBan(ctx, phone, product.code);
        if (existing) {
            return ctx.reply(`User *${phone}* sudah diblokir dari produk *${product.code}*.`);
        }

        await variantBanService.banProduct(ctx, {
            idWhatsapp: phone,
            productCode: product.code,
            name: await _lookupName(ctx, phone),
            reason,
            adminId: ctx.from
        });

        return ctx.reply(`*Berhasil.* User *${phone}* diblokir dari produk *${product.name}* (${product.code}) — semua variant.\nAlasan: ${reason || '-'}`);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        _logErr('banProduct', err);
    }
};

const unbanVariant = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try {
        const args = ctx.commandArgs || [];
        if (args.length < 2) {
            return ctx.reply(`*Format salah.*\n\nPenggunaan: .unbanvariant <codeVariant> <nomor>`);
        }
        const codeVariantRaw = args[0];
        const phone = stripPhone(args[1]);
        if (!phone) return ctx.reply('*Nomor tidak valid.*');

        const variant = await productVariantRepository.findByCodeVariant(ctx, codeVariantRaw);
        const codeVariant = variant ? variant.codeVariant : codeVariantRaw;
        const variantName = variant?.name || codeVariant;

        const existing = await variantBanService.findVariantBan(ctx, phone, codeVariant);
        if (!existing) {
            return ctx.reply(`User *${phone}* tidak sedang diblokir dari variant *${variantName}* (${codeVariant}).`);
        }
        await variantBanService.unbanVariant(ctx, phone, codeVariant);
        return ctx.reply(`*Berhasil.* Blokir user *${phone}* pada variant *${variantName}* (${codeVariant}) dibuka.`);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        _logErr('unbanVariant', err);
    }
};

const unbanProduct = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try {
        const args = ctx.commandArgs || [];
        if (args.length < 2) {
            return ctx.reply(`*Format salah.*\n\nPenggunaan: .unbanproduct <productCode> <nomor>`);
        }
        const productCodeRaw = args[0];
        const phone = stripPhone(args[1]);
        if (!phone) return ctx.reply('*Nomor tidak valid.*');

        const product = await productRepository.findByCode(ctx, productCodeRaw);
        const productCode = product ? product.code : productCodeRaw;
        const productName = product?.name || productCode;

        const existing = await variantBanService.findProductBan(ctx, phone, productCode);
        if (!existing) {
            return ctx.reply(`User *${phone}* tidak sedang diblokir dari produk *${productName}* (${productCode}).`);
        }
        await variantBanService.unbanProduct(ctx, phone, productCode);
        return ctx.reply(`*Berhasil.* Blokir user *${phone}* pada produk *${productName}* (${productCode}) dibuka.`);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        _logErr('unbanProduct', err);
    }
};

const listVariantBan = async (ctx) => {
    if (!await requireAdmin(ctx)) return;
    try {
        const args = ctx.commandArgs || [];
        const page = Math.max(1, parseInt(args[0], 10) || 1);
        const { bans, total } = await variantBanService.listBans(ctx, { page, limit: PAGE_SIZE });
        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

        const header = `*Daftar Ban Variant/Produk*\nTotal: *${total}* — Halaman ${page}/${totalPages}\n\n`;
        let body;
        if (!bans.length) {
            body = `_Belum ada user yang diblokir._`;
        } else {
            body = bans.map((b, i) => {
                const idx = (page - 1) * PAGE_SIZE + i + 1;
                const name = b.name || '(tanpa nama)';
                const target = b.scope === 'product'
                    ? `Produk: ${b.productCode} (semua variant)`
                    : `Variant: ${b.codeVariant}`;
                return `*${idx}.* ${name}\n   Nomor: ${b.idWhatsapp}\n   ${target}\n   Alasan: ${b.ban_reason || '-'}`;
            }).join('\n\n');
        }
        let footer = '';
        if (totalPages > 1) footer += `\n\n_Halaman lain:_ .listvariantban <nomor halaman>`;
        return ctx.reply(header + body + footer);
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        _logErr('listVariantBan', err);
    }
};

module.exports = {
    banVariant,
    banProduct,
    unbanVariant,
    unbanProduct,
    listVariantBan
};
