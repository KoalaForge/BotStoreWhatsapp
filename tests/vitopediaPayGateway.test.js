const axios = require('axios');
const VitopediaPayGateway = require('../src/services/payment/gateways/VitopediaPayGateway');
const paymentGatewayFactory = require('../src/services/payment/PaymentGatewayFactory');

jest.mock('axios', () => ({
    create: jest.fn(() => ({ post: jest.fn(), get: jest.fn() })),
    get: jest.fn(),
}));

const mockClient = axios.create.mock.results[0].value;
const mockPost = mockClient.post;
const mockGet = mockClient.get;

describe('VitopediaPayGateway', () => {
    beforeEach(() => {
        process.env.VITOPEDIAPAY_API_KEY = 'vito_test_key';
        mockPost.mockReset();
        mockGet.mockReset();
        axios.get.mockReset();
    });

    test('is registered in the shared payment gateway factory', () => {
        expect(paymentGatewayFactory.hasGateway('vitopedia')).toBe(true);
    });

    test('creates a QRIS payment and downloads the QR image URL', async () => {
        mockPost.mockResolvedValue({
            data: {
                success: true,
                data: {
                    id: 'pg_123',
                    total: 50045,
                    qr_image: 'https://vitopediapay.com/qr/pg_123.png',
                },
            },
        });
        axios.get.mockResolvedValue({ data: Buffer.from('qr-image') });

        const result = await new VitopediaPayGateway().createQRIS({
            amount: 50000,
            referenceId: 'ORDER-123',
        });

        expect(mockPost).toHaveBeenCalledWith(
            '/pg/create',
            { amount: 50000, ref_id: 'ORDER-123' },
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer vito_test_key' }),
            }),
        );
        expect(axios.get).toHaveBeenCalledWith(
            'https://vitopediapay.com/qr/pg_123.png',
            expect.objectContaining({ responseType: 'arraybuffer' }),
        );
        expect(result.imageBuffer).toEqual(Buffer.from('qr-image'));
        expect(result.totalAmount).toBe(50045);
        expect(result.raw.data.id).toBe('pg_123');
    });

    test('rejects amounts below the official minimum', async () => {
        await expect(new VitopediaPayGateway().createQRIS({
            amount: 999,
            referenceId: 'ORDER-123',
        })).rejects.toThrow('minimum payment amount');
        expect(mockPost).not.toHaveBeenCalled();
    });

    test.each([
        ['pending', false],
        ['expired', false],
        ['paid', true],
    ])('maps %s status to the polling result', async (status, success) => {
        mockGet.mockResolvedValue({
            data: {
                success: true,
                data: { id: 'pg_123', status, total: 50045 },
            },
        });

        const result = await new VitopediaPayGateway().checkPaymentStatus({
            referenceId: 'pg_123',
            amount: 50045,
        });

        expect(result.success).toBe(success);
        expect(mockGet).toHaveBeenCalledWith(
            '/pg/check/pg_123',
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer vito_test_key' }),
            }),
        );
    });
});
