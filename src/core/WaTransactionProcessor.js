const ProcessingTransaction = require('../../ProcessTransaction');
const modeService = require('../services/modeService');

/**
 * WaTransactionProcessor - Handles transaction processing for multi-bot mode
 * Processes transactions for all active WhatsApp bots in parallel.
 * Equivalent of TransactionProcessor in the Telegram project.
 */
class WaTransactionProcessor {
    constructor(waBotManager) {
        this.waBotManager = waBotManager;
        this.isProcessing = false;
        this.intervalId = null;
        this._processingDoneResolve = null;
    }

    /**
     * Start transaction processing interval
     * @param {number} [interval=3000] - Processing interval in milliseconds
     */
    start(interval = 3000) {
        if (this.intervalId) {
            console.warn("WA Transaction processor already running");
            return;
        }

        this.intervalId = setInterval(async () => {
            if (!this.isProcessing) {
                this.isProcessing = true;
                await this.process();
                this.isProcessing = false;
                // Resolve any drain waiter
                if (this._processingDoneResolve) {
                    this._processingDoneResolve();
                    this._processingDoneResolve = null;
                }
            }
        }, interval);
    }

    /**
     * Stop transaction processing interval
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    /**
     * Wait for the current processing cycle to finish (if one is running).
     * Resolves immediately if no cycle is in progress.
     * @returns {Promise<void>}
     */
    waitForDrain() {
        if (!this.isProcessing) return Promise.resolve();
        return new Promise((resolve) => {
            this._processingDoneResolve = resolve;
        });
    }

    /**
     * Process transactions for all active WhatsApp bots
     * @private
     */
    async process() {
        if (modeService.isSingleMode()) {
            // Single mode: process handled in index.js
            return;
        }

        // Multi mode: process for each bot connection. Skip half-connected
        // bots — calling sock methods on a sock that hasn't reached
        // `connection: 'open'` yet (or is mid-reconnect) can trigger spurious
        // 408 disconnects and pollutes audit logs with timeouts.
        const connections = this.waBotManager.getAllBots()
            .filter(c => c.isRunning && c.sock);

        // Process transactions for all bots in parallel with per-bot 15s timeout
        // Prevents one slow/hung bot from blocking the entire processing cycle
        await Promise.all(
            connections.map(connection =>
                Promise.race([
                    ProcessingTransaction(connection.sock, connection.botId),
                    new Promise((_, reject) =>
                        setTimeout(
                            () => reject(new Error(`Timeout: bot ${connection.botId}`)),
                            15000
                        )
                    )
                ]).catch(err => console.error(
                    `WA Transaction processing error for bot ${connection.botId}:`,
                    err.message
                ))
            )
        );
    }
}

module.exports = WaTransactionProcessor;
