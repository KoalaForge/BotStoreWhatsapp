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
 * LinkQu Payment Gateway Implementation
 */
class LinkQuGateway extends BasePaymentGateway {
  constructor() {
    super('LinkQu');
    this.baseUrl = process.env.LINKQU_BASE_URL;
    this.clientId = process.env.LINKQU_CLIENT_ID;
    this.clientSecret = process.env.LINKQU_CLIENT_SECRET;
    this.username = process.env.LINKQU_USERNAME;
    this.pin = process.env.LINKQU_PIN;
    this.signatureKey = process.env.LINKQU_SIGNATURE_KEY;
    this.callbackUrl = process.env.LINKQU_CALLBACK_URL || undefined;
    this.feePercentage = parseFloat(process.env.LINKQU_FEE_PERCENTAGE || '0.01'); // Default 1%
    this.methodCode = process.env.LINKQU_METHOD || 'qris'; // Payment method code for transaction records
  }

  /**
   * Apply custom credentials to LinkQu-specific properties
   * @param {Object} creds - Credential key-value pairs from user_payment_gateways
   * @protected
   */
  _applyCredentials(creds) {
    if (creds.client_id) this.clientId = creds.client_id;
    if (creds.client_secret) this.clientSecret = creds.client_secret;
    if (creds.username) this.username = creds.username;
    if (creds.pin) this.pin = creds.pin;
    if (creds.signature_key) this.signatureKey = creds.signature_key;
    if (creds.base_url) this.baseUrl = creds.base_url;
  }

  /**
   * Get transaction fee percentage
   * @returns {number} - Fee percentage (e.g., 0.01 = 1%)
   */
  getFeePercentage() {
    return this.feePercentage;
  }

  /**
   * Get payment method code for transaction records
   * @returns {string} - Payment method code from LINKQU_METHOD env
   */
  getPaymentMethodCode() {
    return this.methodCode;
  }

  /**
   * Validate LinkQu configuration
   * @returns {boolean}
   * @throws {Error} if configuration is invalid
   */
  validateConfig() {
    if (!this.baseUrl || !this.clientId || !this.clientSecret ||
        !this.username || !this.pin || !this.signatureKey) {
      throw new Error('Missing LinkQu environment configuration. Please check LINKQU_* environment variables.');
    }
    return true;
  }

  /**
   * Build LinkQu signature based on documentation
   * @param {String} apiPath eg "/transaction/create/qris"
   * @param {String} httpMethod eg "POST"
   * @param {Array<String|Number>} orderedParams array ordered exactly as formula
   * @returns {String} hex hmac sha256
   */
  generateSignature(apiPath, httpMethod, orderedParams) {
    const regex = /[^0-9a-zA-Z]/g;
    const secondValue = orderedParams.join('').replace(regex, '').toLowerCase();
    const signToString = apiPath + httpMethod + secondValue;
    return crypto.createHmac('sha256', this.signatureKey).update(signToString).digest('hex');
  }

  /**
   * Create LinkQu Dynamic QRIS and generate QR code image buffer
   * @param {Object} params - Payment parameters
   * @param {number} params.amount - Payment amount
   * @param {string} params.referenceId - Unique transaction reference ID
   * @param {string} params.customerId - Customer ID (telegram user id)
   * @param {string} params.customerName - Customer name (max 16 chars)
   * @param {string} [params.customerPhone='0000000000'] - Customer phone number
   * @param {string} [params.customerEmail='no@email.com'] - Customer email
   * @param {Object} [params.qrOptions={}] - QR code styling options
   * @param {Object} [params.ctx] - Telegraf context (optional, for multi-mode support)
   * @returns {Promise<{imageBuffer: Buffer, expired: string, raw: any}>}
   */
  async createQRIS({
    amount,
    referenceId,
    customerId,
    customerName,
    customerPhone = '0000000000',
    customerEmail = 'no@email.com',
    qrOptions = {},
    ctx = null
  }) {
    this.validateConfig();

    // Expired time – 6 minutes ahead, format yyyyMMddHHmmss
    const expired = moment().tz('Asia/Jakarta').add(6, 'minutes').format('YYYYMMDDHHmmss');

    const apiPath = '/transaction/create/qris';
    const httpMethod = 'POST';

    // Formula: amount + expired + partner_reff + customer_id + customer_name + customer_email + client-id
    const signature = this.generateSignature(
      apiPath,
      httpMethod,
      [amount, expired, referenceId, customerId, customerName, customerEmail, this.clientId]
    );

    const body = {
      amount: amount,
      partner_reff: referenceId,
      customer_id: customerId,
      customer_name: customerName,
      expired,
      username: this.username,
      pin: this.pin,
      customer_phone: customerPhone,
      customer_email: customerEmail,
      signature,
      ...(this.callbackUrl ? { url_callback: this.callbackUrl } : {}),
    };

    const headers = {
      'client-id': this.clientId,
      'client-secret': this.clientSecret,
      'Content-Type': 'application/json',
    };

    const endpoint = `${this.baseUrl}/linkqu-partner/transaction/create/qris`;

    const { data: resp } = await axiosInstance.post(endpoint, body, {
      headers,
      decompress: true,
      responseType: 'json'
    });

    if (resp.response_code !== '00' || !resp.qris_text) {
      throw new Error(`Failed to create QRIS: ${resp.response_desc || 'Unknown error'}`);
    }

    const imageBuffer = await isQrisOverlayEnabled(ctx)
      ? await generateQRCodeWithTemplate(resp.qris_text, qrOptions, ctx)
      : resp.imageqris;

    return { imageBuffer, expired, raw: resp };
  }

  /**
   * Check LinkQu payment status for a transaction
   * @param {Object} params - Check parameters
   * @param {string} params.referenceId - Transaction reference ID
   * @returns {Promise<{success: boolean, amount?: number, date?: string}>}
   */
  async checkPaymentStatus({ referenceId }) {
    this.validateConfig();

    try {
      const { data: resp } = await axiosInstance.get(
        `${this.baseUrl}/linkqu-partner/transaction/payment/checkstatus`,
        {
          headers: {
            'client-id': this.clientId,
            'client-secret': this.clientSecret,
          },
          params: {
            username: this.username,
            partnerreff: referenceId,
          },
        }
      );

      if (resp.rc !== '00' || !resp.data) {
        return { success: false };
      }

      const statusTrx = (resp.data.status_trx || '').toLowerCase();
      const isSuccess = statusTrx === 'success';

      return {
        success: isSuccess,
        amount: resp.data.amount,
        date: resp.data.transaction_time, // format "YYYY-MM-DD HH:mm:ss"
      };
    } catch (err) {
      console.error(`[${this.name}] checkPaymentStatus error:`, err.message);
      return { success: false };
    }
  }
}

module.exports = LinkQuGateway;
