// Public commands
const startCommand = require('./start');
const helpCommand = require('./publicCommand/help');
const listProduct = require('./publicCommand/listProduct');
const stock = require('./publicCommand/stock');
const saldoCommand = require('./publicCommand/saldo');
const voucherCommand = require('./publicCommand/voucher');
const topupCommand = require('./publicCommand/topupCommand');
const buyCommand = require('./publicCommand/buyCommand');
const buyNowCommand = require('./publicCommand/buyNowCommand');
const { openGroupCommand, closeGroupCommand } = require('./publicCommand/openCloseGroupCommand');
const kickCommand = require('./publicCommand/kickCommand');
const { tagAllCommand, hideTagCommand } = require('./publicCommand/tagAllCommand');
const toggleCompactListCommand = require('./publicCommand/toggleCompactListCommand');
const toggleAutoSuggestCommand = require('./publicCommand/toggleAutoSuggestCommand');
const toggleShowLastRestockCommand = require('./publicCommand/toggleShowLastRestockCommand');
const {
    showTransactionHistory,
    showPurchaseHistory,
    showDepositHistory,
    exportPurchaseHistory,
    exportDepositHistory
} = require('./publicCommand/transactionHistory');

// Private commands — Product & Variant Management (implemented)
const addProduct = require('./privateCommand/addProduct');
const delProduct = require('./privateCommand/delProduct');
const activateProduct = require('./privateCommand/activateProduct');
const deactivateProduct = require('./privateCommand/deactivateProduct');
const addProductVariants = require('./privateCommand/addProductVariant');
const delProductVariant = require('./privateCommand/delProductVariant');
const activateProductVariant = require('./privateCommand/activateProductVariant');
const deactivateProductVariant = require('./privateCommand/deactivateProductVariant');
const setHarga = require('./privateCommand/setHarga');
const { setProductVariantSnk, handleSnkInput } = require('./privateCommand/setProductVariantSnk');
const delProductVariantSnk_cmd = require('./privateCommand/delProductVariantSnk');
const setProductPrefix = require('./privateCommand/setProductPrefix');
const addStockModule = require('./privateCommand/addStock');
const addStock = addStockModule;
const { handleStockDataInput } = addStockModule;

// Private commands — Stock Management
const delStockModule = require('./privateCommand/delStock');
const delStock = delStockModule;
const { handleDelStockDataInput } = delStockModule;
const pullStock = require('./privateCommand/pullStock');
const setProfitStockModule = require('./privateCommand/setProfitStock');
const setProfitStock = setProfitStockModule;
const { handleProfitStockDataInput } = setProfitStockModule;

// Private commands — Admin Management
const addAdmin = require('./privateCommand/addAdmin');
const deleteAdmin = require('./privateCommand/deleteAdmin');
const listAdmin = require('./privateCommand/listAdmin');

// Private commands — User Management
const bannedUser = require('./privateCommand/bannedUser');
const unbannedUser = require('./privateCommand/unbannedUser');

// Private commands — Balance Management
const addBalance = require('./privateCommand/addBalance');
const subtractBalance = require('./privateCommand/subtractBalance');
const checkBalance = require('./privateCommand/checkBalance');

// Private commands — Transaction
const checkTransaction = require('./privateCommand/checkTransaction');
const recapTransactions = require('./privateCommand/recapTransactions');

// Private commands — Admin Panel
const adminPanelCommand = require('./privateCommand/adminPanel');

// Private commands — Voucher Management
const addVoucher = require('./privateCommand/addVoucher');
const deleteVoucher = require('./privateCommand/deleteVoucher');
const activateVoucher = require('./privateCommand/activateVoucher');
const deactivateVoucher = require('./privateCommand/deactivateVoucher');
const listVoucher = require('./privateCommand/listVoucher');

