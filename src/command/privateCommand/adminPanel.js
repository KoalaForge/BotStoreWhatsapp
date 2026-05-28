const clc = require('cli-color');
const moment = require('moment-timezone');
const { requireAdmin } = require('../../middleware/waAuth');
const modeService = require('../../services/modeService');

/**
 * Build admin panel text for WhatsApp.
 * Pure text — no interactive elements.
 */
const getAdminPanelContent = () => {
    const isMulti = modeService.isMultiMode();

    let text = '*Admin Panel*\n\n';

    text += '*Produk*\n';
    text += '`.addproduct` `.delproduct` `.activateproduct` `.deactivateproduct`\n\n';

    text += '*Variant*\n';
    text += '`.addvariant` `.delvariant` `.activateproductvariant` `.deactivateproductvariant` `.setharga` `.setvariantsnk` `.delvariantsnk`\n\n';

    text += '*Tier Pricing (Grosir)*\n';
    text += '`.addtierpricing` `.deltierpricing` `.listtierpricing` `.cleartierpricing`\n\n';

    text += '*Stok*\n';
    text += '`.addstock` `.delstock` `.pullstock` `.setprofitstock`\n\n';

    text += '*Admin & User*\n';
    text += '`.addadmin` `.deleteadmin` `.listadmin` `.banned` `.unbanned`\n\n';

    text += '*Saldo*\n';
    text += '`.addbalance` `.subtractbalance` `.checkbalance`\n\n';

    text += '*Voucher*\n';
    text += '`.addvoucher` `.deletevoucher` `.activatevoucher` `.deactivatevoucher` `.listvoucher`\n\n';

    text += '*Transaksi & Pengaturan*\n';
    text += '`.checktransaction` `.rekap` `.rekapproduk` `.setproductprefix` `.settopupprefix` `.setfee`\n\n';

    if (isMulti) {
        text += '*Platform*\n';
        text += '`.topupplatform` `.saldoplatform`\n\n';
    }

    text += '*Cycle*\n';
    text += '`.cycle` `.cyclebulk` `.rekapcycle` `.ceksiklus` `.setcyclable` `.setcycleduration`\n\n';

    text += '*CS & Fitur*\n';
    text += '`.addcs` `.removecs` `.listcs` `.togglesaldo` `.togglewelcome` `.togglerestokinfo`\n\n';

    text += '*Group Settings*\n';
    text += '`.compactlist` `.autosuggest`\n\n';

    text += '*Whitelist*\n';
    text += '`.togglewhitelist` `.listwhitelist` `.approvewhitelist` `.rejectwhitelist` `.carawhitelist`\n\n';

    text += '*Lainnya*\n';
    text += '`.broadcast` `.stock` `.listproduk`\n\n';

    text += '_Ketik .cara* untuk tutorial (contoh: .caraaddproduct)_';

    return text;
};

/**
 * Admin Panel command (WhatsApp version).
 * Usage: .adminmenu
 */
const adminPanelCommand = async (ctx) => {
    try {
        if (!await requireAdmin(ctx)) return;
        await ctx.reply(getAdminPanelContent());
    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Something error in file command/privateCommand/adminPanel.js:  ${err.message}`));
    }
};

module.exports = adminPanelCommand;
module.exports.getAdminPanelContent = getAdminPanelContent;
