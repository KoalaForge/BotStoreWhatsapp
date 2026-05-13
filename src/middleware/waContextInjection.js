const repositoryContext = require('../services/repositoryContext');
const clc = require('cli-color');
const moment = require('moment-timezone');

/**
 * WhatsApp Context Injection Middleware
 * Injects repository context and pricing service into WaCtx.
 * Equivalent of contextInjectionMiddleware.js in Telegram project.
 */
const waContextInjectionMiddleware = async (ctx, next) => {
    try {
        ctx.repositoryContext = await repositoryContext.extractContext(ctx);
        ctx.pricingService = repositoryContext.getPricingService();
        return next();
    } catch (err) {
        console.log(
            clc.red.bold("[ ERROR ]") +
            ` [${moment().format('HH:mm:ss')}]: ` +
            clc.blueBright(`Error in waContextInjection: ${err.message}`)
        );
        ctx.repositoryContext = null;
        return next();
    }
};

module.exports = waContextInjectionMiddleware;
