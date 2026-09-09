const ratingApiService = require('../services/ratingApiService');
const { isFeatureEnabled } = require('../utils/featureFlags');

function errorMessage(error) {
    if (error.reason?.includes('sudah diberikan') || error.reason?.includes('sudah direspons')) {
        return 'Rating untuk transaksi ini sudah tercatat.';
    }
    if (error.reason?.includes('sudah dilewati')) return 'Permintaan rating ini sudah dilewati.';
    if (error.reason?.includes('24 jam')) return 'Periode rating 24 jam sudah berakhir.';
    if (error.status === 409 || error.code === 'DUPLICATE_REVIEW' || error.code === 'ALREADY_REVIEWED') {
        return 'Rating untuk transaksi ini sudah tercatat.';
    }
    if (error.status === 404 || error.status === 410 || error.status === 422) {
        return 'Permintaan rating ini sudah tidak berlaku.';
    }
    if (error.status === 401 || error.status === 403) {
        return 'Permintaan rating ini tidak valid untuk akun WhatsApp kamu.';
    }
    return 'Layanan rating sedang tidak tersedia. Silakan coba lagi nanti.';
}

function parseRequest(ctx, options) {
    if (options.transactionId) {
        return {
            transactionId: String(options.transactionId).trim(),
            rating: Number(options.rating),
            skip: options.skip === true,
            comment: options.comment,
            fromCommentStage: options.fromCommentStage === true
        };
    }

    const text = ctx.message?.trim() || '';
    const skipMatch = /^\.?rating\s+skip\s+(\S+)$/i.exec(text);
    if (skipMatch) return { transactionId: skipMatch[1], rating: NaN, skip: true };

    const ratingMatch = /^\.?rating\s+(\S+)\s+([1-5])$/i.exec(text);
    if (ratingMatch) {
        return { transactionId: ratingMatch[1], rating: Number(ratingMatch[2]), skip: false };
    }

    return null;
}

/**
 * Submit a rating from an explicit text command or a RATING_INPUT screen.
 * @returns {Promise<{handled: boolean, success: boolean, terminal: boolean}>}
 */
async function handleProductRating(ctx, options = {}) {
    const request = parseRequest(ctx, options);
    const hasValidRating = Number.isInteger(request?.rating) && request.rating >= 1 && request.rating <= 5;
    const hasValidComment = request?.comment === undefined
        || (typeof request.comment === 'string' && request.comment.length <= 500);
    if (!request || !request.transactionId || (!request.skip && !hasValidRating) || !hasValidComment) {
        await ctx.reply('Format rating tidak valid. Gunakan `rating <transactionId> <1-5>` atau `.rating skip <transactionId>`.');
        return { handled: true, success: false, terminal: false };
    }

    if (!await isFeatureEnabled(ctx, 'ratingEnabled')) {
        await ctx.reply('Fitur rating sedang dinonaktifkan.');
        return { handled: true, success: false, terminal: true };
    }

    try {
        if (request.skip) {
            await ratingApiService.skipRating({
                transactionId: request.transactionId,
                channelUserId: ctx.from
            });
            await ctx.reply(options.transactionId
                ? 'Oke, terima kasih sudah berbelanja!'
                : 'Baik, permintaan rating dilewati.');
        } else {
            await ratingApiService.submitRating({
                transactionId: request.transactionId,
                channelUserId: ctx.from,
                rating: request.rating,
                ...(request.comment ? { comment: request.comment } : {})
            });
            const finalMessage = request.fromCommentStage && request.comment
                ? `Terima kasih! Rating ${request.rating}/5 dan komentar kamu sudah tersimpan.`
                : `Terima kasih! Rating ${request.rating}/5 kamu sudah tersimpan.`;
            await ctx.reply(finalMessage);
        }

        return { handled: true, success: true, terminal: true };
    } catch (error) {
        await ctx.reply(errorMessage(error));
        return {
            handled: true,
            success: false,
            terminal: [401, 403, 404, 409, 410, 422].includes(error.status)
        };
    }
}

module.exports = handleProductRating;
