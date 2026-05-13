/**
 * WhatsApp Message Context Utilities
 *
 * Simplified version of the Telegram messageContext utility.
 * WhatsApp cannot edit messages, so editMessageContent deletes + resends.
 */

/**
 * Extract text content from a WhatsApp context message.
 * @param {object} ctx - WhatsApp context (WaCtx or similar wrapper)
 * @returns {string}
 */
function getMessageText(ctx) {
    const msg = ctx?.message || ctx?.callbackQuery?.message || {};
    return msg.text || msg.body || msg.conversation || '';
}

/**
 * Whether the message is a photo message.
 * Always returns false for WhatsApp — we don't do in-place edits on media.
 * @returns {boolean}
 */
function isPhotoMessage() {
    return false;
}

/**
 * Edit message content for WhatsApp.
 * WhatsApp does not support message editing, so this deletes the old message
 * and sends a new one with the updated content.
 *
 * @param {object} ctx - WhatsApp context with deleteMessage() and reply() methods
 * @param {string} text - New message text
 * @param {object} [options={}] - Additional options passed to reply
 * @returns {Promise<object>} - The newly sent message
 */
async function editMessageContent(ctx, text, options = {}) {
    try {
        await ctx.deleteMessage();
    } catch (_err) {
        // Silently ignore if delete fails (message may be too old or already deleted)
    }

    return ctx.reply(text, options);
}

module.exports = { getMessageText, isPhotoMessage, editMessageContent };
