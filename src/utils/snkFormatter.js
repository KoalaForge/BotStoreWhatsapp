/**
 * SnK Formatter Utility
 * Handles parsing and formatting of Syarat & Ketentuan (Terms & Conditions)
 */

/**
 * Clean problematic characters that cause UTF-8 encoding errors
 * Removes control characters, BOM, zero-width, directional marks, orphan surrogates
 * @param {string} text - Text to clean
 * @returns {string} - Cleaned text
 */
function _cleanProblematicChars(text) {
    if (!text || typeof text !== 'string') return text;

    // Remove: control chars (\x00-\x08, \x0B, \x0C, \x0E-\x1F, \x7F),
    // BOM (\uFEFF), zero-width/directional (\u200B-\u200F), orphan surrogates (\uD800-\uDFFF)
    // Keep: \n (10), \r (13), \t (9)
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFEFF\u200B-\u200F\uD800-\uDFFF]/g, '');
}

class SnKFormatter {
    /**
     * Convert double asterisks to HTML bold for Telegram HTML compatibility
     * **text** → <b>text</b>
     * @param {string} text - Text to convert
     * @returns {string} - Converted text
     */
    _convertDoubleAsterisks(text) {
        if (!text) return text;
        return text.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    }

    /**
     * Parse raw input text into terms and warranty sections
     * @param {string} rawText - Raw input from admin
     * @returns {Object} - { termsAndConditions, warrantyTerms }
     */
    parseInput(rawText) {
        if (!rawText || typeof rawText !== 'string') {
            return { termsAndConditions: '', warrantyTerms: '' };
        }

        // Clean problematic characters first
        const cleanedText = _cleanProblematicChars(rawText);

        // Check for separator (=== for backward compatibility)
        const separatorIndex = cleanedText.indexOf('\n===\n');

        if (separatorIndex === -1) {
            // No separator found - treat entire content as T&C
            return {
                termsAndConditions: cleanedText.trim(),
                warrantyTerms: ''
            };
        }

        // Split by separator
        const terms = cleanedText.substring(0, separatorIndex).trim();
        const warranty = cleanedText.substring(separatorIndex + 5).trim();

        return {
            termsAndConditions: terms,
            warrantyTerms: warranty
        };
    }

    /**
     * Validate SnK input
     * @param {string} rawText - Raw input to validate
     * @returns {Object} - { valid, error, termsLength, warrantyLength }
     */
    validateInput(rawText) {
        const MAX_TERMS_LENGTH = 2000;
        const MAX_WARRANTY_LENGTH = 1000;
        const MAX_TOTAL_LENGTH = 2500;

        if (!rawText) {
            return { valid: true, error: null, termsLength: 0, warrantyLength: 0 };
        }

        const { termsAndConditions, warrantyTerms } = this.parseInput(rawText);
        const termsLength = termsAndConditions.length;
        const warrantyLength = warrantyTerms.length;
        const totalLength = termsLength + warrantyLength;

        if (termsLength > MAX_TERMS_LENGTH) {
            return {
                valid: false,
                error: `Syarat & Ketentuan terlalu panjang (maksimal ${MAX_TERMS_LENGTH} karakter)`,
                termsLength,
                warrantyLength
            };
        }

        if (warrantyLength > MAX_WARRANTY_LENGTH) {
            return {
                valid: false,
                error: `Ketentuan Garansi terlalu panjang (maksimal ${MAX_WARRANTY_LENGTH} karakter)`,
                termsLength,
                warrantyLength
            };
        }

        if (totalLength > MAX_TOTAL_LENGTH) {
            return {
                valid: false,
                error: `Total SnK terlalu panjang (maksimal ${MAX_TOTAL_LENGTH} karakter)`,
                termsLength,
                warrantyLength
            };
        }

        return { valid: true, error: null, termsLength, warrantyLength };
    }

    /**
     * Strip existing bullet/emoji markers from line
     * Also handles > continuation marker
     * @param {string} line - Line to strip
     * @returns {Object} - { text: stripped line, isContinuation: boolean }
     */
    _stripBulletMarker(line) {
        const trimmed = line.trim();

        // Check for > continuation marker FIRST (before other patterns)
        if (trimmed.startsWith('>')) {
            return {
                text: trimmed.substring(1).trim(),
                isContinuation: true
            };
        }

        // Patterns to strip (in order):
        // 1. Standard bullets: •, - followed by space (NOT * — would break bold markup)
        // 2. Numbered: 1., 1), 1. followed by space
        // 3. Checkboxes: [x], [✓], [✅]
        const patterns = [
            /^[•\-]\s+/,                // • text, - text
            /^\d+[\.\)]\s+/,            // 1. text, 1) text
            /^\[[ x✓❌✅✔]\]\s*/,       // [x], [✓], [✅]
        ];

