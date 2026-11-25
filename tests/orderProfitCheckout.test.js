jest.mock('../src/middleware/waAuth', () => ({ requireAdmin: jest.fn().mockResolvedValue(true) }));
jest.mock('../src/utils/featureFlags', () => ({ isFeatureEnabled: jest.fn().mockResolvedValue(true) }));
jest.mock('../src/services/modeService', () => ({ isSingleMode: () => false, isMultiMode: () => true }));

const transactionService = require('../src/services/transactionService');
const qrisService = require('../src/services/qrisService');
const orderService = require('../src/services/orderService');
const orderTransactionItemService = require('../src/services/orderTransactionItemService');
const ownerBalanceService = require('../src/services/ownerBalanceService');
const resellerState = require('../src/state/resellerState');
const buyerNotesState = require('../src/state/buyerNotesState');
const voucherState = require('../src/state/voucherState');
const voucherService = require('../src/services/voucherService');
const screenState = require('../src/state/screenState');
const variantAccessGuard = require('../src/services/variantAccessGuard');
const cycleService = require('../src/services/cycleService');
const gatewayResolverService = require('../src/services/payment/GatewayResolverService');
const productVariantSnkModel = require('../src/database/models/productVariantSnkModels');
const botUserModel = require('../src/database/models/botUserModels');
const waProductDeliveryService = require('../src/services/waProductDeliveryService');
const productVariantRepository = require('../src/repositories/ProductVariantRepository');
const stockRepository = require('../src/repositories/StockRepository');
const productRepository = require('../src/repositories/ProductRepository');
const productVariantSnkRepository = require('../src/repositories/ProductVariantSnkRepository');
const botUserRepository = require('../src/repositories/BotUserRepository');
const payWithQris = require('../src/actions/payWithQris');
const confirmPayBalance = require('../src/actions/confirmPayBalance');
const pullStock = require('../src/command/privateCommand/pullStock');

const unit = (unitCost, unitCostSource) => ({
    _id: '64b000000000000000000001',
    codeVariant: 'canva-1b',
    dataStock: 'x',
    profit: 999000,
    unitCost,
    ...(unitCostSource ? { unitCostSource } : {})
});

let created;
let ctx;

function arrange({ units, price = 50000, isReseller = false, markupPerUnit = 0, voucherDiscount = 0, fee = 0, feePaidBy = 'merchant' }) {
    created = null;
    const variant = { codeVariant: 'canva-1b', ownerId: 'owner-1', price };
    const total = {
        voucherCode: voucherDiscount ? 'V1' : null,
        voucherDiscount,
        totalPrice: price * units.length - voucherDiscount
    };
    const stock = { dataStock: 'x', profit: 999000 * units.length, stockItems: units, totalProcessed: units.length };

    jest.spyOn(orderService, 'parseOrderFromMessage').mockReturnValue({ orderAmount: units.length, productName: 'P', variantName: 'V' });
    jest.spyOn(orderService, 'resolveOrderContext').mockResolvedValue({
        product: { code: 'P', name: 'P' }, variant, effectivePrice: price, isReseller, markupPerUnit, displayVariantName: 'V'
    });
    jest.spyOn(orderService, 'calculateOrderTotal').mockResolvedValue(total);
    jest.spyOn(orderService, 'getVoucherDetails').mockResolvedValue(total);
    jest.spyOn(orderService, 'processOrderStock').mockResolvedValue(stock);
    jest.spyOn(orderService, 'processStockForItems').mockResolvedValue(stock);
    jest.spyOn(orderService, 'finalizeTrackedStock').mockResolvedValue();
    jest.spyOn(orderService, 'restoreClaimedStock').mockResolvedValue();
    jest.spyOn(transactionService, 'getPendingTransaction').mockResolvedValue(null);
    jest.spyOn(transactionService, 'getUserBalance').mockResolvedValue(10_000_000);
    jest.spyOn(transactionService, 'deductBalance').mockResolvedValue(1);
    jest.spyOn(transactionService, 'generateTransactionId').mockResolvedValue('INV1');
    jest.spyOn(transactionService, 'createTransaction').mockImplementation(async (_c, data) => { created = data; return data; });
    jest.spyOn(transactionService, 'createPlatformRecord').mockResolvedValue(null);
    jest.spyOn(orderTransactionItemService, 'createTransactionItems').mockResolvedValue([]);
    jest.spyOn(ownerBalanceService, 'validateResellerBalance').mockResolvedValue({ ok: true });
    jest.spyOn(ownerBalanceService, 'deductForPurchase').mockResolvedValue({ newBalance: 1 });
    jest.spyOn(resellerState, 'getResellerOrder').mockResolvedValue(null);
    jest.spyOn(resellerState, 'clearResellerOrder').mockResolvedValue();
    jest.spyOn(buyerNotesState, 'getAppliedNotes').mockResolvedValue(null);
    jest.spyOn(voucherState, 'clearUserVoucherState').mockResolvedValue();
    jest.spyOn(voucherService, 'confirmVoucherUsage').mockResolvedValue();
    jest.spyOn(screenState, 'getScreen').mockReturnValue(null);
    jest.spyOn(screenState, 'clear').mockReturnValue();
    jest.spyOn(variantAccessGuard, 'checkPayment').mockResolvedValue({ allowed: true });
    jest.spyOn(cycleService, 'setCycleEligibilityByTransactionId').mockResolvedValue();
    jest.spyOn(cycleService, 'setCycleEligibilityForPlatformItems').mockResolvedValue();
    jest.spyOn(gatewayResolverService, 'resolveGateway').mockResolvedValue({ useOwnCredentials: false });
    jest.spyOn(productVariantSnkModel, 'findOne').mockResolvedValue(null);
    jest.spyOn(botUserModel, 'findOne').mockResolvedValue(null);
    jest.spyOn(waProductDeliveryService, 'deliverProductToCustomer').mockResolvedValue();
    jest.spyOn(qrisService, 'generateProductQRIS').mockResolvedValue({
        qrisImage: Buffer.from('x'),
        transactionId: 'INV1',
        messageText: 'm',
        formattedDate: 'd',
        formattedDateFile: 'f',
        gatewayFee: fee,
        finalAmount: price * units.length,
        paymentMethodCode: 'qris',
        gatewayReference: 'r',
        expiresAt: new Date(),
        feePaidBy
    });
    jest.spyOn(productVariantRepository, 'findByCodeVariant').mockResolvedValue({ codeVariant: 'canva-1b', code: 'P', name: 'V', price });
    jest.spyOn(stockRepository, 'countStock').mockResolvedValue(5);
    jest.spyOn(productRepository, 'findByCode').mockResolvedValue({ name: 'P' });
    jest.spyOn(productVariantSnkRepository, 'findByCodeVariant').mockResolvedValue(null);
    jest.spyOn(botUserRepository, 'findByWhatsappId').mockResolvedValue(null);

    ctx = {
        from: 'u1',
        chat: 'c1',
        jid: 'u1',
        sock: {},
        session: { lastOrderMessage: 'm' },
        commandArgs: ['canva-1b', String(units.length)],
        pricingService: { calculatePrice: jest.fn().mockResolvedValue(price) },
        repositoryContext: { botId: 'b', ownerId: 'owner-1', mode: 'MULTI' },
        reply: jest.fn().mockResolvedValue({ key: {} }),
        sendImage: jest.fn().mockResolvedValue({ key: {} }),
        deleteMessage: jest.fn()
    };
}

