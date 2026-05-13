const axios = require('axios');
const moment = require('moment-timezone');
const paymentGatewayFactory = require('./payment/PaymentGatewayFactory');
const gatewayResolverService = require('./payment/GatewayResolverService');
const modeService = require('./modeService');
const transactionService = require('./transactionService');
const settingsService = require('./settingsService');
const { formatMoney } = require('../database/models/money');
const TransactionRepository = require('../repositories/TransactionRepository');

class WaQRISService {
    constructor() {
        this.paymentGateway = null;
    }

    /**
     * Resolve payment gateway based on mode and context.
     * - SINGLE mode: cached singleton from .env
     * - MULTI mode: dynamic per-owner resolution via GatewayResolverService
     * @param {Object|null} ctx - Context with repositoryContext (for ownerId in MULTI mode)
     * @returns {Promise<{gateway: BasePaymentGateway, feeConfig: Object|null, paymentMethodCode: string}>}
     * @private
     */
    async _resolvePaymentGateway(ctx = null) {
        if (modeService.isSingleMode()) {
            return this._envFallback();
        }

        const ownerId = ctx?.repositoryContext?.ownerId;

        if (!ownerId) {
            return this._envFallback();
        }
        return await gatewayResolverService.resolveGateway(ownerId);
    }

    /**
     * .env fallback for when ownerId is not available in MULTI mode
     * @returns {{gateway: BasePaymentGateway, feeConfig: null, paymentMethodCode: string}}
     * @private
     */
    _envFallback() {
        if (!this.paymentGateway) {
            this.paymentGateway = paymentGatewayFactory.createGateway();
        }
        return {
            gateway: this.paymentGateway,
            feeConfig: null,
            paymentMethodCode: this.paymentGateway.getPaymentMethodCode()
        };
    }

    /**
     * Calculate payment gateway fee based on settings.
     * When feeConfig is provided (from DB), uses its fee/feeType.
     * Otherwise falls back to gateway.getFeePercentage() (.env behavior).
     * @param {number} amount - Original amount
     * @param {BasePaymentGateway} gateway - Payment gateway instance
     * @param {Object|null} ctx - Context for accessing settings
     * @param {Object|null} feeConfig - Fee config from GatewayResolverService
     * @param {boolean} honorFeePaidBy - Whether to check /setfee setting
     * @returns {Promise<{fee: number, totalAmount: number, customerPays: number, feeDisplay: Object}>}
     * @private
     */
    async _calculateGatewayFee(amount, gateway, ctx = null, feeConfig = null, honorFeePaidBy = true) {
        const { fee, feeDisplay } = gateway.requiresUniqueCode
            ? await this._computeFeeWithCollisionCheck(amount, gateway, feeConfig, ctx)
            : this._computeFee(amount, gateway, feeConfig);

        let feePaidBy = 'customer';
        if (honorFeePaidBy) {
            const settings = await settingsService.getSettings(ctx);
            feePaidBy = settings?.feePaidBy || 'customer';
        }

        const customerPays = feePaidBy === 'merchant' ? amount : amount + fee;

        return {
            fee,
            totalAmount: amount + fee,
            customerPays,
            feeDisplay
        };
    }

    /**
     * Generate a unique fee code for gateways that use amount-based transaction matching.
     * Retries up to 10 times to avoid collisions.
     * @private
     */
    async _computeFeeWithCollisionCheck(amount, gateway, feeConfig, ctx) {
        const context = ctx?.repositoryContext || {};
        const transactionRepo = TransactionRepository;
        const paymentMethodCode = gateway.getPaymentMethodCode();

        for (let attempt = 0; attempt < 10; attempt++) {
            const result = gateway.computeFee(amount);
            const candidateTotal = amount + result.fee;

            const collision = await transactionRepo.findOne(context, {
                totalPrice: candidateTotal,
                payment_method_code: paymentMethodCode,
                isSuccess: false,
                isCanceled: false
            });

            if (!collision) return result;
        }

        throw new Error('Tidak dapat memproses pembayaran saat ini, coba beberapa saat lagi.');
    }

