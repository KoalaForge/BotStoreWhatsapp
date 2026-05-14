const userWhatsappBotModel = require('../../../database/models/userWhatsappBotModels');
const { NotFoundException, BadRequestException } = require('../../../exceptions');

/**
 * Request QR Controller
 * Handles POST /api/bots/:id/qr
 *
 * Force fresh QR generation for a bot that needs (re-)pairing.
 * Fire-and-forget: returns 202 immediately. QR delivered async via:
 *   - webhook event `qr_generated`
 *   - WebSocket /ws/qr/:botId
 *
 * If creds are still valid, Baileys reconnects silently — caller will receive
 * `bot_connected` webhook instead. Client should listen for both events.
 */
function requestQrController(waBotManager) {
    return async (request, reply) => {
        const botId = request.params.id;

        const botDoc = await userWhatsappBotModel.findById(botId);
        if (!botDoc) {
            throw new NotFoundException('Bot tidak ditemukan');
        }

        let connection = waBotManager.getBotInstance(botId);

        if (!connection) {
            await waBotManager.reactivateBot(botId);
            connection = waBotManager.getBotInstance(botId);
            if (!connection) {
                throw new BadRequestException('Failed to bootstrap bot connection.');
            }
        }

        if (connection.isRunning) {
            throw new BadRequestException('Bot is already connected. No QR needed.');
        }

        connection.switchToQrMode().catch((e) => {
            console.error(`switchToQrMode failed for ${botId}:`, e && e.message ? e.message : e);
        });

        await userWhatsappBotModel.updateOne(
            { _id: botId },
            { $set: { pairingMethod: 'qr' } }
        );

        reply.code(202);
        return {
            success: true,
            code: 202,
            message: 'QR generation initiated. Watch webhook qr_generated or /ws/qr/:botId.',
            data: {
                bot_id: botId,
                qr_ws_url: `/ws/qr/${botId}`,
                phone_number: botDoc.phoneNumber
            }
        };
    };
}

module.exports = requestQrController;
