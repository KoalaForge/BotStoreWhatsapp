jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../src/services/settingsService', () => ({
    getSettingsByBotId: jest.fn().mockResolvedValue({ ratingEnabled: true })
}));

const axios = require('axios');
const ratingApiService = require('../src/services/ratingApiService');

describe('ratingApiService', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = {
            ...originalEnv,
            KOALABOTBE_API_URL: ' https://ratings.example.test/ ',
            INTERNAL_API_KEY: ' secret-key '
        };
        delete process.env.LARAVEL_ADMIN_PANEL_URL;
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    test('unwraps summary data and sends the expected payload and headers', async () => {
        const summaries = {
            products: { netflix: { average: 4.5, count: 2 } },
            variants: { 'netflix|1m': { average: 4.5, count: 2 } }
        };
        axios.post.mockResolvedValue({ data: { data: summaries } });

        await expect(ratingApiService.getSummaries({
            ownerId: 'owner-1',
            botId: 'bot-1',
            productCodes: ['netflix'],
            variants: [{ productCode: 'netflix', variantCode: '1m' }]
        })).resolves.toEqual(summaries);

        expect(axios.post).toHaveBeenCalledWith(
            'https://ratings.example.test/api/v1/internal/reviews/summaries',
            {
                owner_id: 'owner-1',
                bot_id: 'bot-1',
                product_codes: ['netflix'],
                variants: [{ product_code: 'netflix', variant_code: '1m' }]
            },
            {
                timeout: 5000,
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'X-Internal-Api-Key': 'secret-key'
                }
            }
        );
    });

    test('uses WhatsApp submission and skip payloads', async () => {
        axios.post.mockResolvedValue({ data: { ok: true } });

        await ratingApiService.submitRating({
            transactionId: 'INV-1',
            channelUserId: 628123,
            rating: 5,
            comment: 'Sangat membantu.'
        });
        await ratingApiService.skipRating({
            transactionId: 'INV-2',
            channelUserId: 628456
        });

        expect(axios.post.mock.calls[0][1]).toEqual({
            transaction_id: 'INV-1',
            channel_user_id: '628123',
            channel: 'whatsapp',
            rating: 5,
            comment: 'Sangat membantu.'
        });
        expect(axios.post.mock.calls[1][1]).toEqual({
            transaction_id: 'INV-2',
            channel_user_id: '628456',
            channel: 'whatsapp'
        });
    });

    test('claims a WhatsApp delivery prompt from the response envelope', async () => {
        axios.post.mockResolvedValue({ data: { data: { should_prompt: true } } });

        await expect(ratingApiService.claimPrompt({
            transactionId: 'INV-3',
            channelUserId: 628789
        })).resolves.toBe(true);

        expect(axios.post).toHaveBeenCalledWith(
            'https://ratings.example.test/api/v1/internal/reviews/prompt',
            {
                transaction_id: 'INV-3',
                channel_user_id: '628789',
                channel: 'whatsapp'
            },
            expect.any(Object)
        );
    });
});
