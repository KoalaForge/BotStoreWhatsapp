const axios = require('axios');
const crypto = require('crypto');
const moment = require('moment-timezone');
const BasePaymentGateway = require('./BasePaymentGateway');
const { generateQRCodeWithTemplate, isQrisOverlayEnabled } = require('../utils/qrCodeGenerator');

// Create optimized axios instance with keep-alive and timeout
const axiosInstance = axios.create({
  timeout: 60000,
  headers: {
    'Connection': 'keep-alive',
    'Keep-Alive': 'timeout=5, max=1000'
  }
});

/**
 * Tripay Payment Gateway Implementation
 */
class TripayGateway extends BasePaymentGateway {
  constructor() {
    super('Tripay');
    const isSandbox = process.env.TRIPAY_SANDBOX === 'true';
    this.baseUrl = process.env.TRIPAY_BASE_URL || (isSandbox ? 'https://tripay.co.id/api-sandbox' : 'https://tripay.co.id/api');
    this.merchantCode = process.env.TRIPAY_MERCHANT_CODE;
    this.apiKey = process.env.TRIPAY_API_KEY;
    this.privateKey = process.env.TRIPAY_PRIVATE_KEY;
    this.channel = process.env.TRIPAY_CHANNEL || 'QRIS';
    this.feePercentage = parseFloat(process.env.TRIPAY_FEE_PERCENTAGE || '0.7') / 100; // 0.7 => 0.007
    this.feeFixed = parseInt(process.env.TRIPAY_FEE_FIXED || '750', 10);
    this.methodCode = process.env.TRIPAY_METHOD || 'tripay-qris';
  }

  /**
   * Apply custom credentials to Tripay-specific properties
   * @param {Object} creds - Credential key-value pairs from user_payment_gateways
   * @protected
   */
  _applyCredentials(creds) {
    if (creds.merchant_code) this.merchantCode = creds.merchant_code;
    if (creds.api_key) this.apiKey = creds.api_key;
    if (creds.private_key) this.privateKey = creds.private_key;
    if (creds.base_url) this.baseUrl = creds.base_url;
    if (creds.channel) this.channel = creds.channel;
  }

  /**
   * Validate Tripay configuration
   * @returns {boolean}
   * @throws {Error} if configuration is invalid
   */
  validateConfig() {
    if (!this.apiKey || !this.merchantCode || !this.privateKey) {
      throw new Error('Missing Tripay environment configuration. Please check TRIPAY_API_KEY, TRIPAY_MERCHANT_CODE, and TRIPAY_PRIVATE_KEY environment variables.');
    }
    return true;
  }

  /**
   * Get transaction fee percentage
   * @returns {number} - Fee percentage (e.g., 0.007 = 0.7%)
   */
  getFeePercentage() {
    return this.feePercentage;
  }

  /**
   * Get fixed fee component
   * @returns {number} - Fixed fee amount in Rupiah
   */
  getFeeFixed() {
    return this.feeFixed;
  }

  /**
   * Get payment method code for transaction records
   * @returns {string} - Payment method code from TRIPAY_METHOD env
   */
  getPaymentMethodCode() {
    return this.methodCode;
  }

  /**
   * Generate HMAC SHA256 signature for Tripay API
   * @param {string} merchantCode - Merchant code
   * @param {string} merchantRef - Merchant reference ID
   * @param {number} amount - Payment amount
   * @returns {string} - Hex-encoded HMAC signature
   */
  generateSignature(merchantCode, merchantRef, amount) {
    const str = merchantCode + merchantRef + amount;
    return crypto.createHmac('sha256', this.privateKey).update(str).digest('hex');
  }

  /**
   * Create Tripay QRIS payment and generate QR code image
   * @param {Object} params - Payment parameters
   * @param {number} params.amount - Payment amount
   * @param {string} params.referenceId - Unique transaction reference ID
   * @param {string} params.customerId - Customer ID (telegram user id)
   * @param {string} params.customerName - Customer name
   * @param {string} [params.customerPhone] - Customer phone number
   * @param {string} [params.customerEmail] - Customer email
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

    const expiredTime = Math.floor(Date.now() / 1000) + 6 * 60;
    const signature = this.generateSignature(this.merchantCode, referenceId, amount);

    const body = {
      method: this.channel,
      merchant_ref: referenceId,
      amount: amount,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      order_items: [{
        sku: referenceId,
        name: 'Payment ' + referenceId,
        price: amount,
        quantity: 1,
        subtotal: amount
      }],
      expired_time: expiredTime,
      signature: signature
    };

    const { data: resp } = await axiosInstance.post(
      `${this.baseUrl}/transaction/create`,
      body,
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (resp.success !== true || !resp.data?.qr_string) {
      throw new Error(`Failed to create QRIS: ${resp.message || 'Unknown error'}`);
    }

    const expired = moment().tz('Asia/Jakarta').add(6, 'minutes').format('YYYYMMDDHHmmss');

    const imageBuffer = await isQrisOverlayEnabled(ctx)
      ? await generateQRCodeWithTemplate(resp.data.qr_string, qrOptions, ctx)
      : resp.data.qr_url;

    return { imageBuffer, expired, raw: resp };
  }

  /**
   * Check Tripay payment status for a transaction
   * @param {Object} params - Check parameters
   * @param {string} params.referenceId - Tripay reference ID (gateway_reference)
   * @returns {Promise<{success: boolean, amount?: number, date?: string}>}
   */
  async checkPaymentStatus({ referenceId }) {
    this.validateConfig();

    try {
      const { data: resp } = await axiosInstance.get(
        `${this.baseUrl}/transaction/detail`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          },
          params: {
            reference: referenceId
          },
          timeout: 10000
        }
      );

      if (!resp.success || !resp.data?.status) {
        return { success: false };
      }

      if (resp.data.status !== 'PAID') {
        return { success: false };
      }

      const paymentDate = resp.data.paid_at
        ? moment.unix(resp.data.paid_at).tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss')
        : moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');

      return {
        success: true,
        amount: resp.data.amount_received,
        date: paymentDate
      };
    } catch (err) {
      console.error(`[${this.name}] checkPaymentStatus error:`, err.message);
      return { success: false };
    }
  }
}

module.exports = TripayGateway;
