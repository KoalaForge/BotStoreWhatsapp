/**
 * Order Action Menu — Text-based
 *
 * Builds the numbered text menu appended to order confirmation screens.
 * Numbers shift dynamically when saldo is disabled or voucher/notes state changes.
 */

/**
 * Build the order action menu as plain text.
 *
 * @param {Object} opts
 * @param {boolean} [opts.saldoEnabled=true] - Whether balance payment is available
 * @param {string|null} [opts.voucherCode=null] - Applied voucher code (shows "Hapus Voucher" if set)
 * @param {string|null} [opts.buyerNotes=null] - Buyer notes (shows "Ubah/Hapus Catatan" if set)
 * @returns {{ menuText: string, actionMap: Object.<number, string> }}
 *   menuText: formatted WhatsApp markdown string
 *   actionMap: maps menu number → action identifier for router
 */
/**
 * Build the raw list of order action items (label + action identifier).
 *
 * Used both by `buildOrderMenuText` (numbered text fallback) and by interactive
 * button flows that need to render the same actions as nativeFlow quick_reply.
 *
 * @param {Object} opts
 * @param {boolean} [opts.saldoEnabled=true]
 * @param {string|null} [opts.voucherCode=null]
 * @param {string|null} [opts.buyerNotes=null]
 * @returns {Array<{label: string, action: string}>}
 */
function buildOrderMenuItems({ saldoEnabled = true, voucherCode = null, buyerNotes = null } = {}) {
    const items = [];

    items.push({ label: 'Bayar QRIS', action: 'pay-with-qris' });
    if (saldoEnabled) {
        items.push({ label: 'Bayar Saldo', action: 'pay-with-balance' });
    }
    items.push({ label: 'Ubah Jumlah', action: 'change-quantity' });

    if (voucherCode) {
        items.push({ label: 'Hapus Voucher', action: 'remove-voucher' });
    } else {
        items.push({ label: 'Voucher', action: 'apply-voucher' });
    }

    if (buyerNotes) {
        items.push({ label: 'Ubah/Hapus Catatan', action: 'edit-buyer-notes' });
    } else {
        items.push({ label: 'Catatan Seller', action: 'add-buyer-notes' });
    }

    return items;
}

function buildOrderMenuText({ saldoEnabled = true, voucherCode = null, buyerNotes = null } = {}) {
    const items = buildOrderMenuItems({ saldoEnabled, voucherCode, buyerNotes });

    // Build numbered list (1-based) + "0. Kembali" at the end
    const actionMap = {};
    const lines = [];
    items.forEach((item, i) => {
        const num = i + 1;
        actionMap[num] = item.action;
        lines.push(`*${num}.* ${item.label}`);
    });

    // Back is always 0
    actionMap[0] = 'back';
    lines.push(`*0.* Kembali`);

    const menuText = '\n\n' + lines.join('\n') + '\n\n_Ketik nomor untuk memilih_';

    return { menuText, actionMap };
}

module.exports = { buildOrderMenuText, buildOrderMenuItems };
