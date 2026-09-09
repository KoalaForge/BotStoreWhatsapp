jest.mock('../src/services/ratingApiService', () => ({
    submitRating: jest.fn(),
    skipRating: jest.fn()
}));
jest.mock('../src/utils/featureFlags', () => ({
    isFeatureEnabled: jest.fn().mockResolvedValue(true)
}));
jest.mock('../src/actions', () => ({
    handleProductRating: jest.fn(),
    handleBuyerNotes: { handleBuyerNotesInput: jest.fn().mockResolvedValue(false) },
    voucherActions: { handleVoucherCodeInput: jest.fn() },
    backToProductList: jest.fn(),
    handleProductList: jest.fn()
}));
jest.mock('../src/actions/showPesanan', () => ({ prepareOrder: jest.fn() }));
jest.mock('../src/command/exportCommand', () => ({}));
jest.mock('../src/state/voucherState', () => ({
    isAwaitingVoucherCode: jest.fn().mockResolvedValue(false)
}));
jest.mock('../src/state/snkState', () => ({
    isAwaitingTerms: jest.fn().mockReturnValue(false),
    isAwaitingWarranty: jest.fn().mockReturnValue(false)
}));
jest.mock('../src/state/addStockState', () => ({ isAwaitingStockData: jest.fn().mockReturnValue(false) }));
jest.mock('../src/state/delStockState', () => ({ isAwaiting: jest.fn().mockReturnValue(false) }));
jest.mock('../src/state/profitStockState', () => ({ isAwaiting: jest.fn().mockReturnValue(false) }));
jest.mock('../src/state/buyerNotesState', () => ({}));
jest.mock('../src/state/screenState', () => ({
    getScreen: jest.fn(),
    setScreen: jest.fn(),
    clear: jest.fn()
}));
jest.mock('../src/state/menuCooldownState', () => ({
    shouldSendMenu: jest.fn().mockReturnValue(false),
    markMenuSent: jest.fn()
}));
jest.mock('../src/services/transactionService', () => ({ getPendingTransaction: jest.fn() }));

const ratingApiService = require('../src/services/ratingApiService');
const handleProductRating = require('../src/actions/handleProductRating');
const actions = require('../src/actions');
const screenState = require('../src/state/screenState');
const { isFeatureEnabled } = require('../src/utils/featureFlags');
const MessageRouter = require('../src/config/messageRouter');
const registerHandlers = require('../src/config/registerHandlers');
const messageFormatter = require('../src/utils/waMessageFormatter');

