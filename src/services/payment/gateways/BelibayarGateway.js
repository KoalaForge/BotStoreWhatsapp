const axios = require('axios');
const crypto = require('crypto');
const moment = require('moment-timezone');
const BasePaymentGateway = require('./BasePaymentGateway');
const QRCode = require('qrcode');
const { createCanvas, loadImage } = require('canvas');

const axiosInstance = axios.create({ timeout: 60000 });

const CHANNELS = {
  qris: 'qris',
  virtual_account: 'virtual_account',
  ewallet: 'ewallet',
  retail: 'retail',
};

class BelibayarGateway extends BasePaymentGateway {
  constructor() {
    super('Belibayar');
    const sandbox = process.env.BELIBAYAR_SANDBOX === 'true';
    this.baseUrl = process.env.BELIBAYAR_BASE_URL || (sandbox
      ? 'https://api.belibayar.id/direct/v1/sandbox'
      : 'https://api.belibayar.id/direct/v1');
    this.apiKey = process.env.BELIBAYAR_API_KEY;
    this.secretKey = process.env.BELIBAYAR_SECRET_KEY;
    this.webhookSecret = process.env.BELIBAYAR_WEBHOOK_SECRET;
    this.methodCode = process.env.BELIBAYAR_METHOD || 'belibayar-qris';
  }

  _applyCredentials(credentials) {
    if (credentials.api_key) this.apiKey = credentials.api_key;
    if (credentials.secret_key) this.secretKey = credentials.secret_key;
    if (credentials.webhook_secret) this.webhookSecret = credentials.webhook_secret;
    if (credentials.base_url) this.baseUrl = credentials.base_url;
    if (credentials.sandbox !== undefined) {
      this.baseUrl = credentials.sandbox === true
        ? 'https://api.belibayar.id/direct/v1/sandbox'
        : 'https://api.belibayar.id/direct/v1';
    }
    if (credentials.method) this.methodCode = credentials.method;
  }

  validateConfig() {
    if (!this.baseUrl || !this.apiKey || !this.secretKey) {
      throw new Error('Missing Belibayar configuration. Please check BELIBAYAR_API_KEY and BELIBAYAR_SECRET_KEY.');
    }
    return true;
  }

  getPaymentMethodCode() {
    return this.methodCode;
  }

  generateSignature(rawBody) {
    return crypto.createHmac('sha256', this.secretKey).update(rawBody).digest('hex');
  }

  generateStatusSignature(timestamp) {
    return crypto.createHmac('sha256', this.secretKey).update(`:${timestamp}`).digest('hex');
  }

  _postHeaders(rawBody) {
    return {
      'X-Api-Key': this.apiKey,
      'X-Signature': this.generateSignature(rawBody),
      'Content-Type': 'application/json',
    };
  }

  _channelForMethod(methodCode) {
    const code = (methodCode || this.methodCode).toLowerCase();
    if (code === 'belibayar-qris') return { channel: CHANNELS.qris };
    if (code.startsWith('belibayar-va-')) {
      return { channel: CHANNELS.virtual_account, provider: code.slice('belibayar-va-'.length).toUpperCase() };
    }
    if (code.startsWith('belibayar-ewallet-')) {
      return { channel: CHANNELS.ewallet, provider: code.slice('belibayar-ewallet-'.length).toUpperCase() };
    }
    if (code.startsWith('belibayar-retail-')) {
      return { channel: CHANNELS.retail, provider: code.slice('belibayar-retail-'.length).toUpperCase() };
    }
    if (code === 'belibayar-payment-link') return { channel: 'payment-link' };
    throw new Error(`Unsupported Belibayar payment method code: ${methodCode}`);
  }

  _payload(params, methodCode) {
    const channel = this._channelForMethod(methodCode);
    if (channel.channel === 'payment-link') {
      return {
        reference: params.referenceId,
        amount: params.amount,
        expiry_minutes: params.expiryMinutes || 1440,
        ...(params.customerName ? { customer_name: params.customerName } : {}),
        ...(params.customerEmail ? { customer_email: params.customerEmail } : {}),
        ...(params.customerPhone ? { customer_phone: params.customerPhone } : {}),
        ...(params.description ? { description: params.description } : {})
      };
    }

    const payload = {
      reference: params.referenceId,
      amount: params.amount,
      pay_method: {
        method: channel.channel === 'qris' ? 'qris' : channel.channel === 'retail' ? 'virtual_account' : channel.channel,
        ...(channel.provider ? { channel: channel.provider } : {})
      },
      ...(params.customerName ? { customer_name: params.customerName } : {}),
      ...(params.customerEmail ? { customer_email: params.customerEmail } : {}),
      ...(channel.channel === 'ewallet' && params.customerPhone ? { customer_phone: params.customerPhone } : {}),
      ...(params.expiredTime ? { expired_time: params.expiredTime } : {}),
      ...(params.callbackUrl ? { callback_url: params.callbackUrl } : {}),
      ...(channel.channel === 'ewallet' && params.redirectUrl ? { redirect_url: params.redirectUrl } : {}),
      ...(channel.channel === 'qris' && params.staticQr !== undefined ? { static_qr: params.staticQr } : {}),
    };
    return payload;
  }