    /**
     * Compute fee amount and display info from feeConfig or gateway defaults.
     * @private
     */
    _computeFee(amount, gateway, feeConfig) {
        if (!feeConfig || feeConfig.fee == null) {
            if (typeof gateway.computeFee === 'function') {
                return gateway.computeFee(amount);
            }

            const feePercentage = gateway.getFeePercentage();
            const feeFixed = gateway.getFeeFixed ? gateway.getFeeFixed() : 0;
            const fee = Math.ceil(amount * feePercentage) + feeFixed;
            return {
                fee,
                feeDisplay: {
                    percentage: feePercentage > 0 ? feePercentage : null,
                    fixed: feeFixed > 0 ? feeFixed : null
                }
            };
        }

        if (feeConfig.feeType === 'percentage') {
            const feeFixed = feeConfig.feeFixed || 0;
            const fee = Math.ceil(amount * feeConfig.fee / 100) + feeFixed;
            return {
                fee,
                feeDisplay: {
                    percentage: feeConfig.fee / 100,
                    fixed: feeFixed > 0 ? feeFixed : null
                }
            };
        }

        return {
            fee: Math.round(feeConfig.fee),
            feeDisplay: { percentage: null, fixed: feeConfig.fee }
        };
    }

    /**
     * Validate amount against min/max from payment method config.
     * @private
     */
    _validateAmount(amount, feeConfig) {
        if (!feeConfig) return;

        if (feeConfig.minAmount != null && feeConfig.minAmount > 0 && amount < feeConfig.minAmount) {
            throw new Error(`Nominal terlalu kecil. Minimal transaksi adalah ${formatMoney(feeConfig.minAmount)}`);
        }

        if (feeConfig.maxAmount != null && feeConfig.maxAmount > 0 && amount > feeConfig.maxAmount) {
            throw new Error(`Nominal terlalu besar. Maksimal transaksi adalah ${formatMoney(feeConfig.maxAmount)}`);
        }
    }

    /**
     * Format fee label for display messages.
     * @private
     */
    _formatFeeLabel(feeDisplay) {
        if (!feeDisplay) return '';
        const { percentage, fixed } = feeDisplay;

        if (percentage && fixed) {
            const pct = (percentage * 100).toFixed(1).replace(/\.0$/, '');
            return ` (Rp ${fixed.toLocaleString('id-ID')} + ${pct}%)`;
        }

        if (percentage) {
            const pct = (percentage * 100).toFixed(1).replace(/\.0$/, '');
            return ` (${pct}%)`;
        }

        return '';
    }

    /**
     * Generate QRIS and create transaction for top-up.
     * @param {Object} params
     * @param {Object} params.ctx - Context (with repositoryContext, from.id or jid)
     * @param {number} params.nominal - Top-up amount (before fee)
     * @param {string} params.userId - WhatsApp user JID
     * @returns {Promise<Object>}
     */
    async generateTopUpQRIS({ ctx, nominal, userId = null }) {
        const effectiveUserId = userId || ctx.from || ctx.jid;
        const uniqCode = await transactionService.generateTransactionId('topup', ctx);

        const { gateway: paymentGateway, feeConfig, paymentMethodCode } = await this._resolvePaymentGateway(ctx);

        this._validateAmount(nominal, feeConfig);

        // Top-up always charges fee to customer
        const { fee, totalAmount, customerPays, feeDisplay } = await this._calculateGatewayFee(nominal, paymentGateway, ctx, feeConfig, false);

        const qrisAmount = paymentGateway.usesBaseAmount ? nominal : customerPays;

        const qrisResult = await paymentGateway.createQRIS({
            amount: qrisAmount,
            referenceId: uniqCode,
            customerId: effectiveUserId.toString(),
            customerName: 'KOALASTORE WA',
            customerPhone: '0000000000',
            customerEmail: 'no@email.com',
            ctx
        });

        const currentTime = moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
        const expirationTime = new Date(Date.now() + 6 * 60 * 1000);
        const formattedTime = new Date(expirationTime)
            .toLocaleTimeString("en-US", { timeZone: "Asia/Jakarta", hour12: false })
            .slice(0, 5);

        const messageText = this._formatTopUpMessage({
            nominal,
            currentTime,
            uniqCode,
            formattedTime,
            fee,
            customerPays,
            feeDisplay
        });

        return {
            qrisImage: qrisResult.imageBuffer,
            transactionId: uniqCode,
            messageText,
            formattedDate: moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss'),
            formattedDateFile: moment().tz('Asia/Jakarta').format('DDMMYYYY'),
            fee,
            totalAmount: paymentGateway.usesBaseAmount ? nominal : customerPays,
            originalAmount: nominal,
            paymentMethodCode,
            gatewayReference: qrisResult.raw?.data?.reference ?? qrisResult.raw?.data?.qris_id ?? null
        };
    }

