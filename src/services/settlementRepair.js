/**
 * Pure settlement-state decision helper (no DB, no env) shared by the payment
 * trigger and polling backfill paths. Kept dependency-free so it is unit-testable
 * in isolation.
 *
 * In MULTI mode an owner either runs the platform gateway (we hold the money and
 * settle T+1 — stamp settle_expected_at) or their OWN gateway (customer money
 * lands in their PG instantly — the order must be is_settled=true and must NEVER
 * carry settle_expected_at, otherwise koalabotbe's settlement cron would credit
 * their platform balance a second time).
 *
 * koalabotbe is the source of truth, but it can wrongly stamp settle_expected_at
 * on an own-credentials order. This helper lets the bot REPAIR that wrong stamp
 * at payment time (T+0), before the T+24h settlement cron fires.
 *
 * @param {Object} transaction - Transaction document/plain object
 * @param {boolean} useOwnCredentials - Whether the owner uses their own gateway
 * @returns {{filter: Object, update: Object}|null} atomic conditional update, or
 *          null when the transaction is ineligible or already in the right state.
 */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function resolveSettlementRepair(transaction, useOwnCredentials) {
    if (!transaction) return null;
    if (!transaction.paid_at) return null;
    if (transaction.transaction_type !== 'product') return null;
    if (transaction.payment_method_code === 'balance') return null;
    if (!transaction.ownerId) return null;

    const paidDate = transaction.paid_at instanceof Date
        ? transaction.paid_at
        : new Date(transaction.paid_at);

    const hasExpected = transaction.settle_expected_at != null;
    const isSettled = transaction.is_settled === true;

    if (useOwnCredentials) {
        // Own PG: must be settled, must not carry settle_expected_at.
        if (isSettled && !hasExpected) return null; // already correct

        return {
            filter: {
                transactionId: transaction.transactionId,
                $or: [
                    { settle_expected_at: { $ne: null } },
                    { is_settled: { $ne: true } },
                ],
            },
            update: {
                is_settled: true,
                settled_at: paidDate,
                settle_expected_at: null,
            },
        };
    }

    // Platform PG: stamp settle_expected_at once, unless already stamped/settled.
    if (hasExpected || isSettled) return null;

    return {
        filter: {
            transactionId: transaction.transactionId,
            settle_expected_at: null,
        },
        update: {
            settle_expected_at: new Date(paidDate.getTime() + ONE_DAY_MS),
        },
    };
}

module.exports = { resolveSettlementRepair, ONE_DAY_MS };
