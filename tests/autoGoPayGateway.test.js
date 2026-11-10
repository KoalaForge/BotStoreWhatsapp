/**
 * @file Unit tests for AutoGoPayGateway (WhatsApp)
 */

const mockPost = jest.fn();
const mockGet = jest.fn();

jest.mock('axios', () => ({
  create: () => ({ post: mockPost, get: mockGet }),
}));

jest.mock('../src/services/payment/utils/qrCodeGenerator', () => ({
  generateQRCodeWithTemplate: jest.fn().mockResolvedValue(Buffer.from('mock-overlay-qr')),
  isQrisOverlayEnabled: jest.fn().mockResolvedValue(false),
}));

jest.mock('../src/repositories/TransactionRepository', () => ({
  findOne: jest.fn(),
  find: jest.fn(),
}));

const AutoGoPayGateway = require('../src/services/payment/gateways/AutoGoPayGateway');
const { isQrisOverlayEnabled, generateQRCodeWithTemplate } = require('../src/services/payment/utils/qrCodeGenerator');
const transactionRepository = require('../src/repositories/TransactionRepository');

describe('AutoGoPayGateway', () => {
  let gateway;

  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockReset();
    isQrisOverlayEnabled.mockReset().mockResolvedValue(false);
    generateQRCodeWithTemplate.mockReset().mockResolvedValue(Buffer.from('mock-overlay-qr'));
    transactionRepository.findOne.mockReset().mockResolvedValue(null);
    transactionRepository.find.mockReset().mockResolvedValue([]);

    gateway = new AutoGoPayGateway();
    gateway.apiKey = 'test-api-key';
    gateway.channel = 'autogopay-gopay';
  });

  describe('constructor', () => {
    it('sets correct defaults', () => {
      const gw = new AutoGoPayGateway();
      expect(gw.name).toBe('AutoGoPay');
      expect(gw.baseUrl).toBe('https://v1-gateway.autogopay.site');
    });
  });

  describe('validateConfig()', () => {
    it('throws if apiKey is missing', () => {
      gateway.apiKey = null;
      expect(() => gateway.validateConfig()).toThrow(/API Key is required/);
    });

    it('throws if channel is missing', () => {
      gateway.channel = null;
      expect(() => gateway.validateConfig()).toThrow(/Missing or invalid AutoGoPay channel/);
    });

    it('throws if channel is unrecognized', () => {
      gateway.channel = 'autogopay-doesnotexist';
      expect(() => gateway.validateConfig()).toThrow(/Missing or invalid AutoGoPay channel/);
    });

    it('throws for OVO channel without a merchant phone number', () => {
      gateway.channel = 'autogopay-ovo';
      gateway.ovoPhoneNumber = null;
      expect(() => gateway.validateConfig()).toThrow(/OVO merchant phone number/);
    });

    it('passes for OVO channel with a merchant phone number', () => {
      gateway.channel = 'autogopay-ovo';
      gateway.ovoPhoneNumber = '081234567890';
      expect(gateway.validateConfig()).toBe(true);
    });

    it('returns true for a valid non-OVO channel', () => {
      expect(gateway.validateConfig()).toBe(true);
    });
  });

  describe('_applyCredentials()', () => {
    it('applies apiKey, method and ovoPhoneNumber (camelCase)', () => {
      gateway._applyCredentials({ apiKey: 'new-key', method: 'autogopay-ovo', ovoPhoneNumber: '0811' });
      expect(gateway.apiKey).toBe('new-key');
      expect(gateway.channel).toBe('autogopay-ovo');
      expect(gateway.ovoPhoneNumber).toBe('0811');
    });

    it('applies snake_case variants', () => {
      gateway._applyCredentials({ api_key: 'snake-key', ovo_phone_number: '0822' });
      expect(gateway.apiKey).toBe('snake-key');
      expect(gateway.ovoPhoneNumber).toBe('0822');
    });
  });

  describe('getPaymentMethodCode()', () => {
    it('returns the full configured method code', () => {
      expect(gateway.getPaymentMethodCode()).toBe('autogopay-gopay');
    });
  });

  describe('getFeePercentage() / getFeeFixed()', () => {
    it('both return 0', () => {
      expect(gateway.getFeePercentage()).toBe(0);
      expect(gateway.getFeeFixed()).toBe(0);
    });
  });

  describe('createQRIS() — single active payment guard', () => {
    it('throws without calling the provider when a pending AutoGoPay payment already exists for this buyer', async () => {
      transactionRepository.findOne.mockResolvedValue({ transactionId: 'EXISTING-TX' });

      await expect(gateway.createQRIS({
        amount: 10000,
        referenceId: 'NEW-TX',
        customerId: '12345',
      })).rejects.toThrow(/pembayaran AutoGoPay yang belum selesai/);

      expect(mockPost).not.toHaveBeenCalled();
    });

    it('proceeds when no active payment exists', async () => {
      transactionRepository.findOne.mockResolvedValue(null);
      mockPost.mockResolvedValue({
        data: { success: true, data: { transaction_id: 'TRX-1', qr_string: '00020101', expiry_time: '2026-11-10 15:00:00' } },
      });

      const result = await gateway.createQRIS({ amount: 10000, referenceId: 'NEW-TX', customerId: '12345' });

      expect(mockPost).toHaveBeenCalled();
      expect(result.reference).toBe('TRX-1');
    });
  });

  describe('createQRIS() — GoPay', () => {
    it('POSTs to /qris/generate with Bearer auth and the base amount', async () => {
      mockPost.mockResolvedValue({
        data: { success: true, data: { transaction_id: 'TRX-1', qr_string: '00020101', expiry_time: '2026-11-10 15:00:00' } },
      });

      await gateway.createQRIS({ amount: 50000, referenceId: 'ORD-1', customerId: '123' });

      expect(mockPost).toHaveBeenCalledWith(
        'https://v1-gateway.autogopay.site/qris/generate',
        { amount: 50000 },
        expect.objectContaining({
          headers: expect.objectContaining({ 'Authorization': 'Bearer test-api-key' }),
        }),
      );
    });

    it('renders the QR via generateQRCodeWithTemplate when overlay is enabled', async () => {
      isQrisOverlayEnabled.mockResolvedValue(true);
      mockPost.mockResolvedValue({
        data: { success: true, data: { transaction_id: 'TRX-1', qr_string: '00020101', expiry_time: '2026-11-10 15:00:00' } },
      });

      const result = await gateway.createQRIS({ amount: 50000, referenceId: 'ORD-1', customerId: '123' });

      expect(generateQRCodeWithTemplate).toHaveBeenCalledWith('00020101', {}, null);
      expect(result.imageBuffer).toEqual(Buffer.from('mock-overlay-qr'));
    });

    it('returns the raw qr_url when overlay is disabled', async () => {
      mockPost.mockResolvedValue({
        data: { success: true, data: { transaction_id: 'TRX-1', qr_string: '00020101', qr_url: 'https://example.com/qr.png', expiry_time: '2026-11-10 15:00:00' } },
      });

      const result = await gateway.createQRIS({ amount: 50000, referenceId: 'ORD-1', customerId: '123' });

      expect(result.imageBuffer).toBe('https://example.com/qr.png');
    });

    it('throws when the response reports failure', async () => {
      mockPost.mockResolvedValue({ data: { success: false, message: 'Invalid API key' } });

      await expect(gateway.createQRIS({ amount: 50000, referenceId: 'ORD-1', customerId: '123' }))
        .rejects.toThrow(/Invalid API key/);
    });

    it('never generates more than once per call — a single createQRIS() call issues exactly one HTTP request', async () => {
      mockPost.mockResolvedValue({
        data: { success: true, data: { transaction_id: 'TRX-1', qr_string: '00020101', expiry_time: '2026-11-10 15:00:00' } },
      });

      await gateway.createQRIS({ amount: 50000, referenceId: 'ORD-1', customerId: '123' });

      expect(mockPost).toHaveBeenCalledTimes(1);
    });
  });

  describe('createQRIS() — OVO', () => {
    beforeEach(() => {
      gateway.channel = 'autogopay-ovo';
      gateway.ovoPhoneNumber = '081234567890';
    });

    it('makes no HTTP call and returns payment instructions instead of an image', async () => {
      const result = await gateway.createQRIS({ amount: 15000, referenceId: 'ORD-OVO', customerId: '999' });

      expect(mockPost).not.toHaveBeenCalled();
      expect(mockGet).not.toHaveBeenCalled();
      expect(result.imageBuffer).toBeNull();
      expect(result.paymentInstructions).toMatch(/081234567890/);
      expect(result.paymentInstructions).toMatch(/15.000|15000/);
    });
  });

  describe('createQRIS() — unique code surcharge for mutation-matched channels', () => {
    beforeEach(() => {
      gateway.channel = 'autogopay-instaqris';
    });

    it('charges the base amount with offset 0 when no pending order occupies it', async () => {
      transactionRepository.find.mockResolvedValue([]);
      mockPost.mockResolvedValue({
        data: { success: true, data: { bill_number: 'BILL-1', qr_url: 'https://example.com/qr.png', expires_in: 900 } },
      });

      await gateway.createQRIS({ amount: 20000, referenceId: 'ORD-IQ', customerId: '1' });

      expect(mockPost).toHaveBeenCalledWith(
        'https://v1-gateway.autogopay.site/instaqris/create',
        { amount: 20000 },
        expect.anything(),
      );
    });

    it('skips an occupied offset and charges base + 1', async () => {
      transactionRepository.find.mockResolvedValue([{ totalPrice: 20000, payment_fee: 0 }]);
      mockPost.mockResolvedValue({
        data: { success: true, data: { bill_number: 'BILL-2', qr_url: 'https://example.com/qr.png', expires_in: 900 } },
      });

      const result = await gateway.createQRIS({ amount: 20000, referenceId: 'ORD-IQ2', customerId: '1' });

      expect(mockPost).toHaveBeenCalledWith(
        'https://v1-gateway.autogopay.site/instaqris/create',
        { amount: 20001 },
        expect.anything(),
      );
      expect(result.uniqueCode).toBe(1);
    });

    it('does not apply a surcharge for GoPay (not mutation-matched)', async () => {
      gateway.channel = 'autogopay-gopay';
      mockPost.mockResolvedValue({
        data: { success: true, data: { transaction_id: 'TRX-1', qr_string: '00020101', expiry_time: '2026-11-10 15:00:00' } },
      });

      const result = await gateway.createQRIS({ amount: 20000, referenceId: 'ORD-GP', customerId: '1' });

      expect(mockPost).toHaveBeenCalledWith(
        'https://v1-gateway.autogopay.site/qris/generate',
        { amount: 20000 },
        expect.anything(),
      );
      expect(result.uniqueCode).toBe(0);
    });
  });

  describe('checkPaymentStatus()', () => {
    it('GoPay: returns success=true for settlement status', async () => {
      mockPost.mockResolvedValue({ data: { data: { transaction_status: 'settlement', amount: 50000 } } });

      const result = await gateway.checkPaymentStatus({ referenceId: 'TRX-1' });

      expect(result.success).toBe(true);
      expect(result.amount).toBe(50000);
    });

    it('GoPay: returns success=false for pending status', async () => {
      mockPost.mockResolvedValue({ data: { data: { transaction_status: 'pending' } } });

      const result = await gateway.checkPaymentStatus({ referenceId: 'TRX-1' });

      expect(result.success).toBe(false);
    });

    it('ShopeePay: returns success=true for success status', async () => {
      gateway.channel = 'autogopay-shopeepay';
      mockGet.mockResolvedValue({ data: { data: { status: 'success', amount: 30000, paid_at: '2026-11-10 10:00:00' } } });

      const result = await gateway.checkPaymentStatus({ referenceId: 'ORDER-SN-1' });

      expect(result.success).toBe(true);
      expect(mockGet).toHaveBeenCalledWith(
        'https://v1-gateway.autogopay.site/shopeepay/qris/status',
        expect.objectContaining({ params: { order_sn: 'ORDER-SN-1', router_id: 1 } }),
      );
    });

    it('Interactive: splits the packed reference into invoice_id and ref_no', async () => {
      gateway.channel = 'autogopay-interactive';
      mockPost.mockResolvedValue({ data: { data: { status: 'success', amount: 10000 } } });

      const result = await gateway.checkPaymentStatus({ referenceId: 'INV-1|REF-1' });

      expect(result.success).toBe(true);
      expect(mockPost).toHaveBeenCalledWith(
        'https://v1-gateway.autogopay.site/interactive/qris/status',
        { invoice_id: 'INV-1', ref_no: 'REF-1' },
        expect.anything(),
      );
    });

    it('Interactive: returns success=false for a malformed reference', async () => {
      gateway.channel = 'autogopay-interactive';

      const result = await gateway.checkPaymentStatus({ referenceId: 'not-packed' });

      expect(result.success).toBe(false);
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('InstaQRIS/BCA/OVO: always return success=false with zero network calls', async () => {
      for (const channel of ['autogopay-instaqris', 'autogopay-bca', 'autogopay-ovo']) {
        gateway.channel = channel;
        const result = await gateway.checkPaymentStatus({ referenceId: 'whatever' });
        expect(result.success).toBe(false);
      }

      expect(mockPost).not.toHaveBeenCalled();
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('returns success=false on HTTP error', async () => {
      mockPost.mockRejectedValue(new Error('Network error'));

      const result = await gateway.checkPaymentStatus({ referenceId: 'TRX-1' });

      expect(result.success).toBe(false);
    });
  });
});