  async _post(path, body) {
    const rawBody = JSON.stringify(body);
    const { data } = await axiosInstance.post(`${this.baseUrl}${path}`, rawBody, {
      headers: this._postHeaders(rawBody),
      transformRequest: [(value) => value],
    });
    return data;
  }

  _responseData(response) {
    return response?.data?.data || response?.data || response;
  }

  async _normalizePayment(response, methodCode, expiry = null) {
    const data = this._responseData(response);
    const channel = this._channelForMethod(methodCode).channel;
    const qrContent = data?.qr_content || data?.qr_string || data?.qris_content || null;
    const qrImage = data?.qr_code || data?.qr_image || data?.qr_url || data?.image_url || null;
    const paymentUrl = data?.payment_link_url || data?.payment_url || data?.payment_link || data?.checkout_url || data?.url || null;
    const virtualAccount = data?.virtual_account || data?.va_number || data?.account_number || null;
    const retailCode = data?.retail_code || data?.payment_code || data?.bill_code || null;
    const expiresAt = data?.expires_at || data?.expiry || data?.expired_at || expiry;

    return {
      reference: data?.reference || data?.payment_reference || data?.transaction_reference || null,
      channel,
      qrContent,
      imageBuffer: qrImage && /^data:image\//i.test(qrImage)
        ? await this._dataUriToPng(qrImage)
        : qrContent
          ? await QRCode.toBuffer(qrContent, { width: 300, margin: 2 })
          : qrImage,
      qrImage,
      virtualAccount,
      paymentUrl,
      retailCode,
      fee: data?.merchant_fee ?? data?.fee ?? null,
      merchantReceives: data?.net_credit ?? data?.amount_received ?? null,
      expiresAt,
      raw: response,
    };
  }

  async _dataUriToPng(dataUri) {
    const imageData = Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');
    const svg = imageData.toString('utf8');
    const normalizedSvg = /^\s*<svg\b/i.test(svg) && (!/\bwidth\s*=/i.test(svg) || !/\bheight\s*=/i.test(svg))
      ? svg.replace(/<svg\b/i, '<svg width="512" height="512"')
      : svg;
    const image = await loadImage(Buffer.from(normalizedSvg, 'utf8'));
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toBuffer('image/png');
  }

  async createPayment(params) {
    this.validateConfig();
    const methodCode = params.paymentMethodCode || this.methodCode;
    const payload = this._payload(params, methodCode);
    const response = await this._post(
      this._channelForMethod(methodCode).channel === 'payment-link' ? '/payment-link' : '/payment/charge',
      payload,
    );
    const data = this._responseData(response);
    if (response?.success === false || response?.data?.success === false || data?.success === false || data?.status === 'failed' || data?.status === 'error') {
      throw new Error(`Failed to create Belibayar payment: ${response?.message || data?.message || 'Unknown error'}`);
    }
    return this._normalizePayment(response, methodCode);
  }

  async createQRIS(params) {
    return this.createPayment({ ...params, paymentMethodCode: params.paymentMethodCode || this.methodCode });
  }

  async checkPaymentStatus({ referenceId }) {
    this.validateConfig();
    try {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const { data: response } = await axiosInstance.get(
        `${this.baseUrl}/payment/status/${encodeURIComponent(referenceId)}`,
        { headers: { 'X-Api-Key': this.apiKey, 'X-Timestamp': timestamp, 'X-Signature': this.generateStatusSignature(timestamp) } },
      );
      const data = this._responseData(response);
      const status = String(data?.status || response?.status || '').toLowerCase();
      return {
        success: ['paid', 'success', 'completed'].includes(status),
        amount: data?.amount ?? data?.paid_amount ?? data?.amount_paid,
        date: data?.paid_at || data?.payment_date || moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss'),
      };
    } catch (error) {
      console.error(`[${this.name}] checkPaymentStatus error:`, error.message);
      return { success: false };
    }
  }

  async cancelPayment(referenceId) {
    this.validateConfig();
    return this._post('/payment/cancel', { reference: referenceId });
  }

  async createPaymentLink(params) {
    return this.createPayment({ ...params, paymentMethodCode: 'belibayar-payment-link' });
  }

  async getPaymentLinkStatus(referenceId) {
    return this._post('/payment-link/status', { reference_id: referenceId });
  }

  async cancelPaymentLink(referenceId) {
    return this._post('/payment-link/cancel', { reference_id: referenceId });
  }

  async _get(path) {
    this.validateConfig();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const { data } = await axiosInstance.get(`${this.baseUrl}${path}`, {
      headers: { 'X-Api-Key': this.apiKey, 'X-Timestamp': timestamp, 'X-Signature': this.generateStatusSignature(timestamp) },
    });
    return data;
  }
}

module.exports = BelibayarGateway;
