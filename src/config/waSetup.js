const MessageRouter = require('./messageRouter');
const waBotContextMiddleware = require('../middleware/waBotContext');
const waContextInjectionMiddleware = require('../middleware/waContextInjection');
const waBanCheckMiddleware = require('../middleware/waBanCheck');
const waWhitelistCheckMiddleware = require('../middleware/waWhitelistCheck');
const waAuthMiddleware = require('../middleware/waAuth');
const registerCommands = require('./registerCommands');
const registerHandlers = require('./registerHandlers');

/**
 * Creates and configures the WhatsApp message router with all middleware and handlers.
 * Equivalent of botSetup.js in the Telegram project.
 *
 * @param {string|null} botId - MongoDB _id for multi-mode (null for single-mode)
 * @returns {MessageRouter} Configured router instance
 */
function setupWhatsApp(botId = null) {
    const router = new MessageRouter();

    // In multi-mode, inject botId into all contexts
    if (botId) {
        router.use(waBotContextMiddleware(botId));
    }

    // Inject repository context automatically (MUST run before handlers)
    router.use(waContextInjectionMiddleware);

    // Check if user is banned
    router.use(waBanCheckMiddleware);

    // Whitelist gate — runs after ban check. Default off so existing bots unaffected.
    router.use(waWhitelistCheckMiddleware);

    // Register all commands (dot-prefix)
    registerCommands(router);

    // Register all handlers (hears, actions, state-based input)
    registerHandlers(router);

    return router;
}

module.exports = setupWhatsApp;