    /**
     * Generate QRIS for owner platform top-up.
     * ALWAYS uses .env gateway (platform gateway).
     * @param {Object} params
     * @param {Object} params.ctx - Context
     * @param {number} params.nominal - Top-up amount (before fee)
     * @param {string} params.userId - WhatsApp user JID
     * @returns {Promise<Object>}
     */
    async generateOwnerTopUpQRIS({ ctx, nominal, userId = null }) {
        const effectiveUserId = userId || ctx.from || ctx.jid;
        const uniqCode = await transactionService.generateTransactionId('topup', ctx);

        const { gateway: paymentGateway, feeConfig, paymentMethodCode } = this._envFallback();

        this._validateAmount(nominal, feeConfig);

        const { fee, totalAmount, customerPays, feeDisplay } = await this._calculateGatewayFee(nominal, paymentGateway, null, feeConfig, false);

        const qrisAmount = paymentGateway.usesBaseAmount ? nominal : customerPays;

        const qrisResult = await paymentGateway.createQRIS({
            amount: qrisAmount,
            referenceId: uniqCode,
            customerId: effectiveUserId.toString(),
            customerName: 'KOALASTORE WA',
            customerPhone: '0000000000',
            customerEmail: 'no@email.com',
            ctx
        });

        const currentTime = moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm:ss');
        const expirationTime = new Date(Date.now() + 6 * 60 * 1000);
        const formattedTime = new Date(expirationTime)
            .toLocaleTimeString("en-US", { timeZone: "Asia/Jakarta", hour12: false })
            .slice(0, 5);

        const messageText = this._formatOwnerTopUpMessage({
            nominal,
            currentTime,
            uniqCode,
            formattedTime,
            fee,
            customerPays,
            feeDisplay
        });

        return {
            qrisImage: qrisResult.imageBuffer,
            transactionId: uniqCode,
            messageText,
            formattedDate: moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss'),
            formattedDateFile: moment().tz('Asia/Jakarta').format('DDMMYYYY'),
            fee,
            totalAmount: paymentGateway.usesBaseAmount ? nominal : customerPays,
            originalAmount: nominal,
            paymentMethodCode,
            gatewayReference: qrisResult.raw?.data?.reference ?? qrisResult.raw?.data?.qris_id ?? null
        };
    }

    /**
     * Generate QRIS and prepare transaction for product purchase.
     * @param {Object} params
     * @param {Object} params.ctx - Context
     * @param {number} params.totalAmount - Total amount before gateway fee
     * @param {number} params.orderAmount - Quantity ordered
     * @param {number} params.price - Unit price
     * @param {string} params.productName - Product name
     * @param {number} params.fee - Transaction fee
     * @param {string} params.userId - WhatsApp user JID
     * @param {string} [params.voucherCode] - Applied voucher code
     * @param {number} [params.voucherDiscount] - Voucher discount amount
     * @returns {Promise<Object>}
     */
    async generateProductQRIS({ ctx, totalAmount, orderAmount, price, productName, fee = 0, userId = null, voucherCode = null, voucherDiscount = 0 }) {
        const effectiveUserId = userId || ctx.from || ctx.jid;
        const uniqCode = await transactionService.generateTransactionId('product', ctx);

        const { gateway: paymentGateway, feeConfig, paymentMethodCode } = await this._resolvePaymentGateway(ctx);

        this._validateAmount(totalAmount, feeConfig);

        const { fee: gatewayFee, totalAmount: finalAmount, customerPays, feeDisplay } = await this._calculateGatewayFee(totalAmount, paymentGateway, ctx, feeConfig);

        const qrisAmount = paymentGateway.usesBaseAmount ? totalAmount : customerPays;

        const qrisResult = await paymentGateway.createQRIS({
            amount: qrisAmount,
            referenceId: uniqCode,
            customerId: effectiveUserId.toString(),
            customerName: 'KOALASTORE WA',
            customerPhone: '0000000000',
            customerEmail: 'no@email.com',
            ctx
        });

        const expirationTime = new Date(Date.now() + 6 * 60 * 1000);
        const formattedTime = new Date(expirationTime)
            .toLocaleTimeString("en-US", { timeZone: "Asia/Jakarta", hour12: false })
            .slice(0, 5);

        const messageText = this._formatProductQRISMessage({
            productName,
            price,
            uniqCode,
            orderAmount,
            totalAmount,
            formattedTime,
            voucherCode,
            voucherDiscount,
            gatewayFee,
            customerPays,
            feeDisplay
        });

        return {
            qrisImage: qrisResult.imageBuffer,
            transactionId: uniqCode,
            messageText,
            formattedDate: moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss'),
            formattedDateFile: moment().tz('Asia/Jakarta').format('YYYY-MM-DD_HH-mm-ss'),
            gatewayFee,
            finalAmount: paymentGateway.usesBaseAmount ? totalAmount : customerPays,
            paymentMethodCode,
            gatewayReference: qrisResult.raw?.data?.reference ?? qrisResult.raw?.data?.qris_id ?? null
        };
    }