afterEach(() => jest.restoreAllMocks());

const flows = [
    ['QRIS checkout', () => payWithQris(ctx)],
    ['balance checkout', () => confirmPayBalance(ctx)],
    ['manual pullstock', () => pullStock(ctx)]
];

describe.each(flows)('%s stores the stock order profit', (name, run) => {
    test('as price paid minus the cost of the units sold, not the stored stock profit', async () => {
        arrange({ units: [unit(30000, 'input'), unit(20000, 'input')] });
        await run();
        expect(created.profit).toBe(50000);
    });

    test('keeps a loss instead of flooring it at zero', async () => {
        arrange({ units: [unit(60000, 'input')] });
        await run();
        expect(created.profit).toBe(-10000);
    });

    test('leaves unknown cost units out entirely', async () => {
        arrange({ units: [unit(null), unit(30000, 'input')] });
        await run();
        expect(created.profit).toBe(20000);
    });

    test('counts estimated and unmarked costs', async () => {
        arrange({ units: [unit(30000, 'estimated'), unit(20000)] });
        await run();
        expect(created.profit).toBe(50000);
    });

    test('is zero when every unit is unknown', async () => {
        arrange({ units: [unit(null, 'unknown'), unit(null)] });
        await run();
        expect(created.profit).toBe(0);
    });

    if (name !== 'manual pullstock') {
        test('takes the voucher off', async () => {
            arrange({ units: [unit(30000, 'input')], voucherDiscount: 5000 });
            await run();
            expect(created.profit).toBe(15000);
        });

        test('is zero with no voucher or fee deduction when every unit is unknown', async () => {
            arrange({ units: [unit(null, 'unknown'), unit(null)], voucherDiscount: 5000, fee: 1500 });
            await run();
            expect(created.profit).toBe(0);
        });

        test('never changes the markup profit of a reseller order', async () => {
            arrange({ units: [unit(30000, 'input')], isReseller: true, markupPerUnit: 4000, voucherDiscount: 1000 });
            await run();
            expect(created.profit).toBe(3000);
        });
    }
});

describe('QRIS checkout fee', () => {
    test('takes the gateway fee off when the seller bears it, and records who pays', async () => {
        arrange({ units: [unit(30000, 'input')], fee: 2000, feePaidBy: 'merchant' });
        await payWithQris(ctx);
        expect(created.profit).toBe(18000);
        expect(created.fee_paid_by).toBe('merchant');
    });

    test('ignores the gateway fee when the buyer pays it', async () => {
        arrange({ units: [unit(30000, 'input')], fee: 2000, feePaidBy: 'customer' });
        await payWithQris(ctx);
        expect(created.profit).toBe(20000);
        expect(created.fee_paid_by).toBe('customer');
    });
});
