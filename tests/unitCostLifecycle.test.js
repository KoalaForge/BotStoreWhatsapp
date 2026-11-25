jest.mock('../src/services/modeService', () => ({
    isSingleMode: jest.fn().mockReturnValue(false),
    isMultiMode: jest.fn().mockReturnValue(true)
}));

const StockModel = require('../src/database/models/stockModels');
const OrderTransactionItemModel = require('../src/database/models/orderTransactionItemsModels');
const stockRepository = require('../src/repositories/StockRepository');
const orderTransactionItemRepository = require('../src/repositories/OrderTransactionItemRepository');
const productVariantRepository = require('../src/repositories/ProductVariantRepository');
const orderTransactionItemService = require('../src/services/orderTransactionItemService');
const orderService = require('../src/services/orderService');
const cycleService = require('../src/services/cycleService');
const { restoreStockCompat } = require('../src/utils/transactionItemsHelper');

const context = { botId: 'bot-1', ownerId: 'owner-1', mode: 'MULTI' };

function record(overrides = {}) {
    return {
        _id: '64b000000000000000000001',
        codeVariant: 'canva-1b',
        dataStock: 'a@mail|pw',
        profit: -500,
        ownerId: 'owner-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides
    };
}

const costCases = [
    ['input', { unitCost: 0, unitCostSource: 'input' }, 0, 'input'],
    ['estimated', { unitCost: 7000, unitCostSource: 'estimated' }, 7000, 'estimated'],
    ['unknown', { unitCost: null, unitCostSource: 'unknown' }, null, 'unknown'],
    ['unmarked cost', { unitCost: 7000 }, 7000, undefined],
    ['no cost, no marker', {}, null, 'unknown']
];

let saved;

beforeEach(() => {
    saved = [];
    jest.spyOn(StockModel.prototype, 'save').mockImplementation(function () {
        saved.push(this.toObject());
        return Promise.resolve(this);
    });
});

afterEach(() => jest.restoreAllMocks());

describe('schemas keep the cost marker', () => {
    test('stock units persist unitCostSource', () => {
        const stock = new StockModel(record({ unitCost: 100, unitCostSource: 'estimated' }));

        expect(stock.toObject().unitCostSource).toBe('estimated');
    });

    test('order item snapshots persist unitCostSource', () => {
        const item = new OrderTransactionItemModel({ data: [record({ unitCost: 100, unitCostSource: 'input' })] });

        expect(item.toObject().data[0].unitCostSource).toBe('input');
    });

    test('a record without a marker is not given one', () => {
        const stock = new StockModel(record({ unitCost: 100 }));
        const item = new OrderTransactionItemModel({ data: [record({ unitCost: 100 })] });

        expect(stock.toObject().unitCostSource).toBeUndefined();
        expect(item.toObject().data[0].unitCostSource).toBeUndefined();
    });
});

describe.each(costCases)('cost survives the stock lifecycle: %s', (_label, cost, expectedCost, expectedSource) => {
    const expectPreserved = () => {
        expect(saved).toHaveLength(1);
        expect(saved[0].unitCost).toBe(expectedCost);
        expect(saved[0].unitCostSource).toBe(expectedSource);
        expect(saved[0].profit).toBe(-500);
    };

    test('sale snapshot', async () => {
        const { stockItems } = await orderService._consumeStockItems([record(cost)], { alreadyClaimed: true });
        const item = new OrderTransactionItemModel({ data: stockItems });

        expect(item.toObject().data[0].unitCost).toBe(expectedCost);
        expect(item.toObject().data[0].unitCostSource).toBe(cost.unitCostSource);
    });

    test.each([false, true])('restoreClaimedStock (reseller: %s)', async (isReseller) => {
        await orderService.restoreClaimedStock({ repositoryContext: context }, { stockItems: [record(cost)], isReseller });

        expectPreserved();
    });

    test('rollback after losing a race', async () => {
        const deleteFn = jest.fn()
            .mockResolvedValueOnce({ deletedCount: 1 })
            .mockResolvedValueOnce({ deletedCount: 0 });
        jest.spyOn(stockRepository, 'countPlatformStock').mockResolvedValue(2);
        jest.spyOn(stockRepository, 'findPlatformStock').mockResolvedValue([record(cost), record()]);
        jest.spyOn(stockRepository, 'deletePlatformStockById').mockImplementation(deleteFn);

        await expect(orderService.processStockForPlatform('canva-1b', 2)).rejects.toThrow('race condition');

        expectPreserved();
    });

    test.each([false, true])('cancelled order restore (reseller: %s)', async (isReseller) => {
        jest.spyOn(orderTransactionItemService, 'getTransactionItems').mockResolvedValue([{ data: [record(cost)] }]);
        jest.spyOn(cycleService, 'clearCycleEligibilityForItems').mockResolvedValue();
        const TransactionModel = require('../src/database/models/transactionModels');
        jest.spyOn(TransactionModel, 'findOne').mockReturnValue({ lean: () => Promise.resolve(null) });

        await restoreStockCompat(context, {
            _id: 'trx-object-id',
            transactionId: 'TRX-1',
            transaction_type: 'product',
            is_reseller_order: isReseller
        });

        expectPreserved();
    });

    test.each([
        ['manual', () => cycleService.manualCycleTransaction({ repositoryContext: context }, 'TRX-1'), 'owner-1'],
        ['manual platform', () => cycleService.manualCycleTransaction({ repositoryContext: context }, 'TRX-1'), null],
        ['bulk', () => cycleService.bulkCycleEligible({ repositoryContext: context }), 'owner-1'],
        ['bulk platform', () => cycleService.bulkCycleEligible({ repositoryContext: context }), null]
    ])('%s cycle', async (_name, run, ownerId) => {
        const item = {
            _id: 'item-1',
            codeVariant: 'canva-1b',
            cycle_eligible_at: new Date(0),
            cycled_at: null,
            data: [record({ ...cost, ownerId })]
        };
        const TransactionRepository = require('../src/repositories/TransactionRepository');
        jest.spyOn(TransactionRepository, 'findByTransactionId').mockResolvedValue({ _id: 'trx-object-id' });
        jest.spyOn(orderTransactionItemRepository, 'findCyclableItemsByTransaction').mockResolvedValue([item]);
        jest.spyOn(orderTransactionItemRepository, 'findAllEligibleForBulkCycle').mockResolvedValue([item]);
        jest.spyOn(orderTransactionItemRepository, 'markAsCycled').mockResolvedValue({ modifiedCount: 1 });
        jest.spyOn(productVariantRepository, 'findByCodeVariant').mockResolvedValue({ ownerId });

        const result = await run();

        expect(result.success).toBe(1);
        expectPreserved();
    });
});