// Private commands — Settings
const setTopupPrefix = require('./privateCommand/setTopupPrefix');
const setFee = require('./privateCommand/setFee');
const { toggleSaldo, toggleWelcome } = require('./privateCommand/toggleFeature');
const toggleWhitelist = require('./privateCommand/toggleWhitelist');
const { listWhitelist, approveWhitelist, rejectWhitelist } = require('./privateCommand/whitelistAdmin');
const caraWhitelist = require('./helpCommand/caraWhitelist');
const { banVariant, banProduct, unbanVariant, unbanProduct, listVariantBan } = require('./privateCommand/variantBanAdmin');
const { setProductWl, setVariantWl, listVariantWl, listProductWl, approveVariant, rejectVariant, approveProduct, rejectProduct } = require('./privateCommand/variantWhitelistAdmin');
const caraVariantBan = require('./helpCommand/caraVariantBan');
const caraVariantWhitelist = require('./helpCommand/caraVariantWhitelist');

// Private commands — CS Management
const csCommand = require('./publicCommand/cs');
const addCS = require('./privateCommand/addCS');
const removeCS = require('./privateCommand/removeCS');
const listCS = require('./privateCommand/listCS');

// Private commands — Platform Balance
const topupPlatform = require('./privateCommand/topupPlatform');
const saldoPlatform = require('./privateCommand/saldoPlatform');

// Private commands — Broadcast
const broadcastCommand = require('./privateCommand/broadcast');

// Private commands — Recap Product
const recapProduct = require('./privateCommand/recapProduct');

// Private commands — Export Recap
const exportRecap = require('../actions/exportRecap');

// Private commands — Cycle Management
const {
    cycleOrder: cycle,
    cyclebulkCommand: cycleBulk,
    rekapCycle: recapCycle,
    cekSiklus,
    setCyclable,
    setCycleDuration
} = require('./privateCommand/manageCycle');

// Private commands — Tier Pricing
const addTierPricing = require('./privateCommand/addTierPricing');
const delTierPricing = require('./privateCommand/delTierPricing');
const listTierPricing = require('./privateCommand/listTierPricing');
const clearTierPricing = require('./privateCommand/clearTierPricing');


// Help commands
const caraSetHarga = require('./helpCommand/caraSetHarga');
const caraAddProduct = require('./helpCommand/caraAddProduct');
const caraDelProduct = require('./helpCommand/caraDelProduct');
const caraDelVariant = require('./helpCommand/caraDelVariant');
const caraBroadcast = require('./helpCommand/caraBroadcast');
const caraAddStock = require('./helpCommand/caraAddStock');
const caraDelStock = require('./helpCommand/caraDelStock');
const caraAddVariant = require('./helpCommand/caraAddVariant');
const caraSetSnkVariant = require('./helpCommand/caraSetSnkVariant');
const caraDelVariantSnk = require('./helpCommand/caraDelVariantSnk');
const caraPullStock = require('./helpCommand/caraPullStock');
const caraSetProfitStock = require('./helpCommand/caraSetProfitStock');
const caraAddAdmin = require('./helpCommand/caraAddAdmin');
const caraDeleteAdmin = require('./helpCommand/caraDeleteAdmin');
const caraActivateProduct = require('./helpCommand/caraActivateProduct');
const caraActivateProductVariant = require('./helpCommand/caraActivateProductVariant');
const caraDeactivateProduct = require('./helpCommand/caraDeactivateProduct');
const caraDeactivateProductVariant = require('./helpCommand/caraDeactivateProductVariant');
const caraBannedUser = require('./helpCommand/caraBannedUser');
const caraUnbannedUser = require('./helpCommand/caraUnbannedUser');
const caraAddBalance = require('./helpCommand/caraAddBalance');
const caraSubtractBalance = require('./helpCommand/caraSubtractBalance');
const caraCheckBalance = require('./helpCommand/caraCheckBalance');
const caraCheckTransaction = require('./helpCommand/caraCheckTransaction');
const caraSetProductPrefix = require('./helpCommand/caraSetProductPrefix');
const caraSetTopupPrefix = require('./helpCommand/caraSetTopupPrefix');
const caraSetFee = require('./helpCommand/caraSetFee');
const caraVoucher = require('./helpCommand/caraVoucher');
const caraCS = require('./helpCommand/caraCS');
const caraToggleFeature = require('./helpCommand/caraToggleFeature');
const caraToggleRestokInfo = require('./helpCommand/caraToggleRestokInfo');
const caraRecapProduct = require('./helpCommand/caraRecapProduct');
const delProductVariantSnk = delProductVariantSnk_cmd;
const caraCycle = require('./helpCommand/caraCycle');
const caraTierPricing = require('./helpCommand/caraTierPricing');

