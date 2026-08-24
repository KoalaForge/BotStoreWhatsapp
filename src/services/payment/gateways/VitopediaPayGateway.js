const axios = require('axios');
const moment = require('moment-timezone');
const BasePaymentGateway = require('./BasePaymentGateway');

const axiosInstance = axios.create({
  baseURL: 'https://vitopediapay.com/api',
  timeout: 60000,
  headers: {
    Connection: 'keep-alive',
    'Keep-Alive': 'timeout=5, max=1000',
  },
});

class VitopediaPayGateway extends BasePaymentGateway {
  constructor() {
    super('VitopediaPay');
    this.apiKey = process.env.VITOPEDIAPAY_API_KEY;
    this.methodCode = process.env.VITOPEDIAPAY_METHOD || 'vitopedia-qris';
  }

  _applyCredentials(credentials) {
    this.apiKey = credentials.apiKey || credentials.api_key || credentials.token || this.apiKey;
  }

  validateConfig() {
    if (!this.apiKey) {
      throw new Error('Missing VitopediaPay configuration. Set VITOPEDIAPAY_API_KEY or configure gateway credentials.');
    }

    return true;
  }

  getPaymentMethodCode() {
    return this.methodCode;
  }

  async createQRIS({ amount, referenceId }) {
    this.validateConfig();

    if (amount < 1000) {
      throw new Error('VitopediaPay minimum payment amount is Rp 1.000.');
    }

    const { data: response } = await axiosInstance.post(
      '/pg/create',
      { amount, ref_id: referenceId },
      { headers: this._headers() },
    );
    const payment = response?.data;

    if (!response?.success || !payment?.id || !payment?.qr_image) {
      throw new Error(`Failed to create VitopediaPay QRIS: ${response?.message || 'Invalid response'}`);
    }

    const qrImage = await axios.get(payment.qr_image, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: { Accept: 'image/*' },
    });

    return {
      imageBuffer: Buffer.from(qrImage.data),
      expired: moment().tz('Asia/Jakarta').add(24, 'hours').format('YYYYMMDDHHmmss'),
      totalAmount: Number(payment.total),
      raw: response,
    };
  }

  async checkPaymentStatus({ referenceId }) {
    this.validateConfig();

    try {
      const { data: response } = await axiosInstance.get(
        `/pg/check/${encodeURIComponent(referenceId)}`,
        { headers: this._headers() },
      );
      const payment = response?.data;

      if (!response?.success || payment?.status !== 'paid') {
        return { success: false };
      }

      return {
        success: true,
        amount: Number(payment.total),
        date: payment.paid_at
          ? moment(payment.paid_at).tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss')
          : moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss'),
      };
    } catch (error) {
      console.error(`[${this.name}] checkPaymentStatus error:`, error.message);
      return { success: false };
    }
  }

  _headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }
}

module.exports = VitopediaPayGateway;
