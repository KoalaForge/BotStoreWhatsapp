jest.mock('../src/services/modeService', () => ({
    isSingleMode: jest.fn()
}));

const modeService = require('../src/services/modeService');
const StockModel = require('../src/database/models/stockModels');
const ProductVariantModel = require('../src/database/models/productsVariantModels');
const productVariantRepository = require('../src/repositories/ProductVariantRepository');

const ctx = { repositoryContext: { botId: 'bot-1', ownerId: 'owner-1', mode: 'MULTI' } };

let updateStock;
let updateVariant;

beforeEach(() => {
    modeService.isSingleMode.mockReturnValue(false);
    updateVariant = jest.spyOn(ProductVariantModel, 'updateOne').mockResolvedValue({ matchedCount: 1 });
    updateStock = jest.spyOn(StockModel, 'updateMany').mockResolvedValue({ modifiedCount: 2 });
});

afterEach(() => jest.restoreAllMocks());

describe('changing a variant price', () => {
    test('recomputes profit of the owner\'s available stock with a known cost', async () => {
        await productVariantRepository.updatePrice(ctx, 'CANVA-1B', 8000);

        expect(updateStock).toHaveBeenCalledTimes(1);
        const [filter, update] = updateStock.mock.calls[0];
        expect(filter).toEqual({
            $and: [
                { ownerId: 'owner-1', codeVariant: 'canva-1b', unitCost: { $type: 'number' } },
                {
                    $or: [
                        { stockSchemaVersion: { $exists: false }, soldAt: null },
                        { stockSchemaVersion: { $lt: 2 }, soldAt: null },
                        { stockSchemaVersion: 2, stockState: 'available' }
                    ]
                }
            ]
        });
        // Only profit is derived: cost and its source are never rewritten
        expect(update).toEqual([{ $set: { profit: { $subtract: [8000, '$unitCost'] } } }]);
    });

    test('mongoose sends the pipeline to the driver', async () => {
        updateStock.mockRestore();
        const driver = jest.spyOn(StockModel.collection, 'updateMany').mockResolvedValue({ modifiedCount: 1 });

        await productVariantRepository.updatePrice(ctx, 'canva-1b', 8000);

        expect(driver.mock.calls[0][1][0]).toEqual({ $set: { profit: { $subtract: [8000, '$unitCost'] } } });
    });

    test('scopes to unowned stock in SINGLE mode', async () => {
        modeService.isSingleMode.mockReturnValue(true);

        await productVariantRepository.updatePrice({ repositoryContext: { mode: 'SINGLE' } }, 'canva-1b', 8000);

        expect(updateStock.mock.calls[0][0].$and[0].ownerId).toBeNull();
    });

    test('leaves stock alone when the price update fails', async () => {
        updateVariant.mockRejectedValue(new Error('write failed'));

        await expect(productVariantRepository.updatePrice(ctx, 'canva-1b', 8000)).rejects.toThrow('write failed');
        expect(updateStock).not.toHaveBeenCalled();
    });
});
