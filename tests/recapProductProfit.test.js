const recapProduct = require('../src/command/privateCommand/recapProduct');

const row = (name, totalProfit) => ({
    _id: { product_code: 'P', product_name: 'Prod', codeVariant: name, variant_name: name },
    totalQuantity: 1, totalRevenue: 10000, totalProfit, transactionCount: 1
});
const render = (rows) => recapProduct.formatLevel1(rows, new Date('2026-01-01'), new Date('2026-01-31')).join('\n');

describe('recap by product shows negative profit', () => {
    test('a variant line with a loss is shown', () => {
        expect(render([row('A', -5000)])).toContain('- Profit: -');
    });

    test('the product subtotal shows a loss', () => {
        expect(render([row('A', -5000), row('B', 2000)])).toMatch(/Profit: \*-/);
    });

    test('the grand total shows a loss across products', () => {
        const other = { ...row('C', -9000), _id: { product_code: 'Q', product_name: 'Q', codeVariant: 'C', variant_name: 'C' } };
        expect(render([row('A', 1000), other])).toMatch(/TOTAL KESELURUHAN[\s\S]*Profit: \*-/);
    });

    test('a positive profit is still shown', () => {
        expect(render([row('A', 5000)])).toContain('- Profit:');
    });
});
