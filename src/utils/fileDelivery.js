/**
 * WhatsApp File Delivery Utility
 *
 * Handles sending order data as files via Baileys WhatsApp socket.
 * No temp files needed — sends Buffer directly.
 */

const { formatMoney } = require('../database/models/money');

/**
 * Threshold quantity to switch to file delivery
 */
const FILE_DELIVERY_THRESHOLD = 5;

/**
 * WhatsApp text message limit (chars). Pesan di atas ini bisa gagal terkirim.
 * Safe limit memberi ruang aman di bawah batas keras.
 */
const MESSAGE_CHAR_LIMIT = 65536;
const MESSAGE_SAFE_LIMIT = 65000;

/**
 * Generate file content for order data with separator per variant
 * @param {Object} params
 * @param {string} params.transactionId - Transaction ID
 * @param {string} params.productName - Product name
 * @param {string} params.variantName - Variant name
 * @param {string} params.orderData - Raw order data (newline separated)
 * @param {number} params.orderQuantity - Order quantity
 * @returns {string} - Formatted file content
 */
function generateFileContent({
    transactionId,
    productName,
    variantName,
    orderData,
    orderQuantity
}) {
    const lines = [];

    // Header
    lines.push('═══════════════════════════════════════════════════');
    lines.push(`  DETAIL PEMBELIAN - ${transactionId}`);
    lines.push('═══════════════════════════════════════════════════');
    lines.push('');
    lines.push(`Produk    : ${productName}`);
    lines.push(`Variant   : ${variantName}`);
    lines.push(`Quantity  : ${orderQuantity}`);
    lines.push('');
    lines.push('───────────────────────────────────────────────────');
    lines.push('  DATA PEMBELIAN');
    lines.push('───────────────────────────────────────────────────');
    lines.push('');

    // Parse order data
    if (orderData) {
        const accounts = orderData.split('\n').filter(line => line.trim());

        accounts.forEach((account) => {
            if (account.includes(',')) {
                const parts = account.split(',');
                parts.forEach(part => lines.push(part.trim()));
            } else {
                lines.push(account);
            }
            lines.push('');
        });
    }

    // Footer
    lines.push('───────────────────────────────────────────────────');
    lines.push('Harap simpan file ini sebagai bukti pembelian.');
    lines.push('File ini dapat digunakan untuk klaim garansi.');
    lines.push('═══════════════════════════════════════════════════');

    return lines.join('\n');
}

/**
 * Send order data as file via Baileys WhatsApp socket.
 * Sends a Buffer directly — no temp file needed.
 *
 * @param {object} sock - Baileys WebSocket connection
 * @param {string} jid - WhatsApp JID (recipient)
 * @param {Object} params
 * @param {string} params.transactionId - Transaction ID
 * @param {string} params.productName - Product name
 * @param {string} params.variantName - Variant name
 * @param {string} params.orderData - Raw order data
 * @param {number} params.orderQuantity - Order quantity
 * @param {string} [params.caption] - Optional caption
 * @returns {Promise<void>}
 */
async function sendOrderDataAsFile(sock, jid, {
    transactionId,
    productName,
    variantName,
    orderData,
    orderQuantity,
    caption = null
}) {
    const content = generateFileContent({
        transactionId,
        productName,
        variantName,
        orderData,
        orderQuantity
    });

    const buffer = Buffer.from(content, 'utf-8');
    const fileName = `${transactionId}.txt`;

    await sock.sendMessage(jid, {
        document: buffer,
        fileName,
        mimetype: 'text/plain',
        caption: caption || `Data pembelian untuk transaksi \`${transactionId}\``
    });
}

/**
 * Check if order should be delivered as file
 * @param {number} orderQuantity - Order quantity
 * @returns {boolean}
 */
function shouldDeliverAsFile(orderQuantity) {
    return orderQuantity > FILE_DELIVERY_THRESHOLD;
}

/**
 * Check if a rendered message would exceed WhatsApp's safe length limit.
 * Dipakai untuk fallback ke file walau quantity kecil tapi datanya panjang.
 * @param {string} text - Rendered message text
 * @returns {boolean}
 */
function exceedsMessageLimit(text) {
    return (text?.length ?? 0) > MESSAGE_SAFE_LIMIT;
}

module.exports = {
    FILE_DELIVERY_THRESHOLD,
    MESSAGE_CHAR_LIMIT,
    MESSAGE_SAFE_LIMIT,
    generateFileContent,
    sendOrderDataAsFile,
    shouldDeliverAsFile,
    exceedsMessageLimit
};
