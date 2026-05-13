/**
 * Restart Bot Controller
 * Handles POST /api/bots/:id/restart
 * Stops the socket and reconnects with existing auth state (no re-pairing).
 */
function restartBotController(waBotManager) {
    return async (request, reply) => {
        const botId = request.params.id;

        await waBotManager.restartBot(botId);

        return reply.code(202).send({
            success: true,
            code: 202,
            message: 'Bot restart initiated',
            data: {
                bot_id: botId,
                state: 'restarting'
            }
        });
    };
}

module.exports = restartBotController;
