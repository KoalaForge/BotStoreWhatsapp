/**
 * WhatsApp Payment Trigger Service
 *
 * Handles payment trigger processing from koalabotbe (Laravel).
 * Called via POST /api/transactions/process-payment after koalabotbe
 * validates a payment webhook from the gateway.
 *
 * Orchestrates: find transaction -> validate -> mark paid -> deliver.
 * Adapted from Telegram's paymentTriggerService for Baileys WhatsApp socket.
 */

const moment = require('moment-timezone');
const clc = require('cli-color');

const TransactionModel = require('../database/models/transactionModels');
const repositoryContext = require('./repositoryContext');
const transactionService = require('./transactionService');
const orderService = require('./orderService');
const orderTransactionItemService = require('./orderTransactionItemService');
const gatewayResolverService = require('./payment/GatewayResolverService');
const modeService = require('./modeService');
const { deliverTransaction } = require('./waTransactionDeliveryService');
const { resolveSettlementRepair } = require('./settlementRepair');
const { NotFoundException, ApiException } = require('../exceptions');

const DELIVERY_STATUS = {
    ALREADY_PROCESSED: 'already_processed',
    PAID_PENDING_DELIVERY: 'paid_pending_delivery',
    DELIVERED: 'delivered',
    PAID_DELIVERY_PENDING: 'paid_delivery_pending',
};

class WaPaymentTriggerService {
    /**
     * Reconcile settlement fields for a paid order in MULTI mode.
     *
     * Runs when koalabotbe (Laravel) wrote payment fields directly to Mongo
     * before invoking the bot trigger API, or when the polling loop detects an
     * already-paid transaction whose settlement fields are wrong/missing.
     *
     * For own-credentials owners it also REPAIRS a wrongly-stamped
     * settle_expected_at (clears it + marks settled) so koalabotbe's T+24h
     * settlement cron cannot double-credit their platform balance. Decision is
     * delegated to the pure resolveSettlementRepair() helper.
     *
     * Idempotent — atomic conditional update; no-op when already correct or not
     * eligible (SINGLE mode, balance/topup, missing paid_at, gateway unresolved).
     */
    async backfillSettlementIfMissing(transaction) {
        if (!modeService.isMultiMode()) return;
        if (!transaction.paid_at) return;
        if (transaction.transaction_type !== 'product') return;
        if (transaction.payment_method_code === 'balance') return;
        if (!transaction.ownerId) return;

        let useOwnCredentials = false;
        try {
            const resolved = await gatewayResolverService.resolveGateway(transaction.ownerId);
            useOwnCredentials = !!resolved.useOwnCredentials;
        } catch (resolveErr) {
            console.warn(clc.yellow.bold('[ API WARN ]') + ` Settlement backfill skipped for ${transaction.transactionId}: gateway resolve failed — ${resolveErr.message}`);
            return;
        }

        const repair = resolveSettlementRepair(transaction, useOwnCredentials);
        if (!repair) return;

        try {
            const result = await TransactionModel.updateOne(repair.filter, { $set: repair.update });
            if (result.modifiedCount > 0) {
                Object.assign(transaction, repair.update);
                console.log(clc.green.bold('[ API ]') + ` Settlement reconciled for ${transaction.transactionId}: ${JSON.stringify(repair.update)}`);
            }
        } catch (updateErr) {
            console.warn(clc.yellow.bold('[ API WARN ]') + ` Settlement backfill update failed for ${transaction.transactionId}: ${updateErr.message}`);
        }
    }

    /**
     * Mark transaction as paid atomically.
     * Uses CAS: only updates if isSuccess is still false.
     */
    async _markTransactionPaid(transaction, paidDate, paymentId) {
        if (transaction.isSuccess) {
            return false;
        }

        const isOwnerTopUp = transaction.transaction_type === 'topup' && transaction.ownerId === null;

        if (isOwnerTopUp) {
            return await transactionService.markOwnerTopUpSuccess(
                transaction.transactionId, paidDate, paymentId, { markDelivered: false }
            );
        }

        const context = await repositoryContext.createContext(transaction.botId, transaction.ownerId);
        const { useOwnCredentials } = await gatewayResolverService.resolveGateway(transaction.ownerId);
        await transactionService.markTransactionSuccess(context, transaction.transactionId, paidDate, useOwnCredentials);
        return true;
    }

