const { withRetry } = require('./waRetry');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const renderProgressBar = (percent) => {
    const totalBlocks = 14;
    const filledBlocks = Math.round((percent / 100) * totalBlocks);
    const emptyBlocks = totalBlocks - filledBlocks;
    return `<b>Loading ${'█'.repeat(filledBlocks)}</b>${'░'.repeat(emptyBlocks)} <b>${percent}%</b>`;
};

// Optimized progress bar with configurable completion callback
const showProgress = async (ctx, from, onComplete = null) => {
    // Send initial progress message
    const progressMsg = await withRetry(() =>
        ctx.telegram.sendMessage(from.id, renderProgressBar(50), { parse_mode: 'HTML' })
    );

    // 2-step progress: 50% → 100% (fewer API calls = faster)
    const progressSteps = [100];
    for (const percent of progressSteps) {
        await withRetry(() =>
            ctx.telegram.editMessageText(
                from.id,
                progressMsg.message_id,
                undefined,
                renderProgressBar(percent),
                { parse_mode: 'HTML' }
            )
        );
    }

    // Execute completion callback if provided
    if (onComplete) {
        await onComplete(ctx, from, progressMsg);
    } else {
        // Default completion behavior
        await withRetry(() =>
            ctx.telegram.editMessageText(
                from.id,
                progressMsg.message_id,
                undefined,
                '<blockquote><b>Sikattt ✓</b></blockquote>',
                { parse_mode: 'HTML' }
            )
        );
    }

    return progressMsg;
};

module.exports = {
    showProgress
};