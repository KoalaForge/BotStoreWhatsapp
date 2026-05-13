const clc = require('cli-color');
const moment = require('moment-timezone');
const productVariantRepository = require('../../repositories/ProductVariantRepository');
const productVariantSnkRepository = require('../../repositories/ProductVariantSnkRepository');
const { requireAdmin } = require('../../middleware/waAuth');
const snkFormatter = require('../../utils/snkFormatter');
const snkState = require('../../state/snkState');

/**
 * Set Product Variant SnK - Multi-step conversation
 *
 * Flow:
 * 1. .setvariantsnk <codeVariant> -> Start flow
 * 2. Bot asks for T&C -> Admin sends T&C
 * 3. Bot asks for Warranty -> Admin sends warranty or .skip
 * 4. Save & preview
 */
const setProductVariantSnk = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;

        const userId = ctx.from;

        // Initial command - start the flow
        const args = ctx.commandArgs || [];
        const codeVariant = args[0];

        if (!codeVariant) {
            return ctx.reply(
                '*Set SNK Variant*\n\n' +
                'Format:\n' +
                '`.setvariantsnk <codeVariant>`\n\n' +
                'Contoh:\n' +
                '`.setvariantsnk CANVA-1Bulan`'
            );
        }

        // Validate codeVariant exists
        const checkCode = await productVariantRepository.findByCodeVariant(ctx, codeVariant);
        if (!checkCode) {
            return ctx.reply('*Code variant produk tidak ditemukan.*');
        }

        // Start T&C input flow
        snkState.startTermsInput(userId, codeVariant);

        await ctx.reply(
            `*Set SNK Varian ${codeVariant}*\n\n` +
            `*Langkah 1/2: Syarat & Ketentuan*\n\n` +
            `Silakan kirim Syarat & Ketentuan untuk produk ini.\n\n` +
            `*Tips:*\n` +
            `- Setiap baris baru = poin baru\n` +
            `- Maksimal 2000 karakter\n\n` +
            `Ketik \`.cancel\` untuk membatalkan.`
        );
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in setProductVariantSnk: ${err.message}`));
        snkState.clearUserSnkState(ctx.from);
    }
};

/**
 * Handle SNK text input (T&C or Warranty step)
 * Called from message router when user is in SNK input state.
 */
const handleSnkInput = async (ctx) => {
    try {
        const userId = ctx.from;
        const text = (ctx.message || '').trim();

        // Check for cancel
        if (text === '.cancel' || text === '.batal') {
            snkState.clearUserSnkState(userId);
            return ctx.reply('*Input SNK dibatalkan.*');
        }

        // Handle T&C input
        if (snkState.isAwaitingTerms(userId)) {
            return handleTermsInput(ctx, userId, text);
        }

        // Handle Warranty input
        if (snkState.isAwaitingWarranty(userId)) {
            return handleWarrantyInput(ctx, userId, text);
        }
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error in handleSnkInput: ${err.message}`));
        snkState.clearUserSnkState(ctx.from);
    }
};

async function handleTermsInput(ctx, userId, text) {
    const validation = snkFormatter.validateInput(text);
    if (!validation.valid) {
        return ctx.reply(`*${validation.error}*\n\n_Silakan coba lagi atau ketik \`.cancel\`_`);
    }

    snkState.saveTermsAndStartWarranty(userId, text);

    await ctx.reply(
        `*Syarat & Ketentuan diterima!*\n\n` +
        `*Langkah 2/2: Ketentuan Garansi*\n\n` +
        `Silakan kirim Ketentuan Garansi (opsional).\n\n` +
        `*Tips:*\n` +
        `- Setiap baris baru = poin baru\n` +
        `- Maksimal 1000 karakter\n` +
        `- Ketik \`.skip\` untuk melewati\n\n` +
        `Ketik \`.cancel\` untuk membatalkan.`
    );
}

async function handleWarrantyInput(ctx, userId, text) {
    // Check for skip
    if (text === '.skip' || text === '.lewati') {
        return completeSnKInput(ctx, userId, '');
    }

    const state = snkState.getUserSnkState(userId);
    if (!state) {
        return ctx.reply('*Sesi habis, silakan mulai dari awal.*');
    }

    const fullText = state.termsAndConditions + '\n===\n' + text;
    const validation = snkFormatter.validateInput(fullText);
    if (!validation.valid) {
        return ctx.reply(`*${validation.error}*\n\n_Silakan coba lagi, ketik \`.skip\` untuk lewati, atau \`.cancel\` untuk batal._`);
    }

    return completeSnKInput(ctx, userId, text);
}

async function completeSnKInput(ctx, userId, warrantyText) {
    const state = snkState.getAndClearState(userId);
    if (!state) {
        return ctx.reply('*Sesi habis, silakan mulai dari awal.*');
    }

    const { codeVariant, termsAndConditions } = state;

    await productVariantSnkRepository.upsertSnk(
        ctx,
        codeVariant,
        termsAndConditions,
        warrantyText
    );

    console.log(`Successfully add/update SnK for variant ${codeVariant}`);

    const preview = snkFormatter.formatForPreview({
        termsAndConditions,
        warrantyTerms: warrantyText
    });

    await ctx.reply(
        `*SNK berhasil ditambahkan pada variant ${codeVariant}*\n\n` +
        `*Preview Data:*\n${preview}`
    );
}

module.exports = { setProductVariantSnk, handleSnkInput };
