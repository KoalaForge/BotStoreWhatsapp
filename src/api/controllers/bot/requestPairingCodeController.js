const userWhatsappBotModel = require('../../../database/models/userWhatsappBotModels');
const { NotFoundException, BadRequestException } = require('../../../exceptions');

/**
 * Request Pairing Code Controller
 * Handles POST /api/bots/:id/pairing-code
 * Requests a new pairing code for an existing bot that needs (re-)pairing.
 */
function requestPairingCodeController(waBotManager) {
    return async (request, reply) => {
        const botId = request.params.id;

        const botDoc = await userWhatsappBotModel.findById(botId);
        if (!botDoc) {
            throw new NotFoundException('Bot tidak ditemukan');
        }

        let connection = waBotManager.getBotInstance(botId);

        // Auto-bootstrap: if instance is missing (server restart, or bot was
        // never spawned because it has no credentials yet), spin it up so the
        // caller doesn't have to make a separate /reactivate call first.
        if (!connection) {
            await waBotManager.reactivateBot(botId);
            connection = waBotManager.getBotInstance(botId);
            if (!connection) {
                throw new BadRequestException('Failed to bootstrap bot connection.');
            }
        }

        if (connection.isRunning) {
            throw new BadRequestException('Bot is already connected. No pairing needed.');
        }

        // Use the connection's safe wrapper which waits for the WS noise
        // handshake to complete before calling Baileys requestPairingCode.
        const code = await connection.requestPairingCode();

        // Update pairing method on record
        await userWhatsappBotModel.updateOne(
            { _id: botId },
            { $set: { pairingMethod: 'code' } }
        );

        return {
            success: true,
            code: 200,
            message: 'Pairing code generated',
            data: {
                bot_id: botId,
                pairing_code: code,
                phone_number: botDoc.phoneNumber
            }
        };
    };
}

module.exports = requestPairingCodeController;
