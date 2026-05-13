/**
 * Chat Sanitizer Utility
 * Input validation and sanitization for chat messages
 */

const MAX_MESSAGE_LENGTH = 4000; // Telegram limit is 4096, leave buffer

const ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
    'application/zip',
    'application/x-zip-compressed'
];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Sanitize text message content
 * @param {string} text - Raw text input
 * @returns {string} - Sanitized text
 */
function sanitizeMessage(text) {
    if (!text || typeof text !== 'string') return '';
    return text.slice(0, MAX_MESSAGE_LENGTH);
}


/**
 * Validate file for chat upload
 * @param {Object} file - Telegram file object
 * @returns {{ valid: boolean, reason: string|null }}
 */
function validateFile(file) {
    if (!file) {
        return { valid: false, reason: 'File tidak ditemukan' };
    }

    if (file.file_size && file.file_size > MAX_FILE_SIZE) {
        return { valid: false, reason: 'Ukuran file terlalu besar (maks 5MB)' };
    }

    if (file.mime_type && !ALLOWED_MIME_TYPES.includes(file.mime_type)) {
        return { valid: false, reason: 'Tipe file tidak diizinkan' };
    }

    return { valid: true, reason: null };
}

module.exports = {
    sanitizeMessage,
    validateFile,
    MAX_MESSAGE_LENGTH,
    MAX_FILE_SIZE,
    ALLOWED_MIME_TYPES
};
