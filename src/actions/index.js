// Export all WhatsApp action handlers (order flow)
const showPesanan = require('./showPesanan');
const plusMinesStockProduct = require('./plusMinesStockProduct');
const cancelOrder = require('./cancelOrder');
const showAllProductVariant = require('./showAllProductVariant');
const backToProductList = require('./backToProductList');
const handleProductList = require('./handleProductList');
const handleProductVariantRefresh = require('./handleProductVariantRefresh');

// Payment actions
const payWithQris = require('./payWithQris');
const handlePayWithBalance = require('./handlePayWithBalance');
const confirmPayBalance = require('./confirmPayBalance');
const cancelPayBalance = require('./cancelPayBalance');
const handleTopUpNominal = require('./handleTopUpNominal');
const handleTopUpCustom = require('./handleTopUpCustom');
const handleCustomTopUpInput = require('./handleCustomTopUpInput');
const cancelTopUp = require('./cancelTopUp');
const handleSaldoButton = require('./handleSaldoButton');

// Voucher actions
const handleApplyVoucherRequest = require('./applyVoucherRequest');
const handleVoucherCodeInput = require('./voucherCodeInput');
const handleRemoveVoucher = require('./removeVoucher');

const voucherActions = {
    handleApplyVoucherRequest,
    handleVoucherCodeInput,
    handleRemoveVoucher
};

// Buyer notes actions
const handleBuyerNotes = require('./handleBuyerNotes');


module.exports = {
    // Action handlers
    showPesanan,
    plusMinesStockProduct,
    cancelOrder,
    showAllProductVariant,
    backToProductList,
    handleProductList,
    handleProductVariantRefresh,
    voucherActions,
    handleBuyerNotes,

    // Payment actions
    payWithQris,
    handlePayWithBalance,
    confirmPayBalance,
    cancelPayBalance,
    handleTopUpNominal,
    handleTopUpCustom,
    handleCustomTopUpInput,
    cancelTopUp,
    handleSaldoButton,

};
