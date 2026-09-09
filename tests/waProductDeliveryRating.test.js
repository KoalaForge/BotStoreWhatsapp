jest.mock('../src/utils/waMessageFormatter', () => ({
    formatProductSuccessMessage: jest.fn(() => 'customer-message'),
    formatProductSuccessMessageSummary: jest.fn(() => 'customer-summary'),
    formatProductAdminNotification: jest.fn(() => 'admin-message'),
    formatProductAdminNotificationSummary: jest.fn(() => 'admin-summary')
}));
jest.mock('../src/utils/fileDelivery', () => ({
    shouldDeliverAsFile: jest.fn(),
    exceedsMessageLimit: jest.fn(() => false),
    generateFileContent: jest.fn(() => 'account-data')
}));
jest.mock('../src/utils/waNotifications', () => ({
    sendNotification: jest.fn().mockResolvedValue(undefined),
    sendFileNotification: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../src/utils/waRetry', () => ({
    withRetry: jest.fn(callback => callback())
}));
jest.mock('../src/services/ratingApiService', () => ({
    isConfigured: jest.fn(),
    claimPrompt: jest.fn()
}));
jest.mock('../src/state/screenState', () => ({
    getScreen: jest.fn(),
    setScreen: jest.fn()
}));
jest.mock('../src/services/settingsService', () => ({
    getSettingsByBotId: jest.fn()
}));

const fileDelivery = require('../src/utils/fileDelivery');
const ratingApiService = require('../src/services/ratingApiService');
const screenState = require('../src/state/screenState');
const settingsService = require('../src/services/settingsService');
const { sendNotification } = require('../src/utils/waNotifications');
const { deliverProductToCustomer } = require('../src/services/waProductDeliveryService');

const jid = '6281234567890@s.whatsapp.net';
const params = {
    transactionId: 'INV-1',
    productName: 'Netflix',
    variantName: '1 Bulan',
    orderQuantity: 1,
    totalPrice: 10000,
    paymentDate: '2026-09-07 12:00:00',
    orderData: ['email@example.test'],
    buyer: 'Buyer',
    variantPrice: 10000
};

function ratingPrompts(sock) {
    return sock.sendMessage.mock.calls.filter(([, content]) => content.text?.includes('*Beri Rating Produk*'));
}

describe('waProductDeliveryService rating prompt', () => {
    let sock;

    beforeEach(() => {
        jest.clearAllMocks();
        sock = { sendMessage: jest.fn().mockResolvedValue(undefined) };
        ratingApiService.isConfigured.mockReturnValue(true);
        ratingApiService.claimPrompt.mockResolvedValue(true);
        settingsService.getSettingsByBotId.mockResolvedValue({ ratingEnabled: true });
        screenState.getScreen.mockReturnValue(null);
        fileDelivery.shouldDeliverAsFile.mockReturnValue(false);
        fileDelivery.exceedsMessageLimit.mockReturnValue(false);
    });

    test('sends one prompt after normal customer delivery and then sets routable state', async () => {
        await deliverProductToCustomer(sock, jid, {}, { ...params, ratingEligible: true });

        expect(ratingPrompts(sock)).toHaveLength(1);
        expect(sock.sendMessage.mock.calls[0]).toEqual([jid, { text: 'customer-message' }]);
        expect(ratingApiService.claimPrompt).toHaveBeenCalledWith({
            transactionId: 'INV-1',
            channelUserId: '6281234567890'
        });
        expect(screenState.setScreen).toHaveBeenCalledWith('6281234567890', 'RATING_INPUT', {
            transactionId: 'INV-1'
        });
        expect(sock.sendMessage.mock.invocationCallOrder[1]).toBeLessThan(
            screenState.setScreen.mock.invocationCallOrder[0]
        );
    });

    test('sends one prompt after the file reaches the customer', async () => {
        fileDelivery.shouldDeliverAsFile.mockReturnValue(true);

        await deliverProductToCustomer(sock, jid, {}, {
            ...params,
            orderQuantity: 6,
            ratingEligible: true
        });

        expect(ratingPrompts(sock)).toHaveLength(1);
        expect(sock.sendMessage.mock.calls[1][1]).toMatchObject({
            document: Buffer.from('account-data'),
            fileName: 'INV-1.txt'
        });
        expect(sock.sendMessage.mock.invocationCallOrder[1]).toBeLessThan(
            sock.sendMessage.mock.invocationCallOrder[2]
        );
        expect(screenState.setScreen).toHaveBeenCalledWith('6281234567890', 'RATING_INPUT', {
            transactionId: 'INV-1'
        });
    });

    test.each([
        ['rating is not eligible', false, true],
        ['API is not configured', true, false]
    ])('does not prompt when %s', async (_label, ratingEligible, configured) => {
        ratingApiService.isConfigured.mockReturnValue(configured);

        await deliverProductToCustomer(sock, jid, {}, { ...params, ratingEligible });

        expect(ratingPrompts(sock)).toHaveLength(0);
        expect(screenState.setScreen).not.toHaveBeenCalled();
    });

    test('the pullstock/default path does not prompt', async () => {
        await deliverProductToCustomer(sock, jid, {}, params);

        expect(ratingPrompts(sock)).toHaveLength(0);
        expect(ratingApiService.isConfigured).not.toHaveBeenCalled();
        expect(screenState.setScreen).not.toHaveBeenCalled();
    });

    test('prompt failure does not reject delivery or set rating state', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        sock.sendMessage
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('prompt send failed'));

        await expect(deliverProductToCustomer(sock, jid, {}, {
            ...params,
            ratingEligible: true
        })).resolves.toBeUndefined();

        expect(screenState.setScreen).not.toHaveBeenCalled();
        expect(sendNotification).toHaveBeenCalledWith(sock, 'admin-message', {});
        expect(consoleError).toHaveBeenCalledWith(
            '[rating] Failed to send delivery prompt for INV-1:',
            'prompt send failed'
        );
        consoleError.mockRestore();
    });
});
