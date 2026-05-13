const { formatMoney } = require('../database/models/money');

/**
 * Build product menu for WhatsApp.
 * Returns formatted text with numbered product list instead of reply_markup keyboard.
 *
 * @param {Array} products - Array of product objects
 * @param {number} balance - User balance
 * @returns {{ text: string, menuText: string }}
 */
const buildProductMenu = (products, balance = 0) => {
    let text = '';

    if (!products || products.length === 0) {
        text += '_Belum ada produk tersedia._\n';
    } else {
        for (let i = 0; i < products.length; i++) {
            text += `*${i + 1}.* ${products[i].name || products[i].productName || products[i]}\n`;
        }
    }

    const menuText = [
        `*Saldo:* ${formatMoney(balance)}`,
        '',
        '_Ketik angka produk untuk melihat detail._',
        '',
        'Riwayat Transaksi — ketik *riwayat*',
        'Cara Order — ketik *cara order*',
        'Pusat Bantuan — ketik *bantuan*'
    ].join('\n');

    return { text, menuText };
};

module.exports = {
    buildProductMenu
};
