const SAFE_PATTERNS = [
    /stok tidak tersedia/i,
    /stok tidak cukup/i,
    /stock habis/i,
    /stock tidak tersedia/i,
    /not found/i,
    /tidak/i,
    /voucher/i,
    /insufficient/i,
    /saldo/i,
    /already/i,
    /belum/i,
    /habis/i,
    /please retry/i,
    /silakan/i,
    /kode/i,
    /pesanan tidak ditemukan/i,
    /transaksi/i,
    /harga/i,
    /minimum/i,
    /pembeli lain/i,
];

const GENERIC_MESSAGE = 'Terjadi kesalahan. Silakan coba lagi atau hubungi admin.';

function sanitizeErrorMessage(err) {
    const message = typeof err === 'string' ? err : (err?.message || '');
    for (const pattern of SAFE_PATTERNS) {
        if (pattern.test(message)) return message;
    }
    return GENERIC_MESSAGE;
}

/**
 * Check if a MongoDB error is a duplicate key error (E11000).
 * @param {Error} err
 * @returns {boolean}
 */
function isDuplicateKeyError(err) {
    const message = err?.message || '';
    return message.includes('E11000') || err?.code === 11000;
}

module.exports = { sanitizeErrorMessage, isDuplicateKeyError };