    /**
     * Process a payment trigger from koalabotbe.
     *
     * Flow:
     * 1. Find transaction (unscoped — botId discovered from document)
     * 2. Idempotency check (already delivered -> already_processed)
     * 3. Amount sanity check (defense-in-depth)
     * 4. Atomic CAS mark as paid
     * 5. Resolve WaConnection from WaBotManager
     * 6. Execute delivery pipeline (shared with ProcessTransaction.js)
     *
     * @param {Object} params
     * @param {string} params.transactionId
     * @param {string|null} params.paidAt
     * @param {string|null} params.paymentId
     * @param {number|null} params.amount
     * @param {Object} waBotManager - WaBotManager instance
     * @returns {Promise<Object>} Result with status and transactionId
     */
    async processPayment({ transactionId, paidAt, paymentId, amount }, waBotManager) {
        console.log(clc.green.bold("[ API ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Payment trigger received for ${transactionId}`));

        // 1. Find transaction (unscoped)
        const transaction = await TransactionModel.findOne({
            transactionId: transactionId,
            isCanceled: false
        });

        if (!transaction) {
            throw new NotFoundException('Transaction not found or already cancelled');
        }

        // Backfill settlement fields if Laravel wrote payment fields directly
        // (paid_at present but settle_expected_at/is_settled unset). Must run
        // BEFORE idempotency early-return below.
        await this.backfillSettlementIfMissing(transaction);

        // 2. Idempotency: already fully processed
        if (transaction.isSuccess && transaction.isDelivered) {
            return { status: DELIVERY_STATUS.ALREADY_PROCESSED, transactionId };
        }

        // 3. Amount sanity check
        if (amount != null && Math.abs(amount - transaction.totalPrice) > 1) {
            console.warn(clc.yellow.bold("[ API WARN ]") + ` Amount mismatch for ${transactionId}: expected ${transaction.totalPrice}, got ${amount}`);
            throw new ApiException(`Amount mismatch: expected ${transaction.totalPrice}, got ${amount}`, 422);
        }

        // 4. Mark as paid (atomic CAS)
        const paidDate = paidAt ? new Date(paidAt) : new Date();
        const paymentTimeString = paidAt || moment().tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');

        await this._markTransactionPaid(transaction, paidDate, paymentId);

        const context = await repositoryContext.createContext(transaction.botId, transaction.ownerId);
        const items = await orderTransactionItemService.getTransactionItems(context, transaction.transactionId);
        for (const item of items) {
            await orderService.finalizeTrackedStock(context, {
                stockItems: item.data,
                isReseller: transaction.is_reseller_order === true,
                transactionId: transaction.transactionId,
                orderItemId: item._id
            });
        }

        // 5. Resolve WaConnection for WhatsApp messaging
        const connection = waBotManager.getBotInstance(transaction.botId);

        if (!connection) {
            console.warn(clc.yellow.bold("[ API WARN ]") + ` Bot ${transaction.botId} not running for ${transactionId}, delivery deferred to polling`);
            return { status: DELIVERY_STATUS.PAID_PENDING_DELIVERY, transactionId };
        }

        // 6. Deliver via shared service
        try {
            await deliverTransaction(connection.sock, transaction, paymentTimeString);

            console.log(clc.green.bold("[ API ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Transaction ${transactionId} delivered successfully via API trigger`));

            return { status: DELIVERY_STATUS.DELIVERED, transactionId };
        } catch (err) {
            console.error(clc.red.bold("[ API ERROR ]") + ` Delivery failed for ${transactionId}: ${err.message}`);
            return { status: DELIVERY_STATUS.PAID_DELIVERY_PENDING, transactionId };
        }
    }
}

module.exports = new WaPaymentTriggerService();
module.exports.DELIVERY_STATUS = DELIVERY_STATUS;
