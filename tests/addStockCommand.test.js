jest.mock('../src/services/modeService', () => ({
    isSingleMode: jest.fn().mockReturnValue(false)
}));

jest.mock('../src/middleware/waAuth', () => ({
    requireAdmin: jest.fn().mockResolvedValue(true)
}));

jest.mock('../src/repositories/ProductVariantRepository', () => ({
    findByCodeVariant: jest.fn()
}));

const StockModel = require('../src/database/models/stockModels');
const StockBatchModel = require('../src/database/models/stockBatchModels');
const productVariantRepository = require('../src/repositories/ProductVariantRepository');
const addStockState = require('../src/state/addStockState');
const addStock = require('../src/command/privateCommand/addStock');
const MessageRouter = require('../src/config/messageRouter');

const { handleStockDataInput } = addStock;
const USER = '628111@s.whatsapp.net';

function makeCtx({ args = [], message = '' } = {}) {
    return {
        from: USER,
        commandArgs: args,
        message,
        repositoryContext: { botId: 'bot-1', ownerId: 'owner-1', mode: 'MULTI' },
        reply: jest.fn().mockResolvedValue({ key: {} })
    };
}

const lastReply = (ctx) => ctx.reply.mock.calls.at(-1)[0];

let units;
let batches;

beforeEach(() => {
    units = [];
    batches = [];
    addStockState.clearState(USER);
    productVariantRepository.findByCodeVariant.mockReset();
    productVariantRepository.findByCodeVariant.mockResolvedValue({ codeVariant: 'canva-1b', price: 10000 });
    jest.spyOn(StockModel.prototype, 'save').mockImplementation(function () {
        units.push(this.toObject());
        return Promise.resolve(this);
    });
    jest.spyOn(StockBatchModel, 'create').mockImplementation((data) => {
        batches.push(new StockBatchModel(data).toObject());
        return Promise.resolve(data);
    });
});

afterEach(() => jest.restoreAllMocks());

async function addTwoUnits(unitCost) {
    await addStock(makeCtx({ args: ['CANVA-1B', unitCost] }));
    const ctx = makeCtx({ message: 'acc1|pw\nacc2|pw' });
    await handleStockDataInput(ctx);
    return ctx;
}

describe('.addstock <codeVariant> <modal>', () => {
    test.each(['addstock', 'addstok'])('.%s reaches the same command', async (name) => {
        const router = new MessageRouter();
        router.command(['addstock', 'addstok'], addStock);

        await router.route(makeCtx({ message: `.${name} CANVA-1B 6000` }));

        expect(addStockState.getUserStockState(USER)).toMatchObject({ codeVariant: 'CANVA-1B', unitCost: 6000 });
    });

    test.each([
        [['CANVA-1B']],
        [['CANVA-1B', '']],
        [['CANVA-1B', '10k']],
        [['CANVA-1B', '-1']],
        [['CANVA-1B', '1.5']],
        [['CANVA-1B', '10.000']],
        [['CANVA-1B', '1e3']],
        [['CANVA-1B', '9'.repeat(20)]],
        [['CANVA-1B', '10', '000']]
    ])('rejects %j without waiting for stock data', async (args) => {
        const ctx = makeCtx({ args });

        await addStock(ctx);

        expect(addStockState.isAwaitingStockData(USER)).toBe(false);
        expect(lastReply(ctx)).toContain('.addstock <codeVariant> <modal>');
    });

    test('an invalid command drops the pending input of an earlier one', async () => {
        await addStock(makeCtx({ args: ['CANVA-1B', '6000'] }));

        await addStock(makeCtx({ args: ['OTHER', '10k'] }));

        expect(addStockState.isAwaitingStockData(USER)).toBe(false);
    });

    test('the data prompt previews cost and profit', async () => {
        const ctx = makeCtx({ args: ['CANVA-1B', '6000'] });

        await addStock(ctx);

        expect(lastReply(ctx)).toContain('Modal Rp 6.000 → profit Rp 4.000/unit');
    });

    test.each([
        ['6000', 6000, 4000, 'Modal Rp 6.000 → profit Rp 4.000/unit'],
        ['0', 0, 10000, 'Modal Rp 0 → profit Rp 10.000/unit'],
        ['10000', 10000, 0, 'Modal Rp 10.000 → profit Rp 0/unit'],
        ['12500', 12500, -2500, 'Modal Rp 12.500 → rugi Rp 2.500/unit']
    ])('stores units and batch for cost %s', async (input, unitCost, profit, summary) => {
        const ctx = await addTwoUnits(input);

        expect(units).toHaveLength(2);
        for (const unit of units) {
            expect(unit).toMatchObject({ unitCost, unitCostSource: 'input', profit, stockBatchId: batches[0].batchCode });
        }
        expect(batches).toEqual([expect.objectContaining({
            priceSnapshot: 10000,
            unitCostPerUnit: unitCost,
            profitPerUnit: profit,
            quantityAdded: 2,
            ownerId: 'owner-1'
        })]);
        expect(lastReply(ctx)).toContain(summary);
    });

    test('uses the price at the time the stock data arrives', async () => {
        await addStock(makeCtx({ args: ['CANVA-1B', '6000'] }));
        productVariantRepository.findByCodeVariant.mockResolvedValue({ price: 15000 });

        await handleStockDataInput(makeCtx({ message: 'acc1|pw' }));

        expect(units[0].profit).toBe(9000);
        expect(batches[0].priceSnapshot).toBe(15000);
    });

    test('keeps the cost when empty stock data is retried', async () => {
        await addStock(makeCtx({ args: ['CANVA-1B', '0'] }));

        await handleStockDataInput(makeCtx({ message: '   ' }));

        expect(addStockState.getUserStockState(USER)).toMatchObject({ unitCost: 0 });
        expect(units).toHaveLength(0);
    });

    test('writes nothing when the variant disappeared before the data arrived', async () => {
        await addStock(makeCtx({ args: ['CANVA-1B', '6000'] }));
        productVariantRepository.findByCodeVariant.mockResolvedValue(null);
        const ctx = makeCtx({ message: 'acc1|pw' });

        await expect(handleStockDataInput(ctx)).resolves.toBe(true);

        expect(units).toHaveLength(0);
        expect(batches).toHaveLength(0);
        expect(lastReply(ctx)).toContain('tidak ditemukan');
    });
});
