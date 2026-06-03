const { resolveSettlementRepair, ONE_DAY_MS } = require('../src/services/settlementRepair');

const PAID = new Date('2026-06-01T16:00:00.000Z');

function tx(overrides = {}) {
    return {
        transactionId: 'TX-1',
        transaction_type: 'product',
        payment_method_code: 'qris',
        ownerId: 'owner-1',
        paid_at: PAID,
        settle_expected_at: null,
        is_settled: false,
        ...overrides,
    };
}

describe('resolveSettlementRepair', () => {
    test('own-creds with a wrong settle_expected_at clears it and marks settled', () => {
        const wrong = new Date(PAID.getTime() + ONE_DAY_MS);
        const r = resolveSettlementRepair(tx({ settle_expected_at: wrong }), true);

        expect(r).not.toBeNull();
        expect(r.update).toEqual({ is_settled: true, settled_at: PAID, settle_expected_at: null });
        expect(r.filter.transactionId).toBe('TX-1');
    });

    test('own-creds with nothing set marks settled and leaves no settle_expected_at', () => {
        const r = resolveSettlementRepair(tx(), true);

        expect(r.update).toEqual({ is_settled: true, settled_at: PAID, settle_expected_at: null });
    });

    test('own-creds already correct (settled, no expected) is a no-op', () => {
        const r = resolveSettlementRepair(tx({ is_settled: true, settle_expected_at: null }), true);

        expect(r).toBeNull();
    });

    test('platform with nothing set stamps settle_expected_at = paid + 1 day', () => {
        const r = resolveSettlementRepair(tx(), false);

        expect(r.update.settle_expected_at.getTime()).toBe(PAID.getTime() + ONE_DAY_MS);
        expect(r.update.is_settled).toBeUndefined();
    });

    test('platform already stamped is a no-op', () => {
        const r = resolveSettlementRepair(tx({ settle_expected_at: new Date(PAID.getTime() + ONE_DAY_MS) }), false);

        expect(r).toBeNull();
    });

    test('platform already settled is a no-op', () => {
        const r = resolveSettlementRepair(tx({ is_settled: true }), false);

        expect(r).toBeNull();
    });

    test.each([
        ['non-product transaction', { transaction_type: 'topup' }],
        ['balance payment method', { payment_method_code: 'balance' }],
        ['missing paid_at', { paid_at: null }],
        ['missing ownerId', { ownerId: null }],
    ])('ineligible: %s returns null for both gateway modes', (_label, over) => {
        expect(resolveSettlementRepair(tx(over), true)).toBeNull();
        expect(resolveSettlementRepair(tx(over), false)).toBeNull();
    });

    test('paid_at given as a string is parsed to a Date', () => {
        const r = resolveSettlementRepair(tx({ paid_at: '2026-06-01T16:00:00.000Z' }), true);

        expect(r.update.settled_at.getTime()).toBe(PAID.getTime());
    });

    test('null transaction returns null', () => {
        expect(resolveSettlementRepair(null, true)).toBeNull();
    });
});
