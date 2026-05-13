const orderTransactionItemRepository = require('../repositories/OrderTransactionItemRepository');
const TransactionModel = require('../database/models/transactionModels');

/**
 * OrderTransactionItem Service
 * Business logic for managing transaction line items
 *
 * Purpose:
 * - Create itemized transaction records
 * - Provide backward compatibility with orderData
 * - Calculate profits from itemized data
 * - Support multi-variant orders
 */
class OrderTransactionItemService {
    /**
     * Create transaction items from processed stock
     * Supports multi-variant orders (array of different variants)
     *
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} transactionId - Transaction ID (string, e.g., "TRX-1234567890")
     * @param {Array} itemsData - Array of item data objects
     * @param {string} itemsData[].codeVariant - Variant code
     * @param {number} itemsData[].quantity - Order quantity
     * @param {number} itemsData[].unitPrice - Price per unit
     * @param {number|null} [itemsData[].costPrice] - Reseller's buy price per unit (null for normal orders)
     * @param {Array} itemsData[].stockItems - Array of stock snapshots [{_id, codeVariant, dataStock, profit, createdAt, updatedAt}]
     * @param {Object} itemsData[].productInfo - Product snapshot {productCode, productName, variantName}
     * @returns {Promise<Array>} - Created items
     *
     * @example
     * await createTransactionItems(ctx, "TRX-123", [{
     *   codeVariant: "CANVA-1B",
     *   quantity: 2,
     *   unitPrice: 15000,
     *   stockItems: [{_id: "...", dataStock: "acc1", profit: 5000, ...}, ...],
     *   productInfo: { productCode: "CANVA", productName: "Canva Pro", variantName: "1 Bulan" }
     * }])
     */
    async createTransactionItems(context, transactionId, itemsData) {
        // Find transaction by transactionId (string) to get _id (ObjectId)
        const transaction = await TransactionModel.findOne({ transactionId: transactionId });

        if (!transaction) {
            throw new Error(`Transaction ${transactionId} not found`);
        }

        const createdItems = [];

        for (const itemData of itemsData) {
            const {
                codeVariant,
                quantity,
                unitPrice,
                costPrice, // Reseller's buy price per unit (null for normal orders)
                stockItems, // Array of stock objects
                productInfo // { productCode, productName, variantName }
            } = itemData;

            // Validate required fields
            if (!codeVariant || !quantity || !unitPrice || !stockItems || !productInfo) {
                throw new Error('Missing required fields in itemData: codeVariant, quantity, unitPrice, stockItems, productInfo');
            }

            if (!Array.isArray(stockItems) || stockItems.length === 0) {
                throw new Error('stockItems must be a non-empty array');
            }

            if (stockItems.length !== quantity) {
                throw new Error(`stockItems length (${stockItems.length}) must match quantity (${quantity})`);
            }

            // Create item with stock data snapshots
            const item = await orderTransactionItemRepository.create(context, {
                order_transaction_id: transaction._id.toString(),
                codeVariant: codeVariant,
                quantity: quantity,
                unit_price: unitPrice,
                cost_price: costPrice != null ? costPrice : null,
                subtotal: quantity * unitPrice,
                data: stockItems, // Array of complete stock snapshots
                product_code: productInfo.productCode,
                product_name: productInfo.productName,
                variant_name: productInfo.variantName
                // botId and ownerId will be auto-injected by BaseRepository
            });

            createdItems.push(item);
        }

        return createdItems;
    }

    /**
     * Get items for a transaction
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} transactionId - Transaction ID (string)
     * @returns {Promise<Array>} - Transaction items or empty array if not found
     */
    async getTransactionItems(context, transactionId) {
        // Find transaction by transactionId (string) to get _id (ObjectId)
        const transaction = await TransactionModel.findOne({ transactionId: transactionId });

        if (!transaction) {
            return [];
        }

        return await orderTransactionItemRepository.findByTransactionObjectId(context, transaction._id);
    }

    /**
     * Extract orderData string from items (for backward compatibility)
     * Concatenates all dataStock from all items into newline-delimited string
     *
     * @param {Array} items - Transaction items
     * @returns {string} - orderData string (newline-delimited)
     *
     * @example
     * items = [{
     *   data: [
     *     {dataStock: "acc1"},
     *     {dataStock: "acc2"}
     *   ]
     * }]
     * // Returns: "acc1\nacc2"
     */
    getOrderDataFromItems(items) {
        if (!items || items.length === 0) {
            return '';
        }

        return items
            .flatMap(item => Array.isArray(item.data) ? item.data : [])
            .filter(stockItem => stockItem.dataStock)
            .map(stockItem => stockItem.dataStock)
            .join('\n');
    }

    /**
     * Calculate total profit from items
     * Sums up all profit values from all stock items in all transaction items
     *
     * @param {Array} items - Transaction items
     * @returns {number} - Total profit (cost of goods sold)
     *
     * @example
     * items = [{
     *   data: [
     *     {profit: 5000},
     *     {profit: 3000}
     *   ]
     * }, {
     *   data: [{profit: 7000}]
     * }]
     * // Returns: 15000
     */
    calculateProfitFromItems(items) {
        if (!items || items.length === 0) {
            return 0;
        }

        return items
            .flatMap(item => Array.isArray(item.data) ? item.data : [])
            .reduce((sum, stockItem) => sum + (stockItem.profit || 0), 0);
    }

    /**
     * Get items by variant code (for reporting)
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Array>} - Items
     */
    async getItemsByVariant(context, codeVariant) {
        return await orderTransactionItemRepository.findByVariantCode(context, codeVariant);
    }

    /**
     * Get statistics for a variant
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object>} - { totalQuantity, totalProfit, itemCount }
     */
    async getVariantStats(context, codeVariant) {
        const items = await orderTransactionItemRepository.findByVariantCode(context, codeVariant);

        const totalQuantity = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
        const totalProfit = this.calculateProfitFromItems(items);

        return {
            totalQuantity,
            totalProfit,
            itemCount: items.length
        };
    }
}

module.exports = new OrderTransactionItemService();