describe('handleProductRating', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        isFeatureEnabled.mockResolvedValue(true);
    });

    test('submits an explicit rating command', async () => {
        ratingApiService.submitRating.mockResolvedValue({ ok: true });
        const ctx = { message: 'rating INV-1 5', from: '628123', reply: jest.fn() };

        await expect(handleProductRating(ctx)).resolves.toEqual({
            handled: true,
            success: true,
            terminal: true
        });
        expect(ratingApiService.submitRating).toHaveBeenCalledWith({
            transactionId: 'INV-1',
            channelUserId: '628123',
            rating: 5
        });
        expect(ctx.reply).toHaveBeenCalledWith('Terima kasih! Rating 5/5 kamu sudah tersimpan.');
    });

    test('skips an explicit rating command', async () => {
        ratingApiService.skipRating.mockResolvedValue({ ok: true });
        const ctx = { message: '.rating skip INV-2', from: '628456', reply: jest.fn() };

        await expect(handleProductRating(ctx)).resolves.toEqual({
            handled: true,
            success: true,
            terminal: true
        });
        expect(ratingApiService.skipRating).toHaveBeenCalledWith({
            transactionId: 'INV-2',
            channelUserId: '628456'
        });
        expect(ctx.reply).toHaveBeenCalledWith('Baik, permintaan rating dilewati.');
    });

    test('uses the purchase thank-you copy when the initial screen is skipped', async () => {
        ratingApiService.skipRating.mockResolvedValue({ ok: true });
        const ctx = { message: 'lewati', from: '628456', reply: jest.fn() };

        await handleProductRating(ctx, { transactionId: 'INV-2', skip: true });

        expect(ctx.reply).toHaveBeenCalledWith('Oke, terima kasih sudah berbelanja!');
    });

    test('submits an optional comment from the comment stage', async () => {
        ratingApiService.submitRating.mockResolvedValue({ ok: true });
        const ctx = { message: 'Pelayanannya cepat.', from: '628123', reply: jest.fn() };

        await handleProductRating(ctx, {
            transactionId: 'INV-1',
            rating: 5,
            comment: 'Pelayanannya cepat.',
            fromCommentStage: true
        });

        expect(ratingApiService.submitRating).toHaveBeenCalledWith({
            transactionId: 'INV-1',
            channelUserId: '628123',
            rating: 5,
            comment: 'Pelayanannya cepat.'
        });
        expect(ctx.reply).toHaveBeenCalledWith('Terima kasih! Rating 5/5 dan komentar kamu sudah tersimpan.');
    });

    test('does not submit when rating is disabled', async () => {
        isFeatureEnabled.mockResolvedValue(false);
        const ctx = { message: '.rating INV-1 5', from: '628123', reply: jest.fn() };

        await expect(handleProductRating(ctx)).resolves.toMatchObject({ terminal: true, success: false });

        expect(ratingApiService.submitRating).not.toHaveBeenCalled();
        expect(ctx.reply).toHaveBeenCalledWith('Fitur rating sedang dinonaktifkan.');
    });

    test.each([
        [{ status: 409, message: 'database duplicate details' }, 'Rating untuk transaksi ini sudah tercatat.', true],
        [new Error('connect ECONNREFUSED internal-host'), 'Layanan rating sedang tidak tersedia. Silakan coba lagi nanti.', false]
    ])('returns a sanitized failure for %p', async (error, expectedMessage, terminal) => {
        ratingApiService.submitRating.mockRejectedValue(error);
        const ctx = { message: 'rating INV-3 4', from: '628123', reply: jest.fn() };

        await expect(handleProductRating(ctx)).resolves.toEqual({
            handled: true,
            success: false,
            terminal
        });
        expect(ctx.reply).toHaveBeenCalledWith(expectedMessage);
        expect(ctx.reply.mock.calls.flat().join(' ')).not.toContain(error.message);
    });
});

