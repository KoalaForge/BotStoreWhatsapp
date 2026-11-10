const axios = require('axios');
const moment = require('moment-timezone');
const BasePaymentGateway = require('./BasePaymentGateway');
const { generateQRCodeWithTemplate, isQrisOverlayEnabled } = require('../utils/qrCodeGenerator');
const transactionRepository = require('../../../repositories/TransactionRepository');

const axiosInstance = axios.create({
  timeout: 30000,
  headers: {
    'Connection': 'keep-alive',
    'Keep-Alive': 'timeout=5, max=1000'
  }
});

// Full payment_methods.code values, matching koalabotbe's seeded AutoGoPay
// methods exactly (AutoGoPayCredentialsData.channel() on the Laravel side
// requires this same full-code format, not a bare channel slug — the shared
// GatewayResolverService._resolveFeeConfig() queries PaymentMethod by
// `credentials.method` expecting it to equal `code` verbatim).
const CHANNEL_METHOD_CODES = {
  gopay: 'autogopay-gopay',
  shopeepay: 'autogopay-shopeepay',
  interactive: 'autogopay-interactive',
  instaqris: 'autogopay-instaqris',
  bca: 'autogopay-bca',
  ovo: 'autogopay-ovo'
};

// InstaQRIS/BCA/OVO have no webhook and no per-transaction status check on
// AutoGoPay's side — confirmed from https://autogopay.site/docs. Settlement
// for these three is handled entirely by koalabotbe's own
// PollAutoGoPayMutationsCommand (mutation matching against the shared
// order_transactions collection), which is why they need the amount
// surcharge below and why checkPaymentStatus() is a no-op for them here.
const MUTATION_MATCHED_CHANNELS = new Set(['instaqris', 'bca', 'ovo']);
const MIN_UNIQUE_CODE = 0;
const MAX_UNIQUE_CODE = 50;

/**
 * AutoGoPay Payment Gateway — one API key, six channels behind it (GoPay,
 * ShopeePay, QRIS Interactive, InstaQRIS, BCA Merchant, OVO). Which channel
 * this merchant uses is fixed by `credentials.method` / AUTOGOPAY_METHOD —
 * unlike koalabotbe, which resolves the channel per-request from the order's
 * own payment method, this bot calls the gateway directly so there is only
 * ever one channel active per owner.
 *
 * CRITICAL — two rules, confirmed from https://autogopay.site/docs plus a
 * direct provider clarification outside their written docs (chat,
 * 2026-11-10): max 1-2 QRIS generates per transaction, AND max 1 active
 * payment per buyer at a time. koalabotbe's own guards
 * (AutoGoPayQrisGuard / EnsureSingleActivePaymentAction) do NOTHING to
 * protect this code path — this bot calls AutoGoPay directly, bypassing
 * koalabotbe entirely for the generate step. See _ensureSingleActivePayment().
 *
 * The per-transaction generate cap doesn't need a separate counter here: this
 * codebase always mints a brand-new transaction ID per createQRIS() call
 * (see qrisService.js), so the only way a buyer could ever trigger a second
 * generate against an already-pending transaction is by starting a NEW one
 * while the old one is still active — which is exactly what
 * _ensureSingleActivePayment() blocks.
 *
 * Ported from OrkutTelegram5.0's AutoGoPayGateway.js. The only structural
 * difference is HTTP plumbing: WhatsApp has no pgTrace.js/createTracedClient
 * (every other WA gateway uses a plain axios instance too), so this one does
 * the same.
 */
