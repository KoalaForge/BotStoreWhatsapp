jest.mock('../src/utils/waMessageFormatter', () => ({
    formatProductSuccessMessage: jest.fn(() => 'product data'),
    formatProductSuccessMessageSummary: jest.fn(() => 'product summary'),
    formatProductAdminNotification: jest.fn(() => 'admin data'),
    formatProductAdminNotificationSummary: jest.fn(() => 'admin summary')
}));
jest.mock('../src/utils/fileDelivery', () => ({
    shouldDeliverAsFile: jest.fn(() => false),
    exceedsMessageLimit: jest.fn(() => false),
    generateFileContent: jest.fn(() => 'file data')
}));
jest.mock('../src/utils/waNotifications', () => ({
    sendNotification: jest.fn().mockResolvedValue(),
    sendFileNotification: jest.fn().mockResolvedValue()
}));
jest.mock('../src/utils/waRetry', () => ({
    withRetry: jest.fn((operation) => operation())
}));
jest.mock('../src/services/ratingApiService', () => ({
    isConfigured: jest.fn(() => true),
    claimPrompt: jest.fn(() => Promise.resolve(true))
}));
jest.mock('../src/state/screenState', () => ({
    getScreen: jest.fn(),
    setScreen: jest.fn()
}));
jest.mock('../src/services/settingsService', () => ({
    getSettingsByBotId: jest.fn().mockResolvedValue({ ratingEnabled: true })
}));

const fileDelivery = require('../src/utils/fileDelivery');
const ratingApiService = require('../src/services/ratingApiService');
const screenState = require('../src/state/screenState');
const settingsService = require('../src/services/settingsService');
const { deliverProductToCustomer } = require('../src/services/waProductDeliveryService');

function params(overrides = {}) {
    return {
        transactionId: 'INV-123',
        ratingUserId: '628123',
        productName: 'Netflix',
        variantName: '1 Bulan',
        orderQuantity: 1,
        totalPrice: 25000,
        paymentDate: '7 September 2026',
        orderData: ['credential'],
        buyer: 'Buyer',
        variantPrice: 25000,
        ratingEligible: true,
        ...overrides
    };
}

describe('WhatsApp delivery rating prompt', () => {
    let sock;

    beforeEach(() => {
        jest.clearAllMocks();
        fileDelivery.shouldDeliverAsFile.mockReturnValue(false);
        ratingApiService.isConfigured.mockReturnValue(true);
        ratingApiService.claimPrompt.mockResolvedValue(true);
        settingsService.getSettingsByBotId.mockResolvedValue({ ratingEnabled: true });
        screenState.getScreen.mockReturnValue(null);
        sock = { sendMessage: jest.fn().mockResolvedValue({ key: { id: 'message-id' } }) };
    });

    test('sends one prompt after normal delivery and opens rating input', async () => {
        await deliverProductToCustomer(sock, '628123@s.whatsapp.net', { state: { botId: 'bot-1' } }, params());

        expect(sock.sendMessage).toHaveBeenCalledTimes(2);
        expect(sock.sendMessage.mock.calls[1][1].text).toContain('Rating tetap tersedia selama 24 jam');
        expect(sock.sendMessage.mock.calls[1][1].text).toContain('.rating INV-123 <1-5>');
        expect(screenState.setScreen).toHaveBeenCalledWith(
            '628123',
            'RATING_INPUT',
            { transactionId: 'INV-123' }
        );
        expect(settingsService.getSettingsByBotId).toHaveBeenCalledWith('bot-1');
    });

    test('sends one prompt only after document delivery', async () => {
        fileDelivery.shouldDeliverAsFile.mockReturnValue(true);

        await deliverProductToCustomer(sock, '628123@s.whatsapp.net', {}, params({ orderQuantity: 6 }));

        expect(sock.sendMessage).toHaveBeenCalledTimes(3);
        expect(sock.sendMessage.mock.calls[1][1]).toHaveProperty('document');
        expect(sock.sendMessage.mock.calls[2][1].text).toContain('*Beri Rating Produk*');
    });

    test('does not prompt pullstock or unconfigured deployments', async () => {
        await deliverProductToCustomer(sock, '628123@s.whatsapp.net', {}, params({ ratingEligible: false }));
        expect(sock.sendMessage).toHaveBeenCalledTimes(1);

        jest.clearAllMocks();
        sock.sendMessage.mockResolvedValue({});
        ratingApiService.isConfigured.mockReturnValue(false);
        await deliverProductToCustomer(sock, '628123@s.whatsapp.net', {}, params());
        expect(sock.sendMessage).toHaveBeenCalledTimes(1);
        expect(screenState.setScreen).not.toHaveBeenCalled();
    });

    test('does not send a duplicate prompt after the backend claim is taken', async () => {
        ratingApiService.claimPrompt.mockResolvedValue(false);

        await deliverProductToCustomer(sock, '628123@s.whatsapp.net', {}, params());

        expect(sock.sendMessage).toHaveBeenCalledTimes(1);
        expect(screenState.setScreen).not.toHaveBeenCalled();
    });

    test('does not claim or prompt when rating is disabled', async () => {
        settingsService.getSettingsByBotId.mockResolvedValue({ ratingEnabled: false });

        await deliverProductToCustomer(sock, '628123@s.whatsapp.net', { botId: 'bot-1' }, params());

        expect(ratingApiService.claimPrompt).not.toHaveBeenCalled();
        expect(sock.sendMessage).toHaveBeenCalledTimes(1);
        expect(screenState.setScreen).not.toHaveBeenCalled();
    });

    test('uses the transaction phone identity for an LID delivery without replacing active state', async () => {
        screenState.getScreen.mockReturnValue({ screen: 'ORDER_CONFIRM' });

        await deliverProductToCustomer(sock, '123456789@lid', {}, params());

        expect(ratingApiService.claimPrompt).toHaveBeenCalledWith({
            transactionId: 'INV-123',
            channelUserId: '628123'
        });
        expect(sock.sendMessage.mock.calls[1][0]).toBe('123456789@lid');
        expect(sock.sendMessage.mock.calls[1][1].text).toContain('.rating INV-123 <1-5>');
        expect(sock.sendMessage.mock.calls[1][1].text).not.toContain('Balas 1-5');
        expect(screenState.setScreen).not.toHaveBeenCalled();
    });

    test('does not fail product delivery when prompt sending fails', async () => {
        sock.sendMessage
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(new Error('WhatsApp unavailable'));
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(deliverProductToCustomer(sock, '628123@s.whatsapp.net', {}, params()))
            .resolves.toBeUndefined();
        expect(screenState.setScreen).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });
});