describe('RATING_INPUT routing', () => {
    let router;

    beforeEach(() => {
        jest.clearAllMocks();
        router = new MessageRouter();
        registerHandlers(router);
        screenState.getScreen.mockReturnValue({
            screen: 'RATING_INPUT',
            transactionId: 'INV-9'
        });
        actions.handleBuyerNotes.handleBuyerNotesInput.mockResolvedValue(false);
        actions.handleProductRating.mockResolvedValue({ success: true, terminal: true });
    });

    test('choosing a score moves to comment input without submitting', async () => {
        const ctx = {
            message: '5',
            from: '628123',
            isCallback: false,
            isGroup: false,
            reply: jest.fn()
        };

        await expect(router.route(ctx)).resolves.toBe(true);
        expect(actions.handleProductRating).not.toHaveBeenCalled();
        expect(screenState.setScreen).toHaveBeenCalledWith('628123', 'RATING_COMMENT', {
            transactionId: 'INV-9',
            rating: 5
        });
        expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('maksimal 500 karakter'));
    });

    test('skips the entire rating from initial input and clears matching state', async () => {
        const ctx = {
            message: 'lewati',
            from: '628123',
            isCallback: false,
            isGroup: false,
            reply: jest.fn()
        };

        await router.route(ctx);

        expect(actions.handleProductRating).toHaveBeenCalledWith(ctx, {
            transactionId: 'INV-9',
            skip: true
        });
        expect(screenState.clear).toHaveBeenCalledWith('628123');
    });

    test('submits comment-stage text and clears matching state', async () => {
        screenState.getScreen.mockReturnValue({
            screen: 'RATING_COMMENT',
            transactionId: 'INV-9',
            rating: 4
        });
        const ctx = {
            message: 'Produknya bagus.',
            from: '628123',
            isCallback: false,
            isGroup: false,
            reply: jest.fn()
        };

        await router.route(ctx);

        expect(actions.handleProductRating).toHaveBeenCalledWith(ctx, {
            transactionId: 'INV-9',
            rating: 4,
            comment: 'Produknya bagus.',
            fromCommentStage: true
        });
        expect(screenState.clear).toHaveBeenCalledWith('628123');
    });

    test('submits the selected score without a comment when comment input is skipped', async () => {
        screenState.getScreen.mockReturnValue({
            screen: 'RATING_COMMENT',
            transactionId: 'INV-9',
            rating: 4
        });
        const ctx = {
            message: 'lewati',
            from: '628123',
            isCallback: false,
            isGroup: false,
            reply: jest.fn()
        };

        await router.route(ctx);

        expect(actions.handleProductRating).toHaveBeenCalledWith(ctx, {
            transactionId: 'INV-9',
            rating: 4,
            comment: undefined,
            fromCommentStage: true
        });
        expect(screenState.clear).toHaveBeenCalledWith('628123');
    });

    test('rejects comments over 500 characters without submitting or clearing state', async () => {
        screenState.getScreen.mockReturnValue({
            screen: 'RATING_COMMENT',
            transactionId: 'INV-9',
            rating: 4
        });
        const ctx = {
            message: 'a'.repeat(501),
            from: '628123',
            isCallback: false,
            isGroup: false,
            reply: jest.fn()
        };

        await router.route(ctx);

        expect(actions.handleProductRating).not.toHaveBeenCalled();
        expect(screenState.clear).not.toHaveBeenCalled();
        expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('maksimal 500 karakter'));
    });

    test('keeps comment state after a transient submission failure', async () => {
        screenState.getScreen.mockReturnValue({
            screen: 'RATING_COMMENT',
            transactionId: 'INV-9',
            rating: 4
        });
        actions.handleProductRating.mockResolvedValue({ success: false, terminal: false });

        await router.route({
            message: 'Coba lagi.',
            from: '628123',
            isCallback: false,
            isGroup: false,
            reply: jest.fn()
        });

        expect(screenState.clear).not.toHaveBeenCalled();
    });

    test('clears rating state after an explicit terminal command', async () => {
        const ctx = {
            message: '.rating INV-9 5',
            from: '628123',
            isCallback: false,
            reply: jest.fn()
        };

        await expect(router.route(ctx)).resolves.toBe(true);
        expect(actions.handleProductRating).toHaveBeenCalledWith(ctx);
        expect(screenState.clear).toHaveBeenCalledWith('628123');
    });

    test('keeps an unrelated active screen after an explicit rating command', async () => {
        screenState.getScreen.mockReturnValue({ screen: 'ORDER_CONFIRM', transactionId: 'OTHER' });
        const ctx = {
            message: '.rating INV-9 5',
            from: '628123',
            isCallback: false,
            reply: jest.fn()
        };

        await expect(router.route(ctx)).resolves.toBe(true);
        expect(screenState.clear).not.toHaveBeenCalled();
    });
});

describe('rating summary formatting', () => {
    test('formats product and variant summaries exactly', () => {
        expect(messageFormatter.formatRatingSummary(
            { average: 4.5, count: 12 }
        )).toBe('Rating: 4.5/5 (12 ulasan)');
        expect(messageFormatter.formatRatingSummary(
            { average_rating: 3, review_count: 2 }
        )).toBe('Rating: 3.0/5 (2 ulasan)');
        expect(messageFormatter.formatRatingSummary(
            { average: 0, count: 0 }
        )).toBe('Rating: Belum ada ulasan');
    });
});
