const crypto = require('crypto');

const mockPost = jest.fn();
const mockGet = jest.fn();

jest.mock('axios', () => ({
  create: () => ({ post: mockPost, get: mockGet }),
}));
jest.mock('qrcode', () => ({
  toBuffer: jest.fn(async () => Buffer.from('qr-image')),
}));

const BelibayarGateway = require('../src/services/payment/gateways/BelibayarGateway');

describe('BelibayarGateway', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockReset();
    process.env.BELIBAYAR_API_KEY = 'api-key';
    process.env.BELIBAYAR_SECRET_KEY = 'secret-key';
    process.env.BELIBAYAR_WEBHOOK_SECRET = 'webhook-secret';
    process.env.BELIBAYAR_SANDBOX = 'false';
    delete process.env.BELIBAYAR_BASE_URL;
  });

  it('signs the exact raw JSON body and sends X-Api-Key', async () => {
    mockPost.mockResolvedValue({ data: { data: { reference: 'bb-1', qr_content: 'QR' } } });
    const gateway = new BelibayarGateway();
    const payload = {
      amount: 12500,
      referenceId: 'bb-1',
      paymentMethodCode: 'belibayar-qris',
      customerName: 'Buyer',
    };

    await gateway.createPayment(payload);

    const rawBody = mockPost.mock.calls[0][1];
    expect(rawBody).toBe(JSON.stringify({
      reference: 'bb-1',
      amount: 12500,
      pay_method: { method: 'qris' },
      customer_name: 'Buyer',
    }));
    expect(mockPost.mock.calls[0][2].headers).toEqual(expect.objectContaining({
      'X-Api-Key': 'api-key',
      'X-Signature': crypto.createHmac('sha256', 'secret-key').update(rawBody).digest('hex'),
    }));
  });

  it('sends only documented fields for a QRIS charge', async () => {
    mockPost.mockResolvedValue({ data: { data: { reference: 'bb-1', qr_content: 'QR' } } });
    const gateway = new BelibayarGateway();

    await gateway.createPayment({
      amount: 12500,
      referenceId: 'bb-1',
      paymentMethodCode: 'belibayar-qris',
      customerName: 'Buyer',
      customerPhone: '08123456789',
      description: 'legacy-description',
    });

    expect(JSON.parse(mockPost.mock.calls[0][1])).toEqual({
      reference: 'bb-1',
      amount: 12500,
      pay_method: { method: 'qris' },
      customer_name: 'Buyer',
    });
  });

  it('converts the provider qr_code image into a sendable buffer', async () => {
    mockPost.mockResolvedValue({ data: { data: { qr_code: 'data:image/svg+xml;base64,PHN2Zy8+' } } });
    const gateway = new BelibayarGateway();

    const result = await gateway.createPayment({ amount: 10000, referenceId: 'bb-qr-image', paymentMethodCode: 'belibayar-qris' });

    expect(Buffer.isBuffer(result.imageBuffer)).toBe(true);
    expect(result.qrContent).toBeNull();
  });

  it.each([
    ['belibayar-qris', { pay_method: { method: 'qris' } }],
    ['belibayar-va-bca', { pay_method: { method: 'virtual_account', channel: 'BCA' } }],
    ['belibayar-ewallet-gopay', { pay_method: { method: 'ewallet', channel: 'GOPAY' } }],
    ['belibayar-retail-indomaret', { pay_method: { method: 'virtual_account', channel: 'INDOMARET' } }],
  ])('maps %s to the provider channel', async (methodCode, expected) => {
    mockPost.mockResolvedValue({ data: { data: { reference: 'bb-2' } } });
    const gateway = new BelibayarGateway();

    await gateway.createPayment({ amount: 10000, referenceId: 'bb-2', paymentMethodCode: methodCode });

    expect(JSON.parse(mockPost.mock.calls[0][1])).toEqual(expect.objectContaining({
      reference: 'bb-2',
      amount: 10000,
      ...expected,
    }));
  });

  it('checks status with timestamp HMAC and normalizes paid response', async () => {
    mockGet.mockResolvedValue({ data: { data: { status: 'paid', amount: 10000, paid_at: '2026-08-24 10:00:00' } } });
    jest.spyOn(Date, 'now').mockReturnValue(1724493600000);
    const gateway = new BelibayarGateway();

    const result = await gateway.checkPaymentStatus({ referenceId: 'bb-status' });
    const timestamp = Math.floor(Date.now() / 1000).toString();

    expect(result).toEqual({ success: true, amount: 10000, date: '2026-08-24 10:00:00' });
    expect(mockGet.mock.calls[0][1].headers).toEqual({
      'X-Api-Key': 'api-key',
      'X-Timestamp': timestamp,
      'X-Signature': crypto.createHmac('sha256', 'secret-key').update(`:${timestamp}`).digest('hex'),
    });
    Date.now.mockRestore();
  });

  it('supports cancel, payment links, sandbox URL, and injected credentials', async () => {
    mockPost.mockResolvedValue({ data: { ok: true } });
    process.env.BELIBAYAR_SANDBOX = 'true';
    const gateway = new BelibayarGateway();
    gateway.setCredentials({ api_key: 'owner-api', secret_key: 'owner-secret' });

    await gateway.cancelPayment('bb-cancel');
    await gateway.createPaymentLink({ amount: 20000, referenceId: 'bb-link' });
    await gateway.getPaymentLinkStatus('bb-link');
    await gateway.cancelPaymentLink('bb-link');

    expect(mockPost.mock.calls[0][0]).toBe('https://api.belibayar.id/direct/v1/sandbox/payment/cancel');
    expect(mockPost.mock.calls[1][0]).toBe('https://api.belibayar.id/direct/v1/sandbox/payment-link');
    expect(mockPost.mock.calls[2][0]).toBe('https://api.belibayar.id/direct/v1/sandbox/payment-link/status');
    expect(mockPost.mock.calls[3][0]).toBe('https://api.belibayar.id/direct/v1/sandbox/payment-link/cancel');
    expect(mockPost.mock.calls[0][2].headers['X-Api-Key']).toBe('owner-api');
  });
});
