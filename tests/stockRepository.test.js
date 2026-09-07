jest.mock('../src/services/modeService', () => ({
    isSingleMode: jest.fn()
}));

jest.mock('../src/database/models/stockModels', () => ({
    modelName: 'Stock_Data_Variants',
    findOneAndUpdate: jest.fn(),
    findOneAndDelete: jest.fn(),
    updateMany: jest.fn(),
    countDocuments: jest.fn()
}));

jest.mock('../src/database/models/stockBatchModels', () => ({
    create: jest.fn().mockResolvedValue({})
}));

const modeService = require('../src/services/modeService');
const StockModel = require('../src/database/models/stockModels');
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

describe('StockRepository reservations', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        modeService.isSingleMode.mockReturnValue(false);
        StockModel.findOneAndUpdate.mockResolvedValue({ _id: 'stock-1' });
        StockModel.updateMany.mockResolvedValue({ modifiedCount: 1 });
        StockModel.countDocuments.mockResolvedValue(1);
    });

    test('replaces a missing expiry with a finite lease', async () => {
        await stockRepository.claimPlatformStock('CC28D', {
            token: 'reservation-token',
            transactionId: 'TRX-1',
            expiresAt: null
        });

        const update = StockModel.findOneAndUpdate.mock.calls[0][1];
        expect(update.$set.reservedAt).toBeInstanceOf(Date);
        expect(update.$set.reservationExpiresAt).toBeInstanceOf(Date);
        expect(update.$set.reservationExpiresAt.getTime()).toBeGreaterThan(update.$set.reservedAt.getTime());
    });

    test('rejects reservations without a token', async () => {
        await expect(stockRepository.claimPlatformStock('CC28D', { expiresAt: new Date(Date.now() + 60_000) }))
            .rejects.toThrow('Stock reservation requires a valid token');
    });

    test('recovers old reservations with malformed expiry values', async () => {
        await stockRepository.countPlatformStock('CC28D');

        const cleanupFilter = StockModel.updateMany.mock.calls[0][0];
        expect(cleanupFilter).toEqual(expect.objectContaining({
            ownerId: null,
            codeVariant: 'cc28d',
            stockState: 'reserved'
        }));
        expect(cleanupFilter.$or).toEqual(expect.arrayContaining([
            expect.objectContaining({ $and: expect.any(Array) })
        ]));
    });
});
