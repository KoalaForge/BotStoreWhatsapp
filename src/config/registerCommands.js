const command = require('../command/exportCommand');

/**
 * Stub handler for commands not yet implemented.
 * Returns a reply informing the user the feature is coming soon.
 */
const stub = (name) => async (ctx) => {
    await ctx.reply(`_Command .${name} belum tersedia. Segera hadir di update berikutnya._`);
};

/**
 * Safely register a command — if handler is null/undefined, use a stub.
 */
function safeCommand(router, names, handler) {
    const nameList = Array.isArray(names) ? names : [names];
    router.command(names, handler || stub(nameList[0]));
}

/**
 * Registers all bot commands on the WhatsApp message router.
 * Commands use dot (.) prefix instead of slash (/).
 *
 * @param {MessageRouter} router - The WhatsApp message router
 */
function registerCommands(router) {
    // ============================================
    // CORE COMMANDS
    // ============================================
    router.start(command.startCommand);
    router.command('help', command.helpCommand);
    router.command(['caraorder', 'cara-order'], command.helpCommand);
    router.command(['saldo', 'balance'], command.saldoCommand);
    router.command(['stok', 'stock'], command.stock);
    router.command(['voucher', 'vouchers'], command.voucherCommand);
    router.command(['riwayat', 'history'], command.showTransactionHistory);
    router.command(['listproduk', 'listproduct', 'produk', 'list'], command.listProduct);
    router.command('topup', command.topupCommand);
    router.command('buy', command.buyCommand);
    router.command('buynow', command.buyNowCommand);
    router.command(['open', 'opengroup', 'openchat'], command.openGroupCommand);
    router.command(['close', 'closegroup', 'closechat'], command.closeGroupCommand);
    router.command('kick', command.kickCommand);
    router.command(['tagall', 'tag'], command.tagAllCommand);
    router.command(['hidetag', 'htag'], command.hideTagCommand);

    // ============================================
    // PRODUCT MANAGEMENT COMMANDS
    // ============================================
    router.command(['addproduct', 'addproduk'], command.addProduct);
    router.command(['addvariant', 'addproductvariant', 'addvariants'], command.addProductVariants);
    router.command(['delproduct', 'delproduk'], command.delProduct);
    router.command(['delvariant', 'delproductvariant'], command.delProductVariant);
    router.command(['activateproduct', 'activateproduk'], command.activateProduct);
    router.command(['deactivateproduct', 'deactivateproduk'], command.deactivateProduct);
    router.command(['activateproductvariant', 'activateprodukvariant'], command.activateProductVariant);
    router.command(['deactivateproductvariant', 'deactivateprodukvariant'], command.deactivateProductVariant);
    router.command('setharga', command.setHarga);
    router.command(['setvariantsnk', 'setproductvariantsnk'], command.setProductVariantSnk);
    router.command(['delvariantsnk', 'hapusvariantsnk'], command.delProductVariantSnk);
    router.command('setproductprefix', command.setProductPrefix);

    // ============================================
    // STOCK MANAGEMENT COMMANDS
    // ============================================
    router.command(['addstock', 'addstok'], command.addStock);
    safeCommand(router, ['delstock', 'delstocks'], command.delStock);
    safeCommand(router, ['pullstock', 'pullstok'], command.pullStock);
    safeCommand(router, ['setprofitstock', 'setprofitstok'], command.setProfitStock);

    // ============================================
    // ADMIN MANAGEMENT COMMANDS
    // ============================================
    safeCommand(router, 'addadmin', command.addAdmin);
    safeCommand(router, 'deleteadmin', command.deleteAdmin);
    safeCommand(router, 'listadmin', command.listAdmin);
    safeCommand(router, 'adminmenu', command.adminPanelCommand);

    // ============================================
    // TRANSACTION & BALANCE COMMANDS
    // ============================================
    safeCommand(router, ['checktransaction', 'cektransaksi', 'checktx'], command.checkTransaction);
    safeCommand(router, ['recap', 'rekap'], command.recapTransactions);
    safeCommand(router, ['addbalance', 'addsaldo'], command.addBalance);
    safeCommand(router, ['subtractbalance', 'kurangisaldo'], command.subtractBalance);
    safeCommand(router, ['checkbalance', 'ceksaldo'], command.checkBalance);
    safeCommand(router, 'settopupprefix', command.setTopupPrefix);
    safeCommand(router, ['setfee', 'setgatewayFee'], command.setFee);

    // ============================================
    // VOUCHER MANAGEMENT COMMANDS
    // ============================================
    safeCommand(router, ['addvoucher', 'createvoucher'], command.addVoucher);
    safeCommand(router, ['deletevoucher', 'delvoucher'], command.deleteVoucher);
    safeCommand(router, ['activatevoucher'], command.activateVoucher);
    safeCommand(router, ['deactivatevoucher'], command.deactivateVoucher);
    safeCommand(router, ['listvoucher', 'listvouchers'], command.listVoucher);

    // ============================================
    // USER MANAGEMENT COMMANDS
    // ============================================
    safeCommand(router, 'banned', command.bannedUser);
    safeCommand(router, 'unbanned', command.unbannedUser);

    // ============================================
    // CS, TOGGLES, BROADCAST
    // ============================================
    safeCommand(router, 'cs', command.csCommand);
    safeCommand(router, ['addcs', 'tambahcs'], command.addCS);
    safeCommand(router, ['removecs', 'hapuscs'], command.removeCS);
    safeCommand(router, ['listcs', 'daftarcs'], command.listCS);
    safeCommand(router, ['togglesaldo', 'setsaldo'], command.toggleSaldo);
    safeCommand(router, ['togglewelcome', 'setwelcome'], command.toggleWelcome);
    safeCommand(router, ['compactlist', 'togglecompactlist'], command.toggleCompactListCommand);
    safeCommand(router, ['autosuggest', 'toggleautosuggest'], command.toggleAutoSuggestCommand);
    safeCommand(router, ['togglerestokinfo', 'togglelastrestock', 'togglerestock'], command.toggleShowLastRestockCommand);
    safeCommand(router, 'broadcast', command.broadcastCommand);

    // ============================================
    // WHITELIST MODE COMMANDS
    // ============================================
    safeCommand(router, ['togglewhitelist', 'setwhitelist'], command.toggleWhitelist);
    safeCommand(router, ['listwhitelist', 'daftarwhitelist'], command.listWhitelist);
    safeCommand(router, ['approvewhitelist', 'whitelistapprove', 'approve'], command.approveWhitelist);
    safeCommand(router, ['rejectwhitelist', 'whitelistreject', 'reject'], command.rejectWhitelist);
    safeCommand(router, ['carawhitelist'], command.caraWhitelist);

    // ============================================
    // PLATFORM BALANCE COMMANDS (Phase 5 - stubs)
    // ============================================
    safeCommand(router, ['topupplatform', 'topupmodal'], command.topupPlatform);
    safeCommand(router, ['saldoplatform', 'ceksaldoplatform'], command.saldoPlatform);

    // ============================================
    // RECAP & CYCLE COMMANDS
    // ============================================
    safeCommand(router, ['rekapproduk', 'recapproduct', 'rekapproduct'], command.recapProduct);
    safeCommand(router, ['cycle'], command.cycle);
    safeCommand(router, ['cyclebulk'], command.cycleBulk);
    safeCommand(router, ['rekapcycle'], command.recapCycle);
    safeCommand(router, ['ceksiklus'], command.cekSiklus);
    safeCommand(router, ['setcyclable'], command.setCyclable);
    safeCommand(router, ['setcycleduration'], command.setCycleDuration);

    // ============================================
    // TIER PRICING COMMANDS
    // ============================================
    safeCommand(router, ['addtierpricing', 'addgrosir'], command.addTierPricing);
    safeCommand(router, ['deltierpricing', 'delgrosir', 'hapusgrosir'], command.delTierPricing);
    safeCommand(router, ['listtierpricing', 'listgrosir', 'lihatgrosir'], command.listTierPricing);
    safeCommand(router, ['cleartierpricing', 'cleargrosir'], command.clearTierPricing);

    // ============================================
    // HELP COMMANDS (cara*)
    // ============================================
    router.command(['caraaddproduct', 'caraaddproduk'], command.caraAddProduct);
    router.command(['caradelproduct', 'caradelproduk'], command.caraDelProduct);
    router.command(['caraaddvariant', 'caraaddproductvariant'], command.caraAddVariant);
    router.command(['caradelvariant', 'caradelproductvariant'], command.caraDelVariant);
    router.command(['caraactivateproduct', 'caraactivateproduk'], command.caraActivateProduct);
    router.command(['caradeactivateproduct', 'caradeactivateproduk'], command.caraDeactivateProduct);
    router.command(['caraactivateproductvariant'], command.caraActivateProductVariant);
    router.command(['caradeactivateproductvariant'], command.caraDeactivateProductVariant);
    router.command('carasetharga', command.caraSetHarga);
    router.command(['carasetvariantsnk', 'carasetsnkvariant', 'carasetproductvariantsnk'], command.caraSetSnkVariant);
    router.command(['caradelvariantsnk', 'carahapusvariantsnk'], command.caraDelVariantSnk);
    router.command('carasetproductprefix', command.caraSetProductPrefix);
    router.command(['caraaddstock', 'caraaddstok'], command.caraAddStock);
    router.command(['caradelstock', 'caradelstok'], command.caraDelStock);
    router.command(['carapullstock', 'carapullstok'], command.caraPullStock);
    router.command(['carasetprofitstock', 'carasetprofitstok'], command.caraSetProfitStock);
    router.command('caraaddadmin', command.caraAddAdmin);
    router.command(['caradeleteadmin', 'carahapusadmin'], command.caraDeleteAdmin);
    router.command(['carabanneduser', 'carabanned'], command.caraBannedUser);
    router.command(['caraunbanneduser', 'caraunbanned'], command.caraUnbannedUser);
    router.command(['caraaddbalance', 'caraaddsaldo'], command.caraAddBalance);
    router.command(['carasubtractbalance', 'carakurangisaldo'], command.caraSubtractBalance);
    router.command(['caracheckbalance', 'caraceksaldo'], command.caraCheckBalance);
    router.command(['carachecktransaction', 'caracektransaksi'], command.caraCheckTransaction);
    router.command('carasettopupprefix', command.caraSetTopupPrefix);
    router.command(['carasetfee', 'carasetgatewayfee'], command.caraSetFee);
    router.command(['caravoucher'], command.caraVoucher);
    router.command(['caracs'], command.caraCS);
    router.command(['caratoggle', 'caratogglefitur'], command.caraToggleFeature);
    router.command(['caratogglerestokinfo', 'caratogglelastrestock', 'cararestokinfo'], command.caraToggleRestokInfo);
    router.command('caracycle', command.caraCycle);
    router.command(['carabroadcast'], command.caraBroadcast);
    router.command(['caratierpricing', 'caragrosir'], command.caraTierPricing);
    router.command(['cararekapproduk', 'cararecapproduct'], command.caraRecapProduct);
}

module.exports = registerCommands;
