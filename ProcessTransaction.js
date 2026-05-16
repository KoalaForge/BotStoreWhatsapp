const clc = require('cli-color')
const moment = require('moment-timezone')
const { withRetry } = require('./src/utils/waRetry')

const transactionRepository = require('./src/repositories/TransactionRepository');
const repositoryContext = require('./src/services/repositoryContext');

const qrisService = require('./src/services/qrisService');
const transactionService = require('./src/services/transactionService');
const waPaymentTriggerService = require('./src/services/waPaymentTriggerService');
const gatewayResolverService = require('./src/services/payment/GatewayResolverService');
const transactionItemsHelper = require('./src/utils/transactionItemsHelper');
const waMessageFormatter = require('./src/utils/waMessageFormatter');

const PaymentMethod = require('./src/database/models/paymentMethodModel');
const modeService = require('./src/services/modeService');

// Shared delivery logic (extracted to avoid duplication with trigger API)
const { deliverTransaction } = require('./src/services/waTransactionDeliveryService');

// ---------------------------------------------------------------------------
// Polling-only helpers (expiry & reminders — not needed in trigger API)
// ---------------------------------------------------------------------------

/**
 * Handle an expired transaction (>= 6 minutes).
 * Deletes the QRIS message, cancels the transaction, restores stock, and
 * sends an expiry notification to the user.
 */
async function handleExpiredTransaction(sock, context, transaction, givenTimeString) {
    console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Transaksi ${transaction.transactionId} telah kadaluarsa }`));

    try {
        // Delete the QRIS message via WhatsApp
        if (transaction.messageId) {
            await withRetry(() => sock.sendMessage(transaction.chatId, {
                delete: {
                    remoteJid: transaction.chatId,
                    id: transaction.messageId,
                    fromMe: true
                }
            }));
        }

        // Owner top-up: ownerId is null in DB, use unscoped expire
        const isOwnerTopUp = !modeService.isSingleMode() && transaction.transaction_type === 'topup' && transaction.ownerId === null;
        if (isOwnerTopUp) {
            await transactionRepository.updateOneUnscoped(
                { transactionId: transaction.transactionId },
                { $set: { isCanceled: true, payment_status: 'expired' } }
            );
            // Also expire the platform record for owner top-up
            const TransactionModel = require('./src/database/models/transactionModels');
            await TransactionModel.updateOne(
                {
                    platform_reference: transaction.transactionId,
                    botId: null,
                    ownerId: null
                },
                { $set: { isCanceled: true, payment_status: 'expired' } }
            );
        } else {
            await transactionRepository.expireTransaction(context, transaction.transactionId);
            await transactionItemsHelper.restoreStockCompat(context, transaction);
        }

        const expiredMessage = waMessageFormatter.formatTransactionExpiredMessage({
            transactionId: transaction.transactionId,
            transaction_type: transaction.transaction_type || 'product',
            expiredDate: givenTimeString
        });

        await withRetry(() => sock.sendMessage(
            transaction.chatId,
            { text: expiredMessage }
        ));
    } catch (err) {
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error processing expired transaction ${err.message}`));
    }
}

/**
 * Send a payment-about-to-expire reminder (>= 5 minutes, < 6 minutes)
 * and flag the transaction so the reminder is only sent once.
 */