class AutoGoPayGateway extends BasePaymentGateway {
  constructor() {
    super('AutoGoPay');
    this.baseUrl = 'https://v1-gateway.autogopay.site';
    this.apiKey = null; // No .env fallback for the bare key — must come from credentials or AUTOGOPAY_API_KEY
    this.channel = process.env.AUTOGOPAY_METHOD || null; // e.g. 'autogopay-gopay'
    this.ovoPhoneNumber = process.env.AUTOGOPAY_OVO_PHONE || null;

    if (process.env.AUTOGOPAY_API_KEY) this.apiKey = process.env.AUTOGOPAY_API_KEY;

    // We always compute the final charge ourselves (base + unique-code
    // surcharge where applicable) and send it as-is — the orchestrator must
    // never add its own provisional fee on top (getFeePercentage/getFeeFixed
    // are already 0, so this is currently a no-op, but explicit here matches
    // Qrispy's same "I own my own total" contract rather than relying on
    // coincidence).
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
    if (creds.method) this.channel = creds.method;
    if (creds.payment_method_code) this.channel = creds.payment_method_code;
    if (creds.ovoPhoneNumber) this.ovoPhoneNumber = creds.ovoPhoneNumber;
    if (creds.ovo_phone_number) this.ovoPhoneNumber = creds.ovo_phone_number;
  }

