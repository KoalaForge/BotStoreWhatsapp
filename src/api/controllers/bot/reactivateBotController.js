/**
 * Reactivate Bot Controller
 * Handles POST /api/bots/:id/reactivate
 * Reconnects using existing auth state.
 */
function reactivateBotController(waBotManager) {
    return async (request, reply) => {
        const botId = request.params.id;

        await waBotManager.reactivateBot(botId);

        return {
            success: true,
            code: 200,
            message: 'Bot reactivated successfully',
            data: null
        };
    };
}

module.exports = reactivateBotController;
