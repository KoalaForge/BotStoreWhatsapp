const clc = require('cli-color');
const moment = require('moment-timezone');

const MAX_RETRIES = 3;
const RETRY_DELAY = 1500; // base 1.5 seconds (was 1s — slightly slower to be safer)

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Add ±30 % jitter so retries aren't clock-perfect */
const jitter = (ms) => {
    const factor = 0.7 + Math.random() * 0.6; // 0.7 – 1.3
    return Math.round(ms * factor);
};

/**
 * Check if an error is retryable for WhatsApp/Baileys operations.
 * Non-retryable: invalid JID, media too large, forbidden actions.
 * Retryable: network errors, connection reset, socket hang up, timeouts.
 */
const isRetryable = (error) => {
    const msg = (error.message || '').toLowerCase();

    // Non-retryable errors — the request is wrong, retry won't help
    if (msg.includes('invalid jid')) return false;
    if (msg.includes('media too large')) return false;
    if (msg.includes('not a valid')) return false;
    if (msg.includes('forbidden')) return false;
    if (msg.includes('not found')) return false;
    if (msg.includes('bad request')) return false;

    // Baileys status code errors
    const statusCode = error.data?.statusCode || error.statusCode;
    if (statusCode >= 400 && statusCode < 500) return false;

    return true;
};

/**
 * Execute an async operation with retry logic for WhatsApp/Baileys.
 * Exponential backoff: 1s, 2s, 3s.
 * Never throws — returns undefined on final failure.
 *
 * @param {Function} operation - Async function to execute
 * @param {number} [maxRetries=3] - Maximum retry attempts
 * @returns {Promise<*>} - Operation result or undefined
 */
const withRetry = async (operation, maxRetries = MAX_RETRIES) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            // Non-retryable: log and bail immediately
            if (!isRetryable(error)) {
                console.log(
                    clc.yellow("[ WARN ]") +
                    ` [${moment().format('HH:mm:ss')}]: ` +
                    clc.blueBright(`WhatsApp error: ${error.message}`)
                );
                return;
            }

            console.log(
                clc.yellow("[ RETRY ]") +
                ` [${moment().format('HH:mm:ss')}]: ` +
                clc.blueBright(`Attempt ${attempt}/${maxRetries} failed: ${error.message}`)
            );

            if (attempt < maxRetries) {
                await sleep(jitter(RETRY_DELAY * attempt)); // Exponential backoff + jitter
            }
        }
    }

    // All retries exhausted — log and move on, never throw
    console.log(
        clc.red("[ RETRY ]") +
        ` [${moment().format('HH:mm:ss')}]: ` +
        clc.blueBright(`All ${maxRetries} retries exhausted, skipping operation`)
    );
};

module.exports = {
    withRetry
};
