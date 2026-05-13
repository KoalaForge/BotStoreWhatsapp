const axios = require('axios');
const QRCode = require('qrcode');
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
 * Pakasir Payment Gateway Implementation
 */
class PakasirGateway extends BasePaymentGateway {
  constructor() {
    super('Pakasir');
    this.baseUrl = 'https://app.pakasir.com';
    this.project = process.env.PAKASIR_PROJECT;
    this.apiKey = process.env.PAKASIR_API_KEY;
    this.methodCode = process.env.PAKASIR_METHOD || 'pakasir-qris';

    // Tiered fee config — fee is pre-calculated by us and included in the amount sent to Pakasir
    this.highValueThreshold = 105000;
    this.lowFeePercentage = 0.007;      // 0.7%
    this.lowFeeFixed = 310;             // Rp 310 fixed
    this.highFeePercentage = 0.01;      // 1.0%
  }

  /**
   * Apply custom credentials to Pakasir-specific properties
   * @param {Object} creds - Credential key-value pairs from user_payment_gateways
   * @protected
   */
  _applyCredentials(creds) {
    if (creds.project) this.project = creds.project;
    // Support snake_case (api_key) from platform credentials
    // and camelCase (apiKey) from user own credentials
    if (creds.api_key) this.apiKey = creds.api_key;
    if (creds.apiKey) this.apiKey = creds.apiKey;
  }

  /**
   * Validate Pakasir configuration
   * @returns {boolean}
   * @throws {Error} if configuration is invalid
   */
  validateConfig() {
    if (!this.project || !this.apiKey) {
      throw new Error('Missing Pakasir configuration. Please check PAKASIR_PROJECT and PAKASIR_API_KEY environment variables.');
    }
    return true;
  }

  /**
   * getFeePercentage returns 0 because qrisService must NOT pre-add fee.
   * Instead, qrisService calls computeFee(amount) for display purposes,
   * and passes base amount to createQRIS (Pakasir embeds fee in the QR itself).
   * @returns {number}
   */
  getFeePercentage() {
    return 0;
  }

  /**
   * Get fixed fee component
   * @returns {number}
   */
  getFeeFixed() {
    return 0;
  }

  /**
   * Tiered fee calculation for Pakasir QRIS.
   * - amount <= 105000: 0.7% + Rp 310
   * - amount >  105000: 1.0% (no fixed component)
   * Called by qrisService._computeFee() when this method exists.
   * @param {number} amount - Base payment amount
   * @returns {{ fee: number, feeDisplay: { percentage: number, fixed: number|null } }}
   */
  computeFee(amount) {
    if (amount <= this.highValueThreshold) {
      // Pakasir deducts fee from the total we send (inclusive).
      // Compute total = ceil((base + fixed) / (1 - pct)) so merchant receives base.
      // Verify with ceil correction: if Pakasir's fee leaves merchant short, add 1 Rp.
      let total = Math.ceil((amount + this.lowFeeFixed) / (1 - this.lowFeePercentage));
      const pakasirFee = Math.ceil(total * this.lowFeePercentage) + this.lowFeeFixed;
      if (total - pakasirFee < amount) total++;
      return {
        fee: total - amount,
        feeDisplay: { percentage: this.lowFeePercentage, fixed: this.lowFeeFixed }
      };
    }
    // High value (>105000): 1.0% inclusive, no fixed component
    let total = Math.ceil(amount / (1 - this.highFeePercentage));
    const pakasirFee = Math.round(total * this.highFeePercentage);
    if (total - pakasirFee < amount) total++;
    return {
      fee: total - amount,
      feeDisplay: { percentage: this.highFeePercentage, fixed: null }
    };
  }

  /**
   * Get payment method code for transaction records
   * @returns {string}
   */
  getPaymentMethodCode() {
    return this.methodCode;
  }

  /**
   * Create Pakasir QRIS payment and generate QR code image.
   * amount = BASE amount (before fee) — Pakasir embeds fee into the QR automatically.
   * @param {Object} params - Payment parameters
   * @param {number} params.amount - Payment amount (base, before fee)
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

    const body = {
      project: this.project,
      order_id: referenceId,
      amount: amount,
      api_key: this.apiKey
    };
    const { data: resp } = await axiosInstance.post(
      `${this.baseUrl}/api/transactioncreate/qris`,
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );

    const qrString = resp?.payment?.payment_number;
    if (!qrString) {
      throw new Error(`Failed to create Pakasir QRIS: ${resp?.message || 'No payment_number in response'}`);
    }

    const expired = moment().tz('Asia/Jakarta').add(6, 'minutes').format('YYYYMMDDHHmmss');

    const imageBuffer = await isQrisOverlayEnabled(ctx)
      ? await generateQRCodeWithTemplate(qrString, qrOptions, ctx)
      : await QRCode.toBuffer(qrString, { width: 300, margin: 2, errorCorrectionLevel: 'M' });

    return { imageBuffer, expired, raw: resp };
  }

  /**
   * Check Pakasir payment status.
   * Requires both referenceId (order_id) AND amount (base amount sent to Pakasir).
   * @param {Object} params - Check parameters
   * @param {string} params.referenceId - Transaction reference ID (order_id)
   * @param {number} params.amount - Base payment amount
   * @returns {Promise<{success: boolean, amount?: number, date?: string}>}
   */
  async checkPaymentStatus({ referenceId, amount }) {
    this.validateConfig();

    try {
      const { data: resp } = await axiosInstance.get(
        `${this.baseUrl}/api/transactiondetail`,
        {
          params: {
            project: this.project,
            order_id: referenceId,
            amount: amount,
            api_key: this.apiKey
          },
          timeout: 10000
        }
      );

      const status = resp?.transaction?.status;
      if (status !== 'completed') {
        return { success: false };
      }

      const paidAt = resp?.transaction?.paid_at;
      const date = paidAt
        ? moment(paidAt, 'YYYY-MM-DD HH:mm:ss').tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss')
        : moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');

      return { success: true, amount: resp.transaction.amount, date };
    } catch (err) {
      console.error(`[${this.name}] checkPaymentStatus error:`, err.message);
      return { success: false };
    }
  }
}

module.exports = PakasirGateway;
