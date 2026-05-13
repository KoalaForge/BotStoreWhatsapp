const { buildOrderMenuItems, buildOrderMenuText, buildOrderConfirmationButtons } = require('../src/utils/orderMenuText');
const { orderActionToCallback } = require('../src/utils/callbackIds');

describe('buildOrderMenuItems', () => {
    test('default — saldo enabled, no voucher, no notes', () => {
        const items = buildOrderMenuItems();
        const actions = items.map(i => i.action);
        expect(actions).toEqual([
            'pay-with-qris',
            'pay-with-balance',
            'change-quantity',
            'apply-voucher',
            'add-buyer-notes'
        ]);
    });

    test('saldoEnabled=false hides Bayar Saldo', () => {
        const items = buildOrderMenuItems({ saldoEnabled: false });
        expect(items.map(i => i.action)).not.toContain('pay-with-balance');
    });

    test('voucher applied → Hapus Voucher action', () => {
        const items = buildOrderMenuItems({ voucherCode: 'DISC10' });
        expect(items.map(i => i.action)).toContain('remove-voucher');
        expect(items.map(i => i.action)).not.toContain('apply-voucher');
    });

    test('notes set → Ubah/Hapus Catatan action', () => {
        const items = buildOrderMenuItems({ buyerNotes: 'foo' });
        expect(items.map(i => i.action)).toContain('edit-buyer-notes');
        expect(items.map(i => i.action)).not.toContain('add-buyer-notes');
    });

    test('buildOrderMenuText still produces actionMap with 0 → back', () => {
        const { actionMap } = buildOrderMenuText();
        expect(actionMap[0]).toBe('back');
        expect(actionMap[1]).toBe('pay-with-qris');
    });
});

describe('buildOrderConfirmationButtons', () => {
    test('default produces 5 menu buttons + nav:back', () => {
        const buttons = buildOrderConfirmationButtons();
        expect(buttons[buttons.length - 1]).toEqual({ id: 'nav:back', text: 'Kembali' });
        expect(buttons.length).toBe(6);
        expect(buttons[0]).toEqual({ id: 'order:qris', text: 'Bayar QRIS' });
    });

    test('saldoEnabled=false drops Bayar Saldo button', () => {
        const buttons = buildOrderConfirmationButtons({ saldoEnabled: false });
        expect(buttons.find(b => b.id === 'order:saldo')).toBeUndefined();
        expect(buttons.find(b => b.id === 'order:qris')).toBeDefined();
    });

    test('voucher applied changes label but keeps order:voucher id', () => {
        const buttons = buildOrderConfirmationButtons({ voucherCode: 'X' });
        const v = buttons.find(b => b.id === 'order:voucher');
        expect(v.text).toBe('Hapus Voucher');
    });
});

describe('orderActionToCallback', () => {
    test('maps every menu action to a callback id', () => {
        const items = buildOrderMenuItems({ voucherCode: 'X', buyerNotes: 'Y' });
        for (const item of items) {
            expect(orderActionToCallback(item.action)).toMatch(/^order:/);
        }
    });

    test('voucher apply/remove share the same callback', () => {
        expect(orderActionToCallback('apply-voucher')).toBe('order:voucher');
        expect(orderActionToCallback('remove-voucher')).toBe('order:voucher');
    });
});
