const axios = require('axios');
const moment = require('moment-timezone');
const BasePaymentGateway = require('./BasePaymentGateway');
const { generateQRCodeWithTemplate, isQrisOverlayEnabled } = require('../utils/qrCodeGenerator');

const axiosInstance = axios.create({
    timeout: 30000,
    headers: {
        'Connection': 'keep-alive',
        'Keep-Alive': 'timeout=5, max=1000'
    }
});

/**
 * OrderKuota Payment Gateway Implementation
 *
 * Identification strategy:
 *   OrderKuota has no per-transaction status API — only a mutasi endpoint
 *   returning the 10 most recent incoming QRIS transactions.
 *   To uniquely identify a payment, a random unique code (Rp 1–200) is added
 *   to the base amount and used as the gateway fee.
 *   Polling matches by exact total amount within a 6-minute window.
 *
 * Credentials (all required, always per-owner — no platform fallback):
 *   - username   : OrderKuota login username
 *   - authToken  : Token from OTP verification (managed by koalabotbe)
 *   - qrisString : Static QRIS payload string from merchant's physical QRIS
 */
class OrderKuotaGateway extends BasePaymentGateway {
    constructor() {
        super('OrderKuota');
        this.baseUrl = 'https://koalakut.koalastore.digital';
        this.username = null;
        this.authToken = null;
        this.qrisString = null;
        this.methodCode = 'orderkuota-qris';

        // Flag consumed by qrisService to trigger collision-safe unique code generation
        this.requiresUniqueCode = true;
        this.uniqueCodeMin = 1;
        this.uniqueCodeMax = 200;
    }

    _applyCredentials(creds) {
        if (creds.username) this.username = creds.username;
        if (creds.auth_token) this.authToken = creds.auth_token;
        if (creds.authToken) this.authToken = creds.authToken;
        if (creds.qris_string) this.qrisString = creds.qris_string;
        if (creds.qrisString) this.qrisString = creds.qrisString;
    }

    validateConfig() {
        if (!this.username || !this.authToken || !this.qrisString) {
            throw new Error(
                'Gateway OrderKuota membutuhkan kredensial pribadi (username, authToken, qrisString). ' +
                'Hubungi admin untuk menghubungkan akun OrderKuota.'
            );
        }
        return true;
    }

    getFeePercentage() { return 0; }
    getFeeFixed() { return 0; }

    /**
     * Generate a random unique code (Rp 1–200) to embed into the payment amount.
     * This code serves as the transaction identifier when polling mutasi.
     * Collision checking is handled upstream in qrisService.
     * @returns {{ fee: number, feeDisplay: { percentage: null, fixed: number } }}
     */
    computeFee() {
        const code = Math.floor(Math.random() * this.uniqueCodeMax) + this.uniqueCodeMin;
        return {
            fee: code,
            feeDisplay: { percentage: null, fixed: code }
        };
    }

    getPaymentMethodCode() {
        return this.methodCode;
    }

    /**
     * Generate a dynamic QRIS image for the given amount.
     * The endpoint is public — no auth credentials needed.
     * @param {Object} params
     * @param {number} params.amount - Total amount (base + unique code)
     * @param {string} params.referenceId - Transaction reference ID (informational only)
     * @param {Object} [params.qrOptions] - QR overlay options
     * @param {Object} [params.ctx] - Telegraf context
     * @returns {Promise<{ imageBuffer: Buffer, expired: string, raw: Object }>}
     */
    async createQRIS({ amount, referenceId, qrOptions = {}, ctx = null }) {
        this.validateConfig();

        const { data: resp } = await axiosInstance.post(
            `${this.baseUrl}/api/qris/dynamic`,
            { base_string: this.qrisString, amount },
            { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } }
        );

        if (!resp?.status || !resp?.data?.qr_image) {
            throw new Error(`Gagal membuat QRIS OrderKuota: ${resp?.message || 'Response tidak valid'}`);
        }

        let imageBuffer;
        if (await isQrisOverlayEnabled(ctx)) {
            // Use dynamic_string (full QRIS payload) to render QR with store template
            imageBuffer = await generateQRCodeWithTemplate(resp.data.dynamic_string, qrOptions, ctx);
        } else {
            // API returns a data URI: "data:image/png;base64,..."
            const base64Data = resp.data.qr_image.startsWith('data:')
                ? resp.data.qr_image.split(',')[1]
                : resp.data.qr_image;
            imageBuffer = Buffer.from(base64Data, 'base64');
        }

        const expired = moment().tz('Asia/Jakarta').add(6, 'minutes').format('YYYYMMDDHHmmss');
        return { imageBuffer, expired, raw: resp };
    }

    /**
     * Check payment by polling mutasi and matching by exact total amount within 6 minutes.
     * @param {Object} params
     * @param {string} params.referenceId - Transaction ID (unused — matching is by amount)
     * @param {number} params.amount - Total amount stored in transaction (base + unique code)
     * @returns {Promise<{ success: boolean, amount?: number, date?: string }>}
     */
    async checkPaymentStatus({ referenceId, amount }) {
        this.validateConfig();

        try {
            const { data: resp } = await axiosInstance.post(
                `${this.baseUrl}/api/qris/mutasi`,
                { auth_username: this.username, auth_token: this.authToken },
                { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, timeout: 10000 }
            );

            const results = resp?.data?.qris_history?.results;
            if (!Array.isArray(results) || results.length === 0) {
                return { success: false };
            }

            const now = moment().tz('Asia/Jakarta');

            for (const item of results) {
                if (item.status !== 'IN') continue;

                // kredit uses Indonesian thousand-separator dots: "50.123" → 50123
                const kredit = parseInt(String(item.kredit).replace(/\./g, ''), 10);
                if (kredit !== amount) continue;

                // tanggal format: "DD/MM/YYYY HH:mm:ss"
                const txTime = moment.tz(item.tanggal, 'DD/MM/YYYY HH:mm:ss', 'Asia/Jakarta');
                if (now.diff(txTime, 'minutes') > 6) continue;

                return {
                    success: true,
                    amount: kredit,
                    date: txTime.format('YYYY-MM-DD HH:mm:ss')
                };
            }

            return { success: false };
        } catch (err) {
            console.error(`[${this.name}] checkPaymentStatus error:`, err.message);
            return { success: false };
        }
    }
}

module.exports = OrderKuotaGateway;
