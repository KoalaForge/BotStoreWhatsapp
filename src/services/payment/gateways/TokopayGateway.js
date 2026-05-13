const axios = require('axios');
const moment = require('moment-timezone');
const BasePaymentGateway = require('./BasePaymentGateway');
const { generateQRCodeWithTemplate, isQrisOverlayEnabled } = require('../utils/qrCodeGenerator');

// Persistent axios instance with keep-alive for connection reuse across polls
const axiosInstance = axios.create({
  timeout: 10000,
  headers: {
    'Connection': 'keep-alive',
    'Keep-Alive': 'timeout=5, max=1000'
  }
});

/**
 * TokoPay Payment Gateway Implementation
 */
class TokopayGateway extends BasePaymentGateway {
  constructor() {
    super('TokoPay');
    this.baseUrl = process.env.TOKOPAY_BASE_URL;
    this.merchantId = process.env.TOKOPAY_MERCHANT_ID;
    this.secret = process.env.TOKOPAY_SECRET;
    this.metode = process.env.TOKOPAY_METHOD;
    this.feePercentage = parseFloat(process.env.TOKOPAY_FEE_PERCENTAGE || '0');
  }

  /**
   * Apply custom credentials to TokoPay-specific properties
   * @param {Object} creds - Credential key-value pairs from user_payment_gateways
   * @protected
   */
  _applyCredentials(creds) {
    if (creds.merchant_id) this.merchantId = creds.merchant_id;
    if (creds.secret) this.secret = creds.secret;
    if (creds.base_url) this.baseUrl = creds.base_url;
    if (creds.metode) this.metode = creds.metode;
  }

  /**
   * Validate TokoPay configuration
   * @returns {boolean}
   * @throws {Error} if configuration is invalid
   */
  validateConfig() {
    if (!this.baseUrl || !this.merchantId || !this.metode || !this.secret) {
      throw new Error('Missing TokoPay environment configuration. Please check TOKOPAY_* environment variables.');
    }
    return true;
  }

  /**
   * Get transaction fee percentage
   * @returns {number} - Fee percentage (e.g., 0.017 = 1.7%)
   */
  getFeePercentage() {
    return this.feePercentage;
  }

  /**
   * Get payment method code for transaction records
   * @returns {string} - Payment method code from TOKOPAY_METHOD env
   */
  getPaymentMethodCode() {
    return this.metode;
  }

  /**
   * Create TokoPay Dynamic QRIS and generate QR code image
   * @param {Object} params - Payment parameters
   * @param {number} params.amount - Payment amount (will have fee applied)
   * @param {string} params.referenceId - Unique transaction reference ID
   * @param {string} params.customerId - Customer ID (telegram user id) - not used by TokoPay but kept for interface consistency
   * @param {string} params.customerName - Customer name - not used by TokoPay but kept for interface consistency
   * @param {string} [params.customerPhone] - Customer phone - not used by TokoPay
   * @param {string} [params.customerEmail] - Customer email - not used by TokoPay
   * @param {Object} [params.qrOptions={}] - QR code styling options
   * @param {Object} [params.ctx] - Telegraf context (optional, for multi-mode support)
   * @returns {Promise<{imageBuffer: Buffer, expired: string, raw: any}>}
   */
  async createQRIS({
    amount,
    referenceId,
    customerId,
    customerName,
    customerPhone,
    customerEmail,
    qrOptions = {},
    ctx = null
  }) {
    this.validateConfig();

    // Expired time – 6 minutes ahead, format YYYYMMDDHHmmss
    const expired = moment().tz('Asia/Jakarta').add(6, 'minutes').format('YYYYMMDDHHmmss');

    const { data: resp } = await axiosInstance.get(this.baseUrl, {
      params: {
        merchant: this.merchantId,
        secret: this.secret,
        ref_id: referenceId,
        nominal: amount,
        metode: this.metode
      }
    });

    if (resp.status !== 'Success' || !resp.data?.qr_string) {
      throw new Error(`Failed to create QRIS: ${resp.error_msg || 'Unknown error'}`);
    }

    const imageBuffer = await isQrisOverlayEnabled(ctx)
        ? await generateQRCodeWithTemplate(resp.data.qr_string, qrOptions, ctx)
        : resp.data.qr_link

    return { imageBuffer, expired, raw: resp };
  }

  /**
   * Check TokoPay payment status for a transaction
   * @param {Object} params - Check parameters
   * @param {string} params.referenceId - Transaction reference ID
   * @param {number} params.amount - Expected payment amount
   * @returns {Promise<{success: boolean, amount?: number, date?: string}>}
   */
  async checkPaymentStatus({ referenceId, amount }) {
    this.validateConfig();

    const paymentTime = moment().tz('Asia/Jakarta');
    const paymentTimeString = paymentTime.format('YYYY-MM-DD HH:mm:ss');

    try {
      const { data: resp } = await axiosInstance.get(
        this.baseUrl,
        {
          params: {
            merchant: this.merchantId,
            secret: this.secret,
            ref_id: referenceId,
            nominal: amount,
            metode: this.metode
          },
        }
      );

      if (!resp?.data?.status) {
        console.error(`[${this.name}] Check payment ${referenceId} Result: false - Reason: Missing Response`);
        return { success: false };
      }

      const statusTrx = resp.data.status.toLowerCase();
      const isSuccess = ['completed', 'success'].includes(statusTrx);

      if (!isSuccess) {
        return { success: false };
      }

      return {
        success: isSuccess,
        amount: resp.data.total_diterima,
        date: paymentTimeString,
      };
    } catch (err) {
      console.error(`[${this.name}] checkPaymentStatus error:`, err.message);
      return { success: false };
    }
  }
}

module.exports = TokopayGateway;