        let result = trimmed;
        for (const pattern of patterns) {
            result = result.replace(pattern, '');
            // Only apply first match that changes something
            if (result !== trimmed) break;
        }

        return {
            text: result.trim(),
            isContinuation: false
        };
    }

    /**
     * Format text section — unified line-by-line processing
     * Every line gets bullet formatting, > lines become continuations,
     * **text** converted to <b>text</b> for Telegram HTML compatibility.
     * @param {string} text - Raw text section
     * @returns {string} - Formatted text
     */
    _formatSection(text) {
        if (!text || typeof text !== 'string') return '';

        // Clean control characters, then convert **bold** → <b>bold</b>
        text = _cleanProblematicChars(text);
        text = this._convertDoubleAsterisks(text);

        const lines = text.split('\n').filter(line => line.trim());
        if (lines.length === 0) return '';

        const formatted = [];
        for (const line of lines) {
            const { text: stripped, isContinuation } = this._stripBulletMarker(line);

            if (isContinuation) {
                formatted.push(`  └ ${stripped}`);
            } else {
                formatted.push(`• ${stripped}`);
            }
        }

        return formatted.join('\n');
    }

    /**
     * Format SnK for customer display
     * Section headers use <b>Bold</b> style
     * All lines formatted with bullets, > lines as continuations
     * @param {Object} params - { termsAndConditions, warrantyTerms }
     * @returns {string} - Formatted HTML for display
     */
    formatForDisplay({ termsAndConditions = '', warrantyTerms = '' }) {
        const hasTerms = termsAndConditions && termsAndConditions.trim().length > 0;
        const hasWarranty = warrantyTerms && warrantyTerms.trim().length > 0;

        if (!hasTerms && !hasWarranty) {
            return '';
        }

        let message = '';

        // Terms & Conditions section
        if (hasTerms) {
            const formattedTerms = this._formatSection(termsAndConditions);
            message += '<b>Syarat & Ketentuan</b>\n';
            message += formattedTerms;
        }

        // Warranty section
        if (hasWarranty) {
            if (hasTerms) message += '\n\n';
            const formattedWarranty = this._formatSection(warrantyTerms);
            message += '<b>Ketentuan Garansi</b>\n';
            message += formattedWarranty;
        }

        return message.trim();
    }

    /**
     * Format SnK for admin preview (simple format)
     * @param {Object} params - { termsAndConditions, warrantyTerms }
     * @returns {string} - Formatted preview for admin
     */
    formatForPreview({ termsAndConditions = '', warrantyTerms = '' }) {
        const hasTerms = termsAndConditions && termsAndConditions.trim().length > 0;
        const hasWarranty = warrantyTerms && warrantyTerms.trim().length > 0;

        if (!hasTerms && !hasWarranty) {
            return '<code>Belum ada SnK diatur</code>';
        }

        let message = '';

        if (hasTerms) {
            message += '<b>📋 Syarat & Ketentuan:</b>\n';
            message += '<pre>' + termsAndConditions + '</pre>\n';
        }

        if (hasWarranty) {
            if (hasTerms) message += '\n';
            message += '<b>🛡️ Ketentuan Garansi:</b>\n';
            message += '<pre>' + warrantyTerms + '</pre>\n';
        }

        return message.trim();
    }

    /**
     * Combine terms and warranty for storage (adds separator if both exist)
     * @param {Object} params - { termsAndConditions, warrantyTerms }
     * @returns {string} - Combined text for storage
     */
    combineForStorage({ termsAndConditions = '', warrantyTerms = '' }) {
        const hasTerms = termsAndConditions && termsAndConditions.trim().length > 0;
        const hasWarranty = warrantyTerms && warrantyTerms.trim().length > 0;

        if (!hasTerms && !hasWarranty) return '';
        if (!hasWarranty) return termsAndConditions;
        if (!hasTerms) return warrantyTerms;

        return termsAndConditions.trim() + '\n===\n' + warrantyTerms.trim();
    }

    /**
     * Truncate text if too long for Telegram message limit
     * @param {string} text - Text to truncate
     * @param {number} maxLength - Maximum length
     * @returns {string} - Truncated text with indicator
     */
    truncate(text, maxLength = 4000) {
        if (!text || text.length <= maxLength) return text;

        return text.substring(0, maxLength - 30) + '\n\n...\n[Text dipotong karena terlalu panjang]';
    }
}

module.exports = new SnKFormatter();
