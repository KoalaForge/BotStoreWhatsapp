const settingsService = require('../services/settingsService');
const adminRepository = require('../repositories/AdminRepository');
const { htmlToWhatsApp } = require('./waFormatter');
const { withRetry } = require('./waRetry');
const { toJid } = require('./jidHelper');

/**
 * Get notification WhatsApp JIDs with fallback chain:
 * 1. Admin JIDs from AdminRepository (idWhatsapp field)
 * 2. process.env.NOTIFICATION_WHATSAPP_ID (comma-separated JIDs)
 *
 * @param {string|null} botId - Bot ID for multi-mode, null for single-mode
 * @returns {Promise<Array<string>>} - Array of WhatsApp JIDs
 */
const getNotificationIds = async (botId = null) => {
    const set = new Set();

    try {
        const context = botId ? { botId } : {};
        const admins = await adminRepository.find(context, {});
        for (const a of admins || []) {
            const jid = toJid(a.idWhatsapp);
            if (jid && jid.trim()) set.add(jid);
        }
    } catch (error) {
        console.error('Failed to get admin WhatsApp JIDs for notifications:', error.message);
    }

    if (process.env.NOTIFICATION_WHATSAPP_ID) {
        for (const raw of process.env.NOTIFICATION_WHATSAPP_ID.split(',')) {
            const jid = toJid(raw.trim());
            if (jid) set.add(jid);
        }
    }

    return Array.from(set);
};

/**
 * Send text notification to all admin WhatsApp JIDs.
 *
 * @param {Object} sock - Baileys WebSocket connection
 * @param {string} message - Message text (WhatsApp markdown)
 * @param {Object|null} context - Context with state.botId for multi-mode
 * @param {string} [parseMode] - If 'HTML', converts via htmlToWhatsApp before sending
 * @returns {Promise<void>}
 */
const sendNotification = async (sock, message, context = null, parseMode = null) => {
    const botId = context?.state?.botId || context?.botId || null;
    const ids = await getNotificationIds(botId);

    // Check notification enabled setting
    const setting = botId
        ? await settingsService.getSettingsByBotId(botId)
        : await settingsService.getSettings(null);
    const isSendNotification = setting?.sendNotification ?? process.env.NOTIFICATION_ACTIVE;

    if (!isSendNotification) return;

    // Convert HTML to WhatsApp markdown if needed
    const text = parseMode === 'HTML' ? htmlToWhatsApp(message) : message;

    for (const jid of ids) {
        await withRetry(() => sock.sendMessage(jid, { text }));
    }
};

/**
 * Send file/document notification to all admin WhatsApp JIDs.
 *
 * @param {Object} sock - Baileys WebSocket connection
 * @param {Buffer|string} bufferOrContent - File buffer or string content
 * @param {string} filename - Filename for the document
 * @param {Object|null} context - Context with state.botId for multi-mode
 * @param {string|null} caption - Optional caption
 * @returns {Promise<void>}
 */
const sendFileNotification = async (sock, bufferOrContent, filename, context = null, caption = null) => {
    const botId = context?.state?.botId || context?.botId || null;
    const ids = await getNotificationIds(botId);

    const setting = botId
        ? await settingsService.getSettingsByBotId(botId)
        : await settingsService.getSettings(null);
    const isSendNotification = setting?.sendNotification ?? process.env.NOTIFICATION_ACTIVE;

    if (!isSendNotification) return;

    // Ensure we have a Buffer
    const buffer = Buffer.isBuffer(bufferOrContent)
        ? bufferOrContent
        : Buffer.from(bufferOrContent, 'utf-8');

    for (const jid of ids) {
        await withRetry(() => sock.sendMessage(jid, {
            document: buffer,
            fileName: filename,
            mimetype: 'text/plain',
            caption: caption || null
        }));
    }
};

module.exports = {
    getNotificationIds,
    sendNotification,
    sendFileNotification
};
