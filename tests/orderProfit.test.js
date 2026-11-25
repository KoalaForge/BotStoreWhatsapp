const { recalculateOrderProfit } = require('../src/services/orderProfitService');

const unit = (unitCost, unitCostSource) => ({ dataStock: 'x', profit: 999000, unitCost, ...(unitCostSource ? { unitCostSource } : {}) });
const item = (unitPrice, units) => ({ unit_price: unitPrice, data: units });
const order = (overrides = {}) => ({ profit: 777, voucherDiscount: 0, payment_fee: 0, is_reseller_order: false, orderChannel: 'whatsapp', ownerId: 'owner-1', ...overrides });

describe('recalculateOrderProfit, non-reseller orders', () => {
    test('sums the price paid minus the cost of each unit sold', () => {
        const items = [item(50000, [unit(30000, 'input'), unit(20000, 'input')])];

        expect(recalculateOrderProfit(order(), items)).toBe(50000);
    });

    test('uses the price on the item snapshot for each item', () => {
        const items = [item(35000, [unit(30000, 'input')]), item(50000, [unit(10000, 'input')])];

        expect(recalculateOrderProfit(order(), items)).toBe(45000);
    });

    test('keeps a negative profit instead of flooring it at zero', () => {
        expect(recalculateOrderProfit(order(), [item(35000, [unit(40000, 'input')])])).toBe(-5000);
    });

    test('keeps a loss made larger by the voucher', () => {
        expect(recalculateOrderProfit(order({ voucherDiscount: 1000 }), [item(10000, [unit(10000, 'input')])])).toBe(-1000);
    });

    test('takes the voucher off the profit', () => {
        expect(recalculateOrderProfit(order({ voucherDiscount: 5000 }), [item(50000, [unit(30000, 'input')])])).toBe(15000);
    });

    test('takes the payment fee off when the seller bears it', () => {
        const profit = recalculateOrderProfit(order({ payment_fee: 2000, fee_paid_by: 'merchant' }), [item(50000, [unit(30000, 'input')])]);

        expect(profit).toBe(18000);
    });

    test('charges the fee to the seller when nobody is recorded as paying it', () => {
        expect(recalculateOrderProfit(order({ payment_fee: 2000 }), [item(50000, [unit(30000, 'input')])])).toBe(18000);
    });

    test('ignores the fee when the customer pays it', () => {
        const profit = recalculateOrderProfit(order({ payment_fee: 2000, fee_paid_by: 'customer' }), [item(50000, [unit(30000, 'input')])]);

        expect(profit).toBe(20000);
    });

    test('leaves units with an unknown cost out, revenue and cost together', () => {
        const units = [unit(null), unit(25000, 'unknown'), unit(30000, 'input')];

        expect(recalculateOrderProfit(order(), [item(50000, units)])).toBe(20000);
    });

    test('counts estimated units and units with a cost but no marker', () => {
        const units = [unit(30000, 'estimated'), unit(20000)];

        expect(recalculateOrderProfit(order(), [item(50000, units)])).toBe(50000);
    });

    test('is zero with no voucher or fee deduction when every unit is unknown', () => {
        const profit = recalculateOrderProfit(order({ voucherDiscount: 5000, payment_fee: 1500 }), [item(50000, [unit(null), unit(null, 'unknown')])]);

        expect(profit).toBe(0);
    });

    test('deducts voucher and fee in full when only some units are known', () => {
        const profit = recalculateOrderProfit(order({ voucherDiscount: 5000, payment_fee: 1500 }), [item(50000, [unit(null), unit(30000, 'input')])]);

        expect(profit).toBe(13500);
    });

    test('never adds an admin fee', () => {
        expect(recalculateOrderProfit(order({ adminFee: 1500 }), [item(50000, [unit(30000, 'input')])])).toBe(20000);
    });

    test('lands on the same profit when run again', () => {
        const o = order({ payment_fee: 2000 });
        const items = [item(50000, [unit(30000, 'input')])];

        const first = recalculateOrderProfit(o, items);
        const second = recalculateOrderProfit({ ...o, profit: first }, items);

        expect(second).toBe(first);
    });

    test('keeps the stored profit when there are no units to read', () => {
        expect(recalculateOrderProfit(order(), [])).toBe(777);
    });
});

describe('recalculateOrderProfit, settlement orders', () => {
    const items = [item(50000, [unit(10000, 'input')])];

    test.each([
        ['reseller order', { is_reseller_order: true }],
        ['API order of an owner', { orderChannel: 'api', ownerId: 'owner-1' }]
    ])('never changes the profit of a %s', (_name, overrides) => {
        expect(recalculateOrderProfit(order({ ...overrides, payment_fee: 500 }), items)).toBe(777);
    });

    test('an API order without an owner is a normal order', () => {
        expect(recalculateOrderProfit(order({ orderChannel: 'api', ownerId: null }), items)).toBe(40000);
    });
});
