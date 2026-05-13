/**
 * Deactivate Bot Controller
 * Handles POST /api/bots/:id/deactivate
 * Disconnects the WhatsApp session (preserves auth state for reconnect).
 */
function deactivateBotController(waBotManager) {
    return async (request, reply) => {
        const botId = request.params.id;

        await waBotManager.deactivateBot(botId);

        return {
            success: true,
            code: 200,
            message: 'Bot deactivated successfully',
            data: null
        };
    };
}

module.exports = deactivateBotController;
