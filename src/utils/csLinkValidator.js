'use strict';

const MAX_INPUT_LENGTH = 500;

// Telegram username: 5-32 chars after @, alphanumeric + underscore
// Must NOT start or end with underscore
const USERNAME_REGEX = /^@[a-zA-Z0-9][a-zA-Z0-9_]{3,30}[a-zA-Z0-9]$/;

// Dangerous URI schemes that could cause XSS / code execution
const DANGEROUS_SCHEMES = /^(javascript|data|vbscript):/i;

/**
 * Validate a CS link (@username Telegram atau link/URL bebas)
 *
 * Format yang diterima:
 *  - @username  — Telegram username (divalidasi format)
 *  - URL bebas  — t.me/xxx, https://t.me/xxx, facebook.com/xxx, wa.me/xxx, dll.
 *                (tidak wajib ada protokol http/https)
 *
 * @param {string} link - Raw input from user
 * @returns {{ valid: boolean, reason?: string, normalized?: string }}
 */
function validateCSLink(link) {
    if (typeof link !== 'string') {
        return { valid: false, reason: 'Input harus berupa teks' };
    }

    const trimmed = link.trim();

    if (!trimmed) {
        return { valid: false, reason: 'Link tidak boleh kosong' };
    }

    if (trimmed.length > MAX_INPUT_LENGTH) {
        return { valid: false, reason: `Link terlalu panjang (maksimal ${MAX_INPUT_LENGTH} karakter)` };
    }

    // Case 1: @username Telegram
    if (trimmed.startsWith('@')) {
        if (!USERNAME_REGEX.test(trimmed)) {
            return {
                valid: false,
                reason: 'Format @username tidak valid. Username harus 5-32 karakter (huruf, angka, underscore), tidak boleh diawali/diakhiri underscore'
            };
        }
        return { valid: true, normalized: trimmed };
    }

    // Case 2: Blokir scheme berbahaya (XSS/code injection)
    if (DANGEROUS_SCHEMES.test(trimmed)) {
        return { valid: false, reason: 'Format link tidak diizinkan' };
    }

    // Case 3: Terima URL/link bebas (dengan atau tanpa protokol)
    // Contoh valid: facebook.com/user, wa.me/628xxx, https://t.me/cs, t.me/cs
    return { valid: true, normalized: trimmed };
}

module.exports = { validateCSLink };
