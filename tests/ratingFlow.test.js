describe('WhatsApp rating flow', () => {
    let ratingApiService;
    let handleProductRating;

    beforeEach(() => {
        jest.resetModules();
        ratingApiService = {
            submitRating: jest.fn().mockResolvedValue({ success: true }),
            skipRating: jest.fn().mockResolvedValue({ success: true })
        };
        jest.doMock('../src/services/ratingApiService', () => ratingApiService);
        jest.doMock('../src/utils/featureFlags', () => ({
            isFeatureEnabled: jest.fn().mockResolvedValue(true)
        }));
        handleProductRating = require('../src/actions/handleProductRating');
    });

    test('submits explicit ratings with the acting WhatsApp user', async () => {
        const ctx = {
            message: '.rating INV-123 5',
            from: '628123@s.whatsapp.net',
            reply: jest.fn().mockResolvedValue()
        };

        await expect(handleProductRating(ctx)).resolves.toEqual({
            handled: true,
            success: true,
            terminal: true
        });
        expect(ratingApiService.submitRating).toHaveBeenCalledWith({
            transactionId: 'INV-123',
            channelUserId: '628123@s.whatsapp.net',
            rating: 5
        });
        expect(ctx.reply).toHaveBeenCalledWith('Terima kasih! Rating 5/5 kamu sudah tersimpan.');
    });

    test('supports skip from a pending rating screen', async () => {
        const ctx = {
            message: 'lewati',
            from: '628123@s.whatsapp.net',
            reply: jest.fn().mockResolvedValue()
        };

        const result = await handleProductRating(ctx, { transactionId: 'INV-456', skip: true });

        expect(result.terminal).toBe(true);
        expect(ratingApiService.skipRating).toHaveBeenCalledWith({
            transactionId: 'INV-456',
            channelUserId: '628123@s.whatsapp.net'
        });
    });

    test('marks permanent backend rejections as terminal', async () => {
        ratingApiService.submitRating.mockRejectedValue({
            status: 422,
            reason: 'Periode rating 24 jam telah berakhir.'
        });
        const ctx = {
            message: 'rating INV-789 4',
            from: '628123@s.whatsapp.net',
            reply: jest.fn().mockResolvedValue()
        };

        const result = await handleProductRating(ctx);

        expect(result).toMatchObject({ success: false, terminal: true });
        expect(ctx.reply).toHaveBeenCalledWith('Periode rating 24 jam sudah berakhir.');
    });

    test('formats product and variant summaries consistently', () => {
        jest.dontMock('../src/services/ratingApiService');
        const formatter = require('../src/utils/waMessageFormatter');

        expect(formatter.formatRatingSummary({ average: 5, count: 16 }))
            .toBe('Rating: 5.0/5 (16 ulasan)');
        expect(formatter.formatRatingSummary({ average: 0, count: 0 }))
            .toBe('Rating: Belum ada ulasan');
        expect(formatter.formatRatingSummary(null)).toBe('');
    });
});
