describe('WhatsApp rating summary cache', () => {
    let api;
    let axios;
    let settings;
    let clock;
    const originalEnv = { ...process.env };
    const query = {
        ownerId: 'owner-1', botId: 'bot-1', productCodes: ['NETFLIX'],
        variants: [{ productCode: 'NETFLIX', variantCode: '1M' }]
    };
    const data = {
        products: { netflix: { average: 4, count: 3 } },
        variants: { 'netflix|1m': { average: 4, count: 3 } }
    };
    beforeEach(() => {
        jest.resetModules();
        process.env.KOALABOTBE_API_URL = 'https://ratings.example.test';
        process.env.INTERNAL_API_KEY = 'test-key';
        axios = { post: jest.fn().mockResolvedValue({ data: { data } }) };
        settings = { getSettingsByBotId: jest.fn().mockResolvedValue({ ratingEnabled: true }) };
        jest.doMock('axios', () => axios);
        jest.doMock('../src/services/settingsService', () => settings);
        api = require('../src/services/ratingApiService');
        clock = jest.spyOn(Date, 'now').mockReturnValue(100000);
    });
    afterEach(() => { clock.mockRestore(); process.env = { ...originalEnv }; });

    test('keeps successful values on transient failures across request shapes', async () => {
        await api.getSummaries(query);
        const order = { ...query, productCodes: [] };
        expect(await api.getSummaries(order)).toEqual({ products: {}, variants: data.variants });
        expect(axios.post).toHaveBeenCalledTimes(1);
        clock.mockReturnValue(131000);
        axios.post.mockRejectedValueOnce({ response: { status: 503 } });
        expect((await api.getSummaries(order)).variants['netflix|1m']).toEqual(data.variants['netflix|1m']);
        expect(await api.getSummaries(query)).toEqual(data);
    });

    test('does not cross tenant or bot scopes', async () => {
        await api.getSummaries(query);
        axios.post.mockRejectedValue(new Error('timeout'));
        expect((await api.getSummaries({ ...query, ownerId: 'owner-2' })).available).toBe(false);
        expect((await api.getSummaries({ ...query, botId: 'bot-2' })).available).toBe(false);
    });

    test('disabling clears cache before reading it', async () => {
        await api.getSummaries(query);
        settings.getSettingsByBotId.mockResolvedValue({ ratingEnabled: false });
        expect((await api.getSummaries(query)).reason).toBe('disabled');
        settings.getSettingsByBotId.mockResolvedValue({ ratingEnabled: true });
        axios.post.mockRejectedValue(new Error('timeout'));
        expect((await api.getSummaries(query)).available).toBe(false);
    });

    test.each([401, 403, 422])('never reuses stale values after HTTP %s', async (status) => {
        await api.getSummaries(query);
        clock.mockReturnValue(131000);
        axios.post.mockRejectedValue({ response: { status } });
        expect((await api.getSummaries(query)).available).toBe(false);
    });

    test('handles disabled sentinel and deduplicates concurrent requests', async () => {
        await Promise.all([api.getSummaries(query), api.getSummaries(query)]);
        expect(axios.post).toHaveBeenCalledTimes(1);
        clock.mockReturnValue(131000);
        axios.post.mockResolvedValue({ data: { data: { available: false, reason: 'disabled', products: [], variants: [] } } });
        expect((await api.getSummaries(query)).reason).toBe('disabled');
    });
});