    /**
     * Send QRIS image with message to user via WhatsApp.
     *
     * Image source handling:
     * - Buffer: send directly
     * - HTTP/HTTPS URL: download to Buffer first
     * - data URI: decode base64 to Buffer
     * - Raw base64 string: decode to Buffer
     *
     * @param {Object} params
     * @param {Object} params.sock - Baileys WebSocket connection
     * @param {string} params.jid - Recipient WhatsApp JID
     * @param {Buffer|string} params.qrisImage - QRIS image (Buffer, URL, or base64)
     * @param {string} params.messageText - Caption text (WhatsApp markdown)
     * @param {string} params.cancelCallback - Cancel callback identifier (sent as separate text)
     * @returns {Promise<Object>} - Sent message info (with key.id for later deletion)
     */
    async sendQRISToUserWa({ sock, jid, qrisImage, messageText, cancelCallback }) {
        let imageBuffer;

        if (Buffer.isBuffer(qrisImage)) {
            imageBuffer = qrisImage;
        } else if (typeof qrisImage === 'string' && /^https?:\/\//i.test(qrisImage)) {
            // Download URL to Buffer
            const response = await axios.get(qrisImage, { responseType: 'arraybuffer', timeout: 15000 });
            imageBuffer = Buffer.from(response.data);
        } else if (typeof qrisImage === 'string') {
            // data URI or raw base64
            const base64Data = qrisImage.startsWith('data:')
                ? qrisImage.split(',')[1]
                : qrisImage;
            imageBuffer = Buffer.from(base64Data, 'base64');
        }

        // Send QRIS image with caption
        const sentMessage = await sock.sendMessage(jid, {
            image: imageBuffer,
            caption: messageText
        });

        // Send cancel instruction as separate text message
        if (cancelCallback) {
            await sock.sendMessage(jid, {
                text: '_Ketik *batal* untuk membatalkan transaksi ini._'
            });
        }

        return sentMessage;
    }

    /**
     * Check payment status for a transaction.
     * @param {Object} params
     * @param {string} params.referenceId - Transaction reference ID
     * @param {number} params.amount - Transaction amount
     * @param {string} [params.ownerId] - Owner ID for MULTI mode
     * @returns {Promise<{success: boolean, amount?: number, date?: string}>}
     */
    async checkPaymentStatus({ referenceId, amount, ownerId = null }) {
        const gateway = await this._resolveGatewayForStatusCheck(ownerId);
        return await gateway.checkPaymentStatus({ referenceId, amount });
    }

    /**
     * Resolve gateway for payment status checking.
     * @private
     */
    async _resolveGatewayForStatusCheck(ownerId) {
        if (ownerId && modeService.isMultiMode()) {
            const resolved = await gatewayResolverService.resolveGateway(ownerId);
            return resolved.gateway;
        }

        if (!this.paymentGateway) {
            this.paymentGateway = paymentGatewayFactory.createGateway();
        }
        return this.paymentGateway;
    }

    // -----------------------------------------------------------------------
    // Message formatters (WhatsApp markdown, not HTML)
    // -----------------------------------------------------------------------