  validateConfig() {
    if (!this.apiKey) {
      throw new Error('Missing AutoGoPay configuration. API Key is required.');
    }

    if (!this._channelSlug()) {
      throw new Error(`Missing or invalid AutoGoPay channel. Set AUTOGOPAY_METHOD to one of: ${Object.values(CHANNEL_METHOD_CODES).join(', ')}`);
    }

    if (this._channelSlug() === 'ovo' && !this.ovoPhoneNumber) {
      throw new Error('Missing AutoGoPay OVO merchant phone number. Set AUTOGOPAY_OVO_PHONE or credentials.ovoPhoneNumber.');
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
    return this.channel;
  }

  /**
   * Resolve the bare channel slug ('gopay', 'ovo', ...) from the configured
   * full method code ('autogopay-gopay'). Returns null if unset/unrecognized.
   * @returns {string|null}
   * @private
   */
  _channelSlug() {
    if (!this.channel) return null;
    const slug = this.channel.replace(/^autogopay-/, '');
    return CHANNEL_METHOD_CODES[slug] ? slug : null;
  }

  /**
   * Create an AutoGoPay payment for the configured channel.
   *
   * @param {Object} params
   * @param {number} params.amount - Base payment amount (before any unique code surcharge)
   * @param {string} params.referenceId - Our own transaction ID (NOT accepted by AutoGoPay — kept for logging only)
   * @param {string} params.customerId - Customer ID (WhatsApp JID/number)
   * @param {Object} [params.qrOptions={}] - QR code styling options
   * @param {Object} [params.ctx=null] - WaCtx context (for ownerId scoping + overlay settings)
   * @returns {Promise<{imageBuffer: Buffer|string, expired: string, raw: any, reference: string, uniqueCode: number}>}
   */
  async createQRIS({ amount, referenceId, customerId, qrOptions = {}, ctx = null }) {
    this.validateConfig();

    await this._ensureSingleActivePayment(ctx, customerId);

    const channel = this._channelSlug();
    const uniqueCode = MUTATION_MATCHED_CHANNELS.has(channel)
      ? await this._reserveUniqueCode(ctx, channel, amount)
      : 0;
    const chargeAmount = amount + uniqueCode;

    const created = await this._createForChannel(channel, chargeAmount);
    const imageBuffer = await this._resolveImageSource(created, qrOptions, ctx);

    return {
      imageBuffer,
      expired: created.expired,
      raw: created.raw,
      reference: created.reference,
      uniqueCode,
      // OVO has no QR at all — qrisService falls back to a text-only message
      // via _formatPaymentInstruction() when imageBuffer is falsy.
      paymentInstructions: created.paymentInstructions || null
    };
  }

  /**
   * Check AutoGoPay payment status. Only meaningful for GoPay, ShopeePay and
   * QRIS Interactive — the other three have no per-transaction check and
   * always return {success: false} without any network call (see
   * MUTATION_MATCHED_CHANNELS doc above).
   *
   * @param {Object} params
   * @param {string} params.referenceId - AutoGoPay's own reference, as stored on gateway_reference.
   *                                      For Interactive this is packed as "invoiceId|refNo".
   * @returns {Promise<{success: boolean, amount?: number, date?: string}>}
   */
  async checkPaymentStatus({ referenceId }) {
    const channel = this._channelSlug();

    if (!channel || MUTATION_MATCHED_CHANNELS.has(channel) || !referenceId) {
      return { success: false };
    }

    try {
      if (channel === 'gopay') return await this._statusGoPay(referenceId);
      if (channel === 'shopeepay') return await this._statusShopeePay(referenceId);
      if (channel === 'interactive') return await this._statusInteractive(referenceId);
      return { success: false };
    } catch (err) {
      console.error(`[${this.name}] checkPaymentStatus error:`, err.message);
      return { success: false };
    }
  }

  /**
   * Guard against AutoGoPay's out-of-band rule: a buyer may only have ONE
   * active AutoGoPay payment at a time — no second transaction while a
   * previous one is still pending and unexpired. Checked here, before any
   * provider call, because this codebase always mints a fresh transaction ID
   * per generate — the new transaction row isn't persisted until AFTER
   * createQRIS() returns, so this only ever sees genuinely OTHER pending rows.
   * @private
   */
  async _ensureSingleActivePayment(ctx, customerId) {
    const context = ctx?.repositoryContext || {};
    const existing = await transactionRepository.findOne(context, {
      user_id: String(customerId),
      payment_method_code: { $in: Object.values(CHANNEL_METHOD_CODES) },
      payment_status: 'pending',
      isSuccess: false,
      isCanceled: false,
      expires_at: { $gt: new Date() }
    });

    if (existing) {
      const err = new Error('Anda masih punya pembayaran AutoGoPay yang belum selesai. Selesaikan dulu atau tunggu kedaluwarsa sebelum membuat transaksi baru.');
      err.autogopayExistingTransactionId = existing.transactionId;
      throw err;
    }
  }

  /**
   * Picks an amount surcharge (0-50) that disambiguates concurrent AutoGoPay
   * orders during koalabotbe's mutation matching — mirrors
   * ReserveUniqueCodeAction on the Laravel side exactly (same collection,
   * same selection: pending + same method code + same base amount).
   *
   * Best-effort only: this bot and koalabotbe's own web checkout (and any
   * sibling bot in MULTI mode) all allocate independently against the same
   * collection, so a genuine cross-process race is possible if two requests
   * land at the exact same instant — accepted risk, same class as the
   * existing collision-check in qrisService.js.
   * @private
   */
  async _reserveUniqueCode(ctx, channel, baseAmount) {
    const context = ctx?.repositoryContext || {};
    const methodCode = CHANNEL_METHOD_CODES[channel];

    const pending = await transactionRepository.find(context, {
      payment_method_code: methodCode,
      payment_status: 'pending',
      isSuccess: false,
      isCanceled: false,
      expires_at: { $gt: new Date() }
    });

    const occupied = new Set(pending.map((t) => (t.totalPrice || 0) + (t.payment_fee || 0)));

    for (let offset = MIN_UNIQUE_CODE; offset <= MAX_UNIQUE_CODE; offset++) {
      if (!occupied.has(baseAmount + offset)) return offset;
    }

    throw new Error('Kode unik AutoGoPay sedang penuh, coba lagi sebentar lagi.');
  }

  /**
   * @private
   */
  _headers() {
    return {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };
  }

  /**
   * @returns {Promise<{qrString: string|null, qrUrl: string|null, reference: string, expired: string, raw: any, paymentInstructions?: string}>}
   * @private
   */
  async _createForChannel(channel, amount) {
    switch (channel) {
      case 'gopay': return this._createGoPay(amount);
      case 'shopeepay': return this._createShopeePay(amount);
      case 'interactive': return this._createInteractive(amount);
      case 'instaqris': return this._createInstaQris(amount);
      case 'bca': return this._createBca(amount);
      case 'ovo': return this._createOvo(amount);
      default: throw new Error(`Unsupported AutoGoPay channel: ${channel}`);
    }
  }

  async _createGoPay(amount) {
    const { data: resp } = await axiosInstance.post(`${this.baseUrl}/qris/generate`, { amount }, this._headers());
    if (resp.success === false || !resp.data) throw new Error(`AutoGoPay GoPay: ${resp.message || 'Gagal membuat QRIS'}`);
    const d = resp.data;
    if (!d.transaction_id) throw new Error('AutoGoPay GoPay: respons tidak membawa transaction_id');

    return {
      qrString: d.qr_string || null,
      qrUrl: d.qr_url || null,
      reference: d.transaction_id,
      expired: this._toExpiredToken(d.expiry_time),
      raw: resp
    };
  }

  async _createShopeePay(amount) {
    const { data: resp } = await axiosInstance.post(`${this.baseUrl}/shopeepay/qris/create`, { amount }, this._headers());
    if (resp.success === false || !resp.data) throw new Error(`AutoGoPay ShopeePay: ${resp.message || 'Gagal membuat QRIS'}`);
    const d = resp.data;
    if (!d.order_sn) throw new Error('AutoGoPay ShopeePay: respons tidak membawa order_sn');

    return {
      qrString: d.qr_string || null,
      qrUrl: d.qr_url || null,
      reference: d.order_sn,
      expired: this._toExpiredToken(d.expiry_time),
      raw: resp
    };
  }

  async _createInteractive(amount) {
    const { data: resp } = await axiosInstance.post(`${this.baseUrl}/interactive/qris/create`, { amount }, this._headers());
    if (resp.success === false || !resp.data) throw new Error(`AutoGoPay Interactive: ${resp.message || 'Gagal membuat QRIS'}`);
    const d = resp.data;
    if (!d.invoice_id || !d.ref_no) throw new Error('AutoGoPay Interactive: respons tidak membawa invoice_id/ref_no');

    return {
      qrString: d.qr_string || null,
      qrUrl: d.qr_url || null,
      // Packed: checkPaymentStatus() needs BOTH invoice_id and ref_no, but the
      // shared gateway interface only carries a single referenceId string.
      reference: `${d.invoice_id}|${d.ref_no}`,
      expired: this._toExpiredToken(d.expired_date || d.timestamp),
      raw: resp
    };
  }

  async _createInstaQris(amount) {
    const { data: resp } = await axiosInstance.post(`${this.baseUrl}/instaqris/create`, { amount }, this._headers());
    if (resp.success === false || !resp.data) throw new Error(`AutoGoPay InstaQRIS: ${resp.message || 'Gagal membuat QRIS'}`);
    const d = resp.data;
    if (!d.bill_number) throw new Error('AutoGoPay InstaQRIS: respons tidak membawa bill_number');

    const expiresInSeconds = typeof d.expires_in === 'number' ? d.expires_in : 900;
    return {
      // InstaQRIS never returns a raw qr_string — only a hosted qr_url that
      // 404s after expiry (see AutoGoPayChannel doc on the Laravel side).
      qrString: null,
      qrUrl: d.qr_url || null,
      reference: d.bill_number,
      expired: moment().tz('Asia/Jakarta').add(expiresInSeconds, 'seconds').format('YYYYMMDDHHmmss'),
      raw: resp
    };
  }

  async _createBca(amount) {
    const { data: resp } = await axiosInstance.post(`${this.baseUrl}/bca/qris/create`, { amount }, this._headers());
    if (resp.success === false || !resp.data) throw new Error(`AutoGoPay BCA: ${resp.message || 'Gagal membuat QRIS'}`);
    const d = resp.data;
    if (!d.transaction_id) throw new Error('AutoGoPay BCA: respons tidak membawa transaction_id');

    return {
      qrString: d.qr_string || null,
      qrUrl: d.qr_url || null,
      reference: d.transaction_id,
      expired: this._toExpiredToken(d.expiry_time),
      raw: resp
    };
  }

  /**
   * OVO has no create endpoint — the merchant number is a standing transfer
   * target. No HTTP call; we mint our own reference since AutoGoPay gives us
   * nothing to key on, and payment instructions carry the unique code the
   * buyer must transfer exactly.
   * @private
   */
  async _createOvo(amount) {
    const reference = `AUTOGOPAY-OVO-${Date.now()}`;
    const expired = moment().tz('Asia/Jakarta').add(15, 'minutes').format('YYYYMMDDHHmmss');
    const formattedAmount = amount.toLocaleString('id-ID');

    return {
      qrString: null,
      qrUrl: null,
      reference,
      expired,
      raw: { channel: 'ovo', ovo_phone_number: this.ovoPhoneNumber, amount },
      paymentInstructions: `Transfer PERSIS Rp ${formattedAmount} ke OVO ${this.ovoPhoneNumber}. Nominal harus persis sama agar pembayaran otomatis terverifikasi.`
    };
  }

  async _statusGoPay(referenceId) {
    const { data: resp } = await axiosInstance.post(`${this.baseUrl}/qris/status`, { transaction_id: referenceId }, { ...this._headers(), timeout: 10000 });
    const status = resp?.data?.transaction_status;
    if (status !== 'settlement') return { success: false };

    return {
      success: true,
      amount: typeof resp.data.amount === 'number' ? resp.data.amount : undefined,
      date: moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss')
    };
  }

  async _statusShopeePay(referenceId) {
    const { data: resp } = await axiosInstance.get(`${this.baseUrl}/shopeepay/qris/status`, {
      ...this._headers(),
      params: { order_sn: referenceId, router_id: 1 },
      timeout: 10000
    });
    const status = resp?.data?.status;
    if (status !== 'success') return { success: false };

    return {
      success: true,
      amount: typeof resp.data.amount === 'number' ? resp.data.amount : undefined,
      date: resp.data.paid_at
        ? moment(resp.data.paid_at).tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss')
        : moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss')
    };
  }

  /**
   * Calling this endpoint is what triggers AutoGoPay to push its webhook for
   * Interactive transactions — this status poll isn't just a read, it's the
   * mechanism that makes settlement happen at all for this channel.
   */
  async _statusInteractive(referenceId) {
    const [invoiceId, refNo] = String(referenceId).split('|');
    if (!invoiceId || !refNo) return { success: false };

    const { data: resp } = await axiosInstance.post(
      `${this.baseUrl}/interactive/qris/status`,
      { invoice_id: invoiceId, ref_no: refNo },
      { ...this._headers(), timeout: 10000 }
    );
    const status = resp?.data?.status;
    if (status !== 'success') return { success: false };

    return {
      success: true,
      amount: typeof resp.data.amount === 'number' ? resp.data.amount : undefined,
      date: resp.data.paid_at
        ? moment(resp.data.paid_at).tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss')
        : moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss')
    };
  }

  /**
   * @param {string|null} value - Provider's own "YYYY-MM-DD HH:mm:ss" string
   * @returns {string} YYYYMMDDHHmmss, Asia/Jakarta
   * @private
   */
  _toExpiredToken(value) {
    if (value) {
      const parsed = moment.tz(value, 'YYYY-MM-DD HH:mm:ss', 'Asia/Jakarta');
      if (parsed.isValid()) return parsed.format('YYYYMMDDHHmmss');
    }
    return moment().tz('Asia/Jakarta').add(15, 'minutes').format('YYYYMMDDHHmmss');
  }

  /**
   * Resolve what the WA handlers will actually send: a raw QRIS string gets
   * rendered (and optionally template-overlaid) into an image; a hosted
   * qr_url (InstaQRIS — no string available) is passed straight through, since
   * resolveImageBuffer() in the handlers already fetches HTTP(S) URL strings
   * itself; no QR at all (OVO) returns null, falling back to a text-only
   * message via qrisService's _formatPaymentInstruction().
   * @private
   */
  async _resolveImageSource(created, qrOptions, ctx) {
    if (created.qrString) {
      return await isQrisOverlayEnabled(ctx)
        ? await generateQRCodeWithTemplate(created.qrString, qrOptions, ctx)
        : created.qrUrl || created.qrString;
    }

    return created.qrUrl || null;
  }
}

AutoGoPayGateway.CHANNEL_METHOD_CODES = CHANNEL_METHOD_CODES;

module.exports = AutoGoPayGateway;
