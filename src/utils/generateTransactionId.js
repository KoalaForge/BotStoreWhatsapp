const settingsService = require('../services/settingsService');
const transactionRepository = require('../repositories/TransactionRepository');
const repositoryContext = require('../services/repositoryContext');

/**
 * Generate random alphabetical suffix (2 letters)
 * @returns {string} - Two random uppercase letters
 */
function generateAlphabeticalSuffix() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < 2; i++) {
        result += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    return result;
}

/**
 * Get last 3 digits from bot ID (MongoDB ObjectId string)
 * @param {string|null} botId - Bot ID (MongoDB ObjectId as string)
 * @returns {string} - Last 3 digits, or "000" for SINGLE mode
 */
function getBotIdSuffix(botId) {
    if (!botId) {
        // SINGLE mode - use "000" as placeholder
        return '000';
    }

    // Extract last 3 characters from botId
    const botIdStr = botId.toString().toUpperCase();
    return botIdStr.slice(-3);
}

/**
 * Generate a standardized transaction ID with duplicate checking
 * Format: PREFIX-YYMMDD-4DIGITS+2LETTERS-3DIGITBOTID
 * Example: INV-251217-1234AB-789, TOPUP-251217-5678XY-123
 *
 * @param {string} type - Type of transaction: 'product' or 'topup'
 * @param {Object} ctx - Telegraf context (optional, for multi-mode support)
 * @returns {Promise<string>} - Generated unique transaction ID
 */
async function generateTransactionId(type = 'product', ctx = null) {
    const MAX_ATTEMPTS = 50; // Maximum attempts to generate unique ID
    let attempts = 0;

    try {
        // Extract context for repository operations
        const context = ctx ? await repositoryContext.extractContext(ctx) : await repositoryContext.createContext(null, null);

        // Get settings - repository handles fallback automatically
        const settings = await settingsService.getSettings(ctx);

        let prefix;

        if (type === 'topup') {
            // Use database settings first, then env fallback, then hardcoded default
            prefix = settings?.topupTransactionPrefix || process.env.TOPUP_TRANSACTION_PREFIX || 'TOPUP';
        } else {
            // Product transaction
            prefix = settings?.productTransactionPrefix || process.env.PRODUCT_TRANSACTION_PREFIX || 'INV';
        }

        // Generate date part
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const datePart = `${year}${month}${day}`;

        // Get bot ID suffix (last 3 digits)
        const botIdSuffix = getBotIdSuffix(context.botId);

        // Loop until we find a unique transaction ID
        while (attempts < MAX_ATTEMPTS) {
            // Generate random number (4 digits)
            const randomNumber = Math.floor(1000 + Math.random() * 9000);

            // Generate random alphabetical suffix (2 letters)
            const alphabeticalSuffix = generateAlphabeticalSuffix();

            // Combine: PREFIX-YYMMDD-NNNNXX-BBB
            // Example: INV-251217-1234AB-789
            const transactionId = `${prefix}-${datePart}-${randomNumber}${alphabeticalSuffix}-${botIdSuffix}`;

            // Check if this transaction ID already exists
            const existingTransaction = await transactionRepository.findOne(context, { transactionId: transactionId });

            if (!existingTransaction) {
                // Unique ID found!
                return transactionId;
            }

            // ID already exists, increment attempts and try again
            attempts++;
        }

        // If we reach here, we couldn't generate a unique ID after MAX_ATTEMPTS
        // This is extremely unlikely, but we'll add a timestamp as extra uniqueness
        const timestamp = Date.now().toString().slice(-4);
        const alphabeticalSuffix = generateAlphabeticalSuffix();
        return `${prefix}-${datePart}-${timestamp}${alphabeticalSuffix}-${botIdSuffix}`;

    } catch (error) {
        console.error('Error generating transaction ID:', error);
        // Fallback to basic generation if database fails
        const prefix = type === 'topup' ? 'TOPUP' : 'INV';
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const datePart = `${year}${month}${day}`;
        const randomNumber = Math.floor(1000 + Math.random() * 9000);
        const alphabeticalSuffix = generateAlphabeticalSuffix();
        const botIdSuffix = '000'; // Fallback for error case
        return `${prefix}-${datePart}-${randomNumber}${alphabeticalSuffix}-${botIdSuffix}`;
    }
}

/**
 * Generate platform transaction ID using default settings
 * Format: PREFIX-YYMMDD-4DIGITS+2LETTERS-3DIGITBOTID
 * Uses default settings (not owner-specific settings) for prefix
 *
 * @param {string} type - Type of transaction: 'product' or 'topup'
 * @param {string} botId - Bot ID (MongoDB ObjectId as string) for suffix
 * @returns {Promise<string>} - Generated unique platform transaction ID
 */
async function generatePlatformTransactionId(type = 'product', botId = null) {
    const MAX_ATTEMPTS = 50;
    let attempts = 0;

    try {
        // Get DEFAULT settings (null ctx = default/global settings from DB)
        // Platform records don't use repository context - they use direct model access with botId: null
        const settings = await settingsService.getSettings(null);

        let prefix;

        if (type === 'topup') {
            prefix = settings?.topupTransactionPrefix || process.env.TOPUP_TRANSACTION_PREFIX || 'TOPUP';
        } else {
            prefix = settings?.productTransactionPrefix || process.env.PRODUCT_TRANSACTION_PREFIX || 'INV';
        }

        // Generate date part
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const datePart = `${year}${month}${day}`;

        // Get bot ID suffix (last 3 digits) - use actual botId for traceability
        const botIdSuffix = getBotIdSuffix(botId);

        // Loop until we find a unique transaction ID
        while (attempts < MAX_ATTEMPTS) {
            const randomNumber = Math.floor(1000 + Math.random() * 9000);
            const alphabeticalSuffix = generateAlphabeticalSuffix();

            // Combine: PREFIX-YYMMDD-NNNNXX-BBB
            const transactionId = `${prefix}-${datePart}-${randomNumber}${alphabeticalSuffix}-${botIdSuffix}`;

            // Check if this transaction ID already exists (unscoped check for platform uniqueness)
            const TransactionModel = require('../database/models/transactionModels');
            const existingTransaction = await TransactionModel.findOne({ transactionId: transactionId });

            if (!existingTransaction) {
                return transactionId;
            }

            attempts++;
        }

        // Fallback with timestamp
        const timestamp = Date.now().toString().slice(-4);
        const alphabeticalSuffix = generateAlphabeticalSuffix();
        return `${prefix}-${datePart}-${timestamp}${alphabeticalSuffix}-${botIdSuffix}`;
    } catch (error) {
        console.error('Error generating platform transaction ID:', error);
        const prefix = type === 'topup' ? 'TOPUP' : 'INV';
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const datePart = `${year}${month}${day}`;
        const randomNumber = Math.floor(1000 + Math.random() * 9000);
        const alphabeticalSuffix = generateAlphabeticalSuffix();
        const botIdSuffix = getBotIdSuffix(botId);
        return `${prefix}-${datePart}-${randomNumber}${alphabeticalSuffix}-${botIdSuffix}`;
    }
}

module.exports = { generateTransactionId, generatePlatformTransactionId };
