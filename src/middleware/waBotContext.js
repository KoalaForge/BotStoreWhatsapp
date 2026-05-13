/**
 * WhatsApp Bot Context Middleware
 * Injects botId into ctx.state for multi-mode operations.
 * Equivalent of botContextMiddleware.js in Telegram project.
 */
function waBotContextMiddleware(botId) {
    if (!botId) {
        throw new Error('[waBotContextMiddleware] botId is required');
    }

    return async (ctx, next) => {
        if (!ctx.state) {
            ctx.state = {};
        }
        ctx.state.botId = botId;
        await next();
    };
}

module.exports = waBotContextMiddleware;
