const crypto = require('crypto');

/**
 * Create Bot Controller
 * Handles POST /api/bots/create
 * Initiates WhatsApp pairing flow (QR or code).
 * QR streaming is available via WebSocket at /ws/qr/:botId
 */
function createBotController(waBotManager) {
    return async (request, reply) => {
        const {
            user_id,
            phone_number,
            bot_name,
            pairing_method = 'qr',
            webhook_url,
            webhook_events
        } = request.body;

        // Auto-generate webhook secret when a URL is provided so the
        // integrator can verify the X-Webhook-Signature header.
        const webhookSecret = webhook_url
            ? crypto.randomBytes(32).toString('hex')
            : null;

        const { botDoc, connection } = await waBotManager.createBot({
            userId: user_id,
            phoneNumber: phone_number,
            botName: bot_name,
            pairingMethod: pairing_method,
            webhookUrl: webhook_url || null,
            webhookEvents: webhook_events || null,
            webhookSecret
        });

        const botId = botDoc._id.toString();

        const responseData = {
            bot_id: botId,
            user_id: botDoc.userId,
            phone_number: botDoc.phoneNumber,
            bot_name: botDoc.botName,
            pairing_method: botDoc.pairingMethod,
            is_active: botDoc.isActive,
            is_suspended: botDoc.isSuspended,
            webhook_url: botDoc.webhook_url || null,
            webhook_events: botDoc.webhook_events,
            // Returned only on creation/rotation. Integrator must store it now.
            webhook_secret: webhookSecret,
            created_at: botDoc.createdAt
        };

        // If QR method, provide WebSocket URL for QR streaming
        if (pairing_method === 'qr') {
            responseData.qr_ws_url = `/ws/qr/${botId}`;
        }

        // If code method, wait briefly for the pairing code event
        if (pairing_method === 'code') {
            const pairingCode = await new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(null), 10000);
                connection.once('pairingCode', (code) => {
                    clearTimeout(timeout);
                    resolve(code);
                });
                connection.once('pairingError', () => {
                    clearTimeout(timeout);
                    resolve(null);
                });
            });

            if (pairingCode) {
                responseData.pairing_code = pairingCode;
            } else {
                responseData.pairing_code = null;
                responseData.pairing_note = 'Pairing code generation failed or timed out. Use POST /api/bots/:id/pairing-code to retry.';
            }
        }

        reply.code(201);
        return {
            success: true,
            code: 201,
            message: 'Bot created. Complete pairing to activate connection.',
            data: responseData
        };
    };
}

module.exports = createBotController;
