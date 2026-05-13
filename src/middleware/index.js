const waBotContextMiddleware = require('./waBotContext');
const waContextInjectionMiddleware = require('./waContextInjection');
const waBanCheckMiddleware = require('./waBanCheck');
const waWhitelistCheckMiddleware = require('./waWhitelistCheck');
const { requireAdmin } = require('./waAuth');

module.exports = {
    waBotContextMiddleware,
    waContextInjectionMiddleware,
    waBanCheckMiddleware,
    waWhitelistCheckMiddleware,
    requireAdmin
};
