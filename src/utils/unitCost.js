const formatRupiah = (amount) => `Rp ${amount.toLocaleString('id-ID')}`;

/**
 * Parse a typed unit cost. Only plain digits are accepted so that "10k",
 * "10.000" or "1.5" are never read as a different number.
 * @returns {number|null}
 */
function parseUnitCost(input) {
    if (typeof input !== 'string' || !/^\d+$/.test(input)) return null;

    const unitCost = Number(input);
    return Number.isSafeInteger(unitCost) ? unitCost : null;
}

function formatUnitCostSummary(price, unitCost) {
    const profit = price - unitCost;
    const result = profit < 0
        ? `rugi ${formatRupiah(-profit)}/unit`
        : `profit ${formatRupiah(profit)}/unit`;

    return `Modal ${formatRupiah(unitCost)} → ${result}`;
}

module.exports = { parseUnitCost, formatUnitCostSummary };