module.exports = {
    // Public commands (functional)
    startCommand,
    helpCommand,
    listProduct,
    stock,
    saldoCommand,
    voucherCommand,
    topupCommand,
    buyCommand,
    buyNowCommand,
    openGroupCommand,
    closeGroupCommand,
    kickCommand,
    tagAllCommand,
    hideTagCommand,
    toggleCompactListCommand,
    toggleAutoSuggestCommand,
    toggleShowLastRestockCommand,
    showTransactionHistory,
    showPurchaseHistory,
    showDepositHistory,
    exportPurchaseHistory,
    exportDepositHistory,
    transactionHistory: {
        showTransactionHistory,
        showPurchaseHistory,
        showDepositHistory,
        exportPurchaseHistory,
        exportDepositHistory
    },

    // Private commands (Phase 2 stubs)
    addStock,
    setProductVariantSnk,
    addProduct,
    broadcastCommand,
    addProductVariants,
    adminPanelCommand,
    delStock,
    delProduct,
    delProductVariant,
    setHarga,
    pullStock,
    recapTransactions,
    addAdmin,
    deleteAdmin,
    listAdmin,
    activateProduct,
    activateProductVariant,
    deactivateProduct,
    deactivateProductVariant,
    bannedUser,
    unbannedUser,
    addBalance,
    subtractBalance,
    checkBalance,
    checkTransaction,
    setProductPrefix,
    setTopupPrefix,
    setFee,
    setProfitStock,
    addVoucher,
    deleteVoucher,
    activateVoucher,
    deactivateVoucher,
    listVoucher,
    topupPlatform,
    saldoPlatform,
    csCommand,
    addCS,
    removeCS,
    listCS,
    toggleSaldo,
    toggleWelcome,
    toggleWhitelist,
    listWhitelist,
    approveWhitelist,
    rejectWhitelist,
    caraWhitelist,
    banVariant,
    banProduct,
    unbanVariant,
    unbanProduct,
    listVariantBan,
    setProductWl,
    setVariantWl,
    listVariantWl,
    listProductWl,
    approveVariant,
    rejectVariant,
    approveProduct,
    rejectProduct,
    caraVariantBan,
    caraVariantWhitelist,
    recapProduct,
    cycle,
    cycleBulk,
    recapCycle,
    cekSiklus,
    setCyclable,
    setCycleDuration,
    addTierPricing,
    delTierPricing,
    listTierPricing,
    clearTierPricing,

    // Help commands
    caraSetHarga,
    caraAddProduct,
    caraDelProduct,
    caraDelVariant,
    caraBroadcast,
    caraAddStock,
    caraDelStock,
    caraAddVariant,
    caraSetSnkVariant,
    delProductVariantSnk,
    caraDelVariantSnk,
    caraPullStock,
    caraSetProfitStock,
    caraAddAdmin,
    caraDeleteAdmin,
    caraActivateProduct,
    caraActivateProductVariant,
    caraDeactivateProduct,
    caraDeactivateProductVariant,
    caraBannedUser,
    caraUnbannedUser,
    caraAddBalance,
    caraSubtractBalance,
    caraCheckBalance,
    caraCheckTransaction,
    caraSetProductPrefix,
    caraSetTopupPrefix,
    caraSetFee,
    caraVoucher,
    caraCS,
    caraToggleFeature,
    caraToggleRestokInfo,
    caraRecapProduct,
    caraCycle,
    caraTierPricing,

    // Export handlers
    exportRecap,

    // Multi-step input handlers (for router integration)
    handleSnkInput,
    handleStockDataInput,
    handleDelStockDataInput,
    handleProfitStockDataInput,
};