async function handleTransactionReminder(sock, context, transaction) {
    console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Transaksi ${transaction.transactionId} hampir kadaluarsa }`));

    await transactionRepository.updateOne(context, { transactionId: transaction.transactionId, isSuccess: false, isCanceled: false }, { $set: { isReminded: true } })

    const reminderMessage = waMessageFormatter.formatPaymentReminderMessage({
        transactionId: transaction.transactionId
    });

    await withRetry(() => sock.sendMessage(
        transaction.chatId,
        { text: reminderMessage }
    ));
}

// ---------------------------------------------------------------------------
// Payment detection & delivery (polling path)
// ---------------------------------------------------------------------------

/**
 * Detect whether payment has been made and, if so, deliver the product or
 * top-up. Uses early returns to flatten the previously nested logic.
 */
async function detectPaymentAndDeliver(sock, context, transaction, statusData) {
    const isAlreadyPaid = transaction.isSuccess === true;
    const isPaymentSuccess = statusData.success;

    let shouldDeliver = isAlreadyPaid;
    let paymentTimeString = moment(transaction.updatedAt).tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss');
    let paymentDate = null;

    if (!isAlreadyPaid && isPaymentSuccess) {
        paymentTimeString = statusData.date;
        const paymentTime = moment(paymentTimeString, "YYYY-MM-DD HH:mm:ss");
        const payDiffMinutes = moment().diff(paymentTime, 'minutes');

        if (payDiffMinutes < 7) {
            shouldDeliver = true;

            if (transaction.paid_at) {
                paymentDate = new Date(transaction.paid_at);
            } else {
                paymentDate = paymentTime.toDate();
            }
        }
    }

    if (!shouldDeliver) return;

    const isOwnerTopUp = !modeService.isSingleMode() && (transaction.transaction_type || 'product') === 'topup' && transaction.ownerId === null;

    // Backfill settlement fields when a paid-but-unsettled transaction is
    // observed (e.g. Laravel wrote isSuccess/paid_at direct to Mongo without
    // hitting the trigger API). Idempotent — no-op if fields already set or
    // transaction is not eligible (SINGLE mode, balance, topup, etc.).
    if (isAlreadyPaid && !isOwnerTopUp) {
        await waPaymentTriggerService.backfillSettlementIfMissing(transaction);
    }

    // Only mark as success if not already paid (trigger API or webhook already did this)
    if (!isAlreadyPaid) {
        if (isOwnerTopUp) {
            await transactionService.markOwnerTopUpSuccess(
                transaction.transactionId, paymentDate, null, { markDelivered: true }
            );
        } else {
            const { useOwnCredentials } = await gatewayResolverService.resolveGateway(transaction.ownerId);
            await transactionService.markTransactionSuccess(context, transaction.transactionId, paymentDate, useOwnCredentials);
        }
    }

    // Deliver via shared service (handles QRIS message deletion + handler dispatch)
    await deliverTransaction(sock, transaction, paymentTimeString);
}

// ---------------------------------------------------------------------------
// Per-transaction processing
// ---------------------------------------------------------------------------

/**
 * Process a single pollable transaction: check expiry, send reminders,
 * detect payment, and deliver.
 */
async function processOneTransaction(sock, transaction, statusData) {
    const context = await repositoryContext.createContext(transaction.botId, transaction.ownerId);

    const givenTimeString = transaction.formattedDate;
    const givenTime = moment(givenTimeString, "YYYY-MM-DD HH:mm:ss");

    const currentTime = moment();
    const diffMinutes = currentTime.diff(givenTime, 'minutes');

    if (diffMinutes >= 6) {
        await handleExpiredTransaction(sock, context, transaction, givenTimeString);
        return;
    }

    if (diffMinutes >= 5 && transaction.isReminded === false) {
        await handleTransactionReminder(sock, context, transaction);
    }

    await detectPaymentAndDeliver(sock, context, transaction, statusData);
}

/**
 * Handle expiry and reminders for webhook_only transactions.
 * These transactions are NOT polled for payment status (no HTTP call to gateway),
 * but they still need to expire after 6 minutes and get reminders at 5 minutes.
 */
async function processExpiryAndReminders(sock, transaction) {
    const context = await repositoryContext.createContext(transaction.botId, transaction.ownerId);

    const givenTimeString = transaction.formattedDate;
    const givenTime = moment(givenTimeString, "YYYY-MM-DD HH:mm:ss");

    const currentTime = moment();
    const diffMinutes = currentTime.diff(givenTime, 'minutes');

    if (diffMinutes >= 6) {
        await handleExpiredTransaction(sock, context, transaction, givenTimeString);
        return;
    }

    if (diffMinutes >= 5 && transaction.isReminded === false) {
        await handleTransactionReminder(sock, context, transaction);
    }
}

// ---------------------------------------------------------------------------
// Processing mode resolution
// ---------------------------------------------------------------------------

// In-memory cache for webhook_only payment method codes.
// Payment method config changes are rare (admin-driven), so a 60s TTL is safe.
const _webhookOnlyCache = { codes: null, ts: 0 };
const WEBHOOK_ONLY_CACHE_TTL_MS = 60_000;

/**
 * Resolve which payment method codes are webhook_only.
 * Reads from payment_methods collection (managed by koalabotbe, READ-ONLY).
 * Returns a Set of payment_method_codes that should NOT be polled.
 * Result is cached for 60 seconds to avoid a DB query every 3-second cycle.
 *
 * @param {string[]} codes - Unique payment_method_code values from pending transactions
 * @returns {Promise<Set<string>>}
 */
async function resolveWebhookOnlyCodes(codes) {
    if (codes.length === 0) return new Set();

    const now = Date.now();
    if (_webhookOnlyCache.codes !== null && (now - _webhookOnlyCache.ts) < WEBHOOK_ONLY_CACHE_TTL_MS) {
        return _webhookOnlyCache.codes;
    }

    const methods = await PaymentMethod.find({
        code: { $in: codes },
        is_active: true
    }).select('code configuration').lean();

    const webhookOnlyCodes = new Set();
    for (const m of methods) {
        const mode = m.configuration?.processing_mode;
        if (mode === 'webhook_only') {
            webhookOnlyCodes.add(m.code);
        }
    }

    _webhookOnlyCache.codes = webhookOnlyCodes;
    _webhookOnlyCache.ts = now;
    return webhookOnlyCodes;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function ProcessingTransaction(sock, botId = null) {
    try {
        const baseConditions = [
            {
                $or: [
                    { isSuccess: false, isCanceled: false },
                    { isSuccess: true, isDelivered: false, isCanceled: false }
                ]
            }
        ];

        if (modeService.isSingleMode()) {
            baseConditions.push(
                {
                    $or: [
                        { orderChannel: "whatsapp" },
                        { orderChannel: { $exists: false } },
                        { orderChannel: null }
                    ]
                },
                { botId: null },
                { ownerId: null }
            );
        } else {
            // MULTI mode: filter by botId, ownerId, orderChannel
            baseConditions.push(
                {
                    $or: [
                        { orderChannel: "whatsapp" },
                        { orderChannel: { $exists: false } },
                        { orderChannel: null }
                    ]
                },
                { botId: { $ne: null } },
                {
                    $or: [
                        { ownerId: { $ne: null } },
                        { ownerId: null, transaction_type: 'topup' }
                    ]
                }
            );
        }

        const queryFilter = { $and: baseConditions };

        if (botId) {
            queryFilter.botId = botId;
        }

        const pendingTransactions = await transactionRepository.findAllUnscoped(queryFilter);

        if (pendingTransactions.length === 0) return;

        // Resolve which payment methods are webhook_only (should not be polled for payment status)
        // SINGLE mode: always poll everything (no processing_mode filtering)
        let pollableTransactions;
        let webhookOnlyTransactions;

        if (modeService.isSingleMode()) {
            pollableTransactions = pendingTransactions;
            webhookOnlyTransactions = [];
        } else {
            const uniqueCodes = [...new Set(pendingTransactions.map(t => t.payment_method_code).filter(Boolean))];
            const webhookOnlyCodes = await resolveWebhookOnlyCodes(uniqueCodes);

            pollableTransactions = [];
            webhookOnlyTransactions = [];

            for (const t of pendingTransactions) {
                if (webhookOnlyCodes.has(t.payment_method_code) && !t.isSuccess) {
                    webhookOnlyTransactions.push(t);
                } else {
                    pollableTransactions.push(t);
                }
            }
        }

        // Payment status checks ONLY for pollable transactions
        // Skip gateway API call for transactions already marked paid (by trigger API)
        const statusResults = await Promise.all(pollableTransactions.map(t => {
            if (t.isSuccess) {
                // Already paid (by trigger API or webhook) — skip expensive HTTP call
                return Promise.resolve({
                    success: true,
                    date: moment(t.paid_at || t.updatedAt).tz('Asia/Jakarta').format('YYYY-MM-DD HH:mm:ss')
                });
            }
            return qrisService.checkPaymentStatus({
                referenceId: t.gateway_reference || t.transactionId,
                amount: t.totalPrice,
                ownerId: t.ownerId
            });
        }));

        // Process all transactions concurrently — each is independent.
        // Promise.allSettled ensures one failing tx doesn't block others.
        const pollableResults = await Promise.allSettled(
            pollableTransactions.map((t, idx) => processOneTransaction(sock, t, statusResults[idx]))
        );
        for (const [idx, result] of pollableResults.entries()) {
            if (result.status === 'rejected') {
                console.error(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` processOneTransaction ${pollableTransactions[idx].transactionId}: ${result.reason?.message}`));
            }
        }

        // Process webhook-only transactions concurrently (expiry + reminders only)
        await Promise.allSettled(
            webhookOnlyTransactions.map(t => processExpiryAndReminders(sock, t))
        );
    } catch (error) {
        console.error(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error add Transaction Queue : ${error.message}`));
    }
};

module.exports = ProcessingTransaction
