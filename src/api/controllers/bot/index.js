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
    restartBotController: require('./restartBotController'),
    listBotsController: require('./listBotsController'),
    getBotController: require('./getBotController'),
    requestPairingCodeController: require('./requestPairingCodeController'),
    requestQrController: require('./requestQrController'),
    listWebhookLogsController: require('./listWebhookLogsController')
};
