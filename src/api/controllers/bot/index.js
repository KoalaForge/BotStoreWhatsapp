/**
 * Bot Controllers Index
 * Central export point for all WhatsApp bot controllers
 */

module.exports = {
    createBotController: require('./createBotController'),
    updateBotController: require('./updateBotController'),
    deleteBotController: require('./deleteBotController'),
    deactivateBotController: require('./deactivateBotController'),
    reactivateBotController: require('./reactivateBotController'),
    listBotsController: require('./listBotsController'),
    getBotController: require('./getBotController'),
    requestPairingCodeController: require('./requestPairingCodeController'),
    listWebhookLogsController: require('./listWebhookLogsController')
};
