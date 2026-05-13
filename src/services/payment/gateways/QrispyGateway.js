const axios = require('axios');
const moment = require('moment-timezone');
const BasePaymentGateway = require('./BasePaymentGateway');
const { generateQRImageWithTemplate, isQrisOverlayEnabled } = require('../utils/qrCodeGenerator');

const axiosInstance = axios.create({
  timeout: 60000,
  headers: {
    'Connection': 'keep-alive',
    'Keep-Alive': 'timeout=5, max=1000'
  }
});

/**
 * Qrispy Payment Gateway Implementation
 * Webhook-only, zero internal fee — Qrispy handles fees on their side.
 * Only available in MULTI mode with user's own credentials (no .env fallback).
 */
class QrispyGateway extends BasePaymentGateway {
  constructor() {
    super('Qrispy');
    this.baseUrl = 'https://api.qrispy.id';
    this.apiKey = null; // No .env fallback — always set via setCredentials()
    this.methodCode = 'qrispy-qris';

    // Qrispy embeds fee on their side — we send base amount, no fee computation
    this.usesBaseAmount = true;
  }

  /**
   * Apply custom credentials from user_payment_gateways
   * @param {Object} creds
   * @protected
   */
  _applyCredentials(creds) {
    if (creds.apiKey) this.apiKey = creds.apiKey;
    if (creds.api_key) this.apiKey = creds.api_key;
  }

  /**
   * Validate gateway configuration
   * @returns {boolean}
   * @throws {Error}
   */
  validateConfig() {
    if (!this.apiKey) {
      throw new Error('Missing Qrispy configuration. API Key is required.');
    }
    return true;
  }

  getFeePercentage() {
    return 0;
  }

  getFeeFixed() {
    return 0;
  }

  getPaymentMethodCode() {
    return this.methodCode;
  }

  /**
   * Create Qrispy QRIS payment.
   * Amount = BASE amount (Qrispy handles fee internally).
   * Returns pre-rendered QR image from Qrispy API, overlaid on template if enabled.
   *
   * @param {Object} params
   * @param {number} params.amount - Base payment amount
   * @param {string} params.referenceId - Unique transaction reference ID
   * @param {string} params.customerId - Customer ID (telegram user id)
   * @param {string} params.customerName - Customer name
   * @param {Object} [params.qrOptions={}] - QR code styling options
   * @param {Object} [params.ctx=null] - Telegraf context
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

    const { data: resp } = await axiosInstance.post(
      `${this.baseUrl}/api/payment/qris/generate`,
      {
        amount: amount,
        payment_reference: referenceId
      },
      {
        headers: {
          'X-API-Token': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );

    if (resp?.status !== 'success' || !resp?.data?.qris_image_base64) {
      throw new Error(`Failed to create Qrispy QRIS: ${resp?.message || 'No qris_image_base64 in response'}`);
    }

    const expired = moment().tz('Asia/Jakarta').add(6, 'minutes').format('YYYYMMDDHHmmss');

    // Decode base64 QR image from Qrispy response
    const base64Data = resp.data.qris_image_base64.replace(/^data:image\/\w+;base64,/, '');
    const qrImageBuffer = Buffer.from(base64Data, 'base64');

    // Overlay on template if enabled, otherwise return raw QR image
    const imageBuffer = await isQrisOverlayEnabled(ctx)
      ? await generateQRImageWithTemplate(qrImageBuffer, qrOptions, ctx)
      : qrImageBuffer;

    return { imageBuffer, expired, raw: resp };
  }

  /**
   * Check Qrispy payment status.
   * @param {Object} params
   * @param {string} params.referenceId - qris_id from Qrispy (stored as gateway_reference)
   * @param {number} params.amount - Expected payment amount
   * @returns {Promise<{success: boolean, amount?: number, date?: string}>}
   */
  async checkPaymentStatus({ referenceId, amount }) {
    this.validateConfig();

    try {
      const { data: resp } = await axiosInstance.get(
        `${this.baseUrl}/api/payment/qris/${referenceId}/status`,
        {
          headers: {
            'X-API-Token': this.apiKey,
            'Accept': 'application/json'
          },
          timeout: 10000
        }
      );

      const status = resp?.data?.payment_status;
      if (status !== 'paid') {
        return { success: false };
      }

      const paidAt = resp?.data?.paid_at;
      const date = paidAt
        ? moment(paidAt).tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss')
        : moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');

      return { success: true, amount: parseFloat(resp.data.amount), date };
    } catch (err) {
      console.error(`[${this.name}] checkPaymentStatus error:`, err.message);
      return { success: false };
    }
  }
}

module.exports = QrispyGateway;
