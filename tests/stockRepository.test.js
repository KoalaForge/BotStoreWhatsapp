jest.mock('../src/services/modeService', () => ({
    isSingleMode: jest.fn()
}));

jest.mock('../src/database/models/stockModels', () => ({
    modelName: 'Stock_Data_Variants'
}));

jest.mock('../src/database/models/stockBatchModels', () => ({
    create: jest.fn().mockResolvedValue({})
}));

const modeService = require('../src/services/modeService');
const StockBatchModel = require('../src/database/models/stockBatchModels');
const stockRepository = require('../src/repositories/StockRepository');

describe('StockRepository.createStockBatch', () => {
    beforeEach(() => {
        modeService.isSingleMode.mockReturnValue(false);
        StockBatchModel.create.mockClear();
    });

    test('injects ownerId from WhatsApp context in MULTI mode', async () => {
        const ctx = {
            repositoryContext: {
                botId: 'bot123',
                ownerId: 'owner456',
                mode: 'MULTI'
            }
        };

        await stockRepository.createStockBatch(ctx, 'CANVA-1B', 5000, 2);

        expect(StockBatchModel.create).toHaveBeenCalledWith(expect.objectContaining({
            codeVariant: 'canva-1b',
            ownerId: 'owner456'
        }));
    });

    test('leaves ownerId unscoped in SINGLE mode', async () => {
        modeService.isSingleMode.mockReturnValue(true);

        await stockRepository.createStockBatch(
            { repositoryContext: { botId: null, ownerId: null, mode: 'SINGLE' } },
            'CANVA-1B',
            5000,
            2
        );

        const data = StockBatchModel.create.mock.calls[0][0];
        expect(data).not.toHaveProperty('ownerId');
    });
});
