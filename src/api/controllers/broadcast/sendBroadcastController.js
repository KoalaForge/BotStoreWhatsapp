/**
 * Send Broadcast Controller (WhatsApp)
 * Handles POST /api/broadcast/send
 *
 * Enqueues a text/image message broadcast to all active (non-banned) users of a bot.
 * Returns immediately with a jobId — processing happens asynchronously.
 * Caller can track progress via GET /api/broadcast/:jobId
 *
 * Supports both SINGLE mode (one bot) and MULTI mode (multiple bots).
 */

const modeService              = require('../../../services/modeService');
const botUserRepository        = require('../../../repositories/BotUserRepository');
const waBroadcastQueueService  = require('../../../services/waBroadcastQueueService');

function sendBroadcastController(waBotManager, singleConnection) {
    return async (request, reply) => {
        const { bot_id, text, image_url } = request.body;

        // ── Resolve WhatsApp sock & botId ───────────────────────────────────
        let sock, botId;

        if (modeService.isSingleMode()) {
            if (!singleConnection || !singleConnection.sock) {
                return reply.code(503).send({
                    success: false,
                    code:    503,
                    message: 'Bot instance not available'
                });
            }
            sock  = singleConnection.sock;
            botId = null;
        } else {
            if (!bot_id) {
                return reply.code(400).send({
                    success: false,
                    code:    400,
                    message: 'bot_id is required in MULTI mode'
                });
            }

            const connection = waBotManager.getBotInstance(bot_id);
            if (!connection) {
                return reply.code(404).send({
                    success: false,
                    code:    404,
                    message: 'Bot not found or not running'
                });
            }

            sock  = connection.sock;
            botId = bot_id;
        }

        // ── Fetch all active (non-banned) users ─────────────────────────────
        const repositoryCtx = { botId: botId ?? null };
        const users = await botUserRepository.findActiveUsers(repositoryCtx);

        if (users.length === 0) {
            return reply.code(200).send({
                success: true,
                code:    200,
                message: 'No active users to broadcast to',
                data:    { job_id: null, status: 'skipped', total: 0 }
            });
        }

        // ── Validate payload — either text or image_url required ────────────
        if (!text && !image_url) {
            return reply.code(400).send({
                success: false,
                code:    400,
                message: 'Either text or image_url is required'
            });
        }

        // ── Build message builder & enqueue ─────────────────────────────────
        let messageBuilder;

        if (image_url) {
            messageBuilder = () => ({
                image: image_url,
                caption: text || ''
            });
        } else {
            messageBuilder = () => ({ text });
        }

        // enqueue() returns immediately with a jobId
        const jobId = waBroadcastQueueService.enqueue(sock, users, messageBuilder);

        return reply.code(200).send({
            success: true,
            code:    200,
            message: 'Broadcast queued successfully',
            data: {
                job_id: jobId,
                status: 'processing',
                total:  users.length
            }
        });
    };
}

module.exports = { sendBroadcastController };
