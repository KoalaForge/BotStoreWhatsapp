/**
 * Delete Bot Controller
 * Handles DELETE /api/bots/:id
 * Stops connection, deletes auth state, removes record.
 */
function deleteBotController(waBotManager) {
    return async (request, reply) => {
        const botId = request.params.id;

        await waBotManager.deleteBot(botId);

        return {
            success: true,
            code: 200,
            message: 'Bot deleted successfully',
            data: null
        };
    };
}

module.exports = deleteBotController;
