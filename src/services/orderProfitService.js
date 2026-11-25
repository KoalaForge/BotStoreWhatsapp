'use strict';

const { UnitCostSource } = require('../enums/UnitCostSource');

/**
 * Reseller and API-owner orders store the markup that settlement pays out as
 * their profit, so it must never be derived from stock.
 */
function usesSettlementProfit(order) {
    const isApiOwnerOrder = order.orderChannel === 'api' && !!order.ownerId;
    return order.is_reseller_order === true || isApiOwnerOrder;
}

/**
 * Profit of a stock order, matching the backend RecalculateOrderProfitAction:
 * what each unit sold for minus what it cost, less the voucher and the payment
 * fee the seller bears. Units without a known cost leave both sides out.
 * Pure and idempotent, so it can run again once the fee is final.
 *
 * @param {Object} order - { profit, voucherDiscount, payment_fee, fee_paid_by, is_reseller_order, orderChannel, ownerId }
 * @param {Array} items - order items: { unit_price, data: [{ unitCost, unitCostSource }] }
 * @returns {number}
 */
function recalculateOrderProfit(order, items) {
    if (usesSettlementProfit(order)) return order.profit;

    let margin = 0;
    let knownUnits = 0;
    let unitsSeen = 0;

    for (const item of items || []) {
        for (const unit of item.data || []) {
            unitsSeen++;
            const hasCost = unit.unitCost !== null && unit.unitCost !== undefined;
            if (!hasCost || unit.unitCostSource === UnitCostSource.UNKNOWN) continue;

            margin += (item.unit_price || 0) - unit.unitCost;
            knownUnits++;
        }
    }

    if (unitsSeen === 0) return order.profit;
    if (knownUnits === 0) return 0;

    const fee = order.fee_paid_by === 'customer' ? 0 : Math.max(0, order.payment_fee || 0);
    return margin - (order.voucherDiscount || 0) - fee;
}

module.exports = { recalculateOrderProfit, usesSettlementProfit };
