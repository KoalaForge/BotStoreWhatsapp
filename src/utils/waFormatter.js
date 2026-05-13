/**
 * WhatsApp Formatter
 *
 * Converts HTML-formatted messages (used in Telegram) to WhatsApp markdown.
 * Also provides direct WhatsApp markdown formatting helpers.
 *
 * Telegram HTML → WhatsApp Markdown Mapping:
 * <b>text</b>           → *text*
 * <strong>text</strong>  → *text*
 * <i>text</i>           → _text_
 * <em>text</em>         → _text_
 * <code>text</code>     → `text`
 * <pre>text</pre>       → ```text```
 * <s>text</s>           → ~text~
 * <blockquote>text</blockquote> → > text (each line)
 * <a href="url">text</a>       → text (url)
 * <br> / <br/>          → \n
 * All other tags        → stripped
 */

/**
 * Convert HTML-formatted text to WhatsApp markdown.
 * @param {string} html - HTML-formatted text
 * @returns {string} WhatsApp markdown text
 */
function htmlToWhatsApp(html) {
    if (!html) return '';

    let text = html;

    // Handle <br> tags first
    text = text.replace(/<br\s*\/?>/gi, '\n');

    // Bold: <b> or <strong>
    text = text.replace(/<\/?(?:b|strong)>/gi, '*');

    // Italic: <i> or <em>
    text = text.replace(/<\/?(?:i|em)>/gi, '_');

    // Strikethrough: <s> or <strike> or <del>
    text = text.replace(/<\/?(?:s|strike|del)>/gi, '~');

    // Monospace: <code>
    text = text.replace(/<\/?code>/gi, '`');

    // Pre-formatted: <pre>
    text = text.replace(/<pre>/gi, '```\n');
    text = text.replace(/<\/pre>/gi, '\n```');

    // Blockquote: <blockquote>text</blockquote> → prefix each line with >
    text = text.replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi, (match, content) => {
        const lines = content.trim().split('\n');
        return lines.map(line => `> ${line}`).join('\n');
    });

    // Links: <a href="url">text</a> → text (url)
    text = text.replace(/<a\s+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, '$2 ($1)');

    // Strip all remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&nbsp;/g, ' ');

    // Clean up excessive whitespace (but preserve intentional newlines)
    text = text.replace(/\n{3,}/g, '\n\n');

    return text.trim();
}

// ==========================================
// Direct WhatsApp Markdown Helpers
// ==========================================

function bold(text) { return `*${text}*`; }
function italic(text) { return `_${text}_`; }
function mono(text) { return `\`${text}\``; }
function strike(text) { return `~${text}~`; }
function pre(text) { return `\`\`\`\n${text}\n\`\`\``; }
function quote(text) {
    return text.split('\n').map(line => `> ${line}`).join('\n');
}

/**
 * Format a labeled value pair.
 * Example: formatField("Produk", "Netflix") → "*Produk:* Netflix"
 */
function formatField(label, value) {
    return `*${label}:* ${value}`;
}

/**
 * Format a header line (bold, centered-ish).
 */
function formatHeader(text) {
    return `*${text}*`;
}

/**
 * Format a section divider.
 */
function divider() {
    return '━━━━━━━━━━━━━━━━━━━━━';
}

/**
 * Format currency (Indonesian Rupiah).
 */
function formatCurrency(amount) {
    return `Rp ${Number(amount).toLocaleString('id-ID')}`;
}

/**
 * Build a numbered list from items.
 * @param {string[]} items - Array of item strings
 * @param {number} [startIndex=1] - Starting number
 * @returns {string}
 */
function numberedList(items, startIndex = 1) {
    return items.map((item, i) => `${startIndex + i}. ${item}`).join('\n');
}

module.exports = {
    htmlToWhatsApp,
    bold,
    italic,
    mono,
    strike,
    pre,
    quote,
    formatField,
    formatHeader,
    divider,
    formatCurrency,
    numberedList
};