    /**
     * Format top-up message (WhatsApp markdown).
     * @private
     */
    _formatTopUpMessage({ nominal, currentTime, uniqCode, formattedTime, fee = 0, customerPays = null, feeDisplay = null }) {
        let text = `> *Top-Up Saldo*\n\n`;
        text += `*ID:* \`${uniqCode}\`\n`;
        text += `*Jenis:* Top-Up Saldo\n`;
        text += `*Nominal:* ${formatMoney(nominal)}\n`;

        if (fee > 0) {
            const feeLabel = this._formatFeeLabel(feeDisplay);
            text += `*Biaya Gateway${feeLabel}:* ${formatMoney(fee)}\n`;

            if (customerPays === nominal) {
                text += `*Biaya ditanggung:* Merchant\n`;
                text += `*Total Bayar:* ${formatMoney(nominal)}\n`;
            } else {
                text += `*Total Bayar:* ${formatMoney(customerPays)}\n`;
            }
        } else {
            text += `*Total Bayar:* ${formatMoney(nominal)}\n`;
        }

        text += `*Waktu:* ${currentTime}\n\n`;
        text += `_Selesaikan pembayaran sebelum ${formattedTime} WIB dengan scan QRIS di atas._\n\n`;
        text += `Ketik *batal* untuk membatalkan.`;
        return text;
    }

    /**
     * Format owner platform top-up message (WhatsApp markdown).
     * @private
     */
    _formatOwnerTopUpMessage({ nominal, currentTime, uniqCode, formattedTime, fee = 0, customerPays = null, feeDisplay = null }) {
        let text = `> *Top-Up Saldo Platform*\n\n`;
        text += `*ID:* \`${uniqCode}\`\n`;
        text += `*Jenis:* Top-Up Saldo Platform\n`;
        text += `*Nominal:* ${formatMoney(nominal)}\n`;

        if (fee > 0) {
            const feeLabel = this._formatFeeLabel(feeDisplay);
            text += `*Biaya Gateway${feeLabel}:* ${formatMoney(fee)}\n`;

            if (customerPays === nominal) {
                text += `*Biaya ditanggung:* Merchant\n`;
                text += `*Total Bayar:* ${formatMoney(nominal)}\n`;
            } else {
                text += `*Total Bayar:* ${formatMoney(customerPays)}\n`;
            }
        } else {
            text += `*Total Bayar:* ${formatMoney(nominal)}\n`;
        }

        text += `*Waktu:* ${currentTime}\n\n`;
        text += `_Selesaikan pembayaran sebelum ${formattedTime} WIB dengan scan QRIS di atas._\n\n`;
        text += `Ketik *batal* untuk membatalkan.`;
        return text;
    }

    /**
     * Format product QRIS message (WhatsApp markdown).
     * @private
     */
    _formatProductQRISMessage({ productName, price, uniqCode, orderAmount, totalAmount, formattedTime, voucherCode = null, voucherDiscount = 0, gatewayFee = 0, customerPays = null, feeDisplay = null }) {
        let text = `> *Pesanan Dikonfirmasi*\n\n`;
        text += `*Produk:* "${productName}"\n`;
        text += `*Harga:* Rp ${parseInt(price).toLocaleString('id-ID')}\n`;
        text += `*ID Transaksi:* \`${uniqCode}\`\n`;
        text += `*Jumlah:* ${orderAmount}x\n`;

        const subtotal = voucherCode && voucherDiscount > 0 ? totalAmount + voucherDiscount : totalAmount;

        text += `\n*Rincian Pembayaran*\n`;
        text += `*Subtotal:* Rp ${subtotal.toLocaleString('id-ID')}\n`;

        if (voucherCode && voucherDiscount > 0) {
            text += `*Voucher (${voucherCode}):* -Rp ${voucherDiscount.toLocaleString('id-ID')}\n`;
            text += `*Setelah Voucher:* Rp ${totalAmount.toLocaleString('id-ID')}\n`;
        }

        if (gatewayFee > 0) {
            const feeLabel = this._formatFeeLabel(feeDisplay);
            text += `*Biaya Gateway${feeLabel}:* Rp ${gatewayFee.toLocaleString('id-ID')}\n`;

            if (customerPays === totalAmount) {
                text += `*Ditanggung:* Merchant\n`;
                text += `*Total Bayar:* Rp ${totalAmount.toLocaleString('id-ID')}\n`;
            } else {
                text += `*Total Bayar:* Rp ${customerPays.toLocaleString('id-ID')}\n`;
            }
        } else {
            text += `*Total Bayar:* Rp ${totalAmount.toLocaleString('id-ID')}\n`;
        }

        text += `\n_Scan QRIS di atas dan selesaikan pembayaran sebelum pukul ${formattedTime} WIB._\n`;
        text += `_Pesanan akan dibatalkan otomatis jika melewati batas waktu._`;
        return text;
    }
}

module.exports = new WaQRISService();
