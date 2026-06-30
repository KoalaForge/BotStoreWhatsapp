const productRepository = require('../repositories/ProductRepository');
const productVariantRepository = require('../repositories/ProductVariantRepository');
const stockRepository = require('../repositories/StockRepository');
const resellerVariantConfigRepository = require('../repositories/ResellerVariantConfigRepository');
const voucherState = require('../state/voucherState');
const resellerService = require('./resellerService');

class OrderService {
    /**
     * Resolve order context (product, variant, pricing) for both normal and reseller orders
     * Centralizes the resolution logic used by payWithQris, confirmPayBalance, handlePayWithBalance
     *
     * @param {Object} ctx - Telegraf context (with repositoryContext, pricingService)
     * @param {Object} params
     * @param {string} params.productName - Product name from parsed message
     * @param {string} params.variantName - Variant name from parsed message
     * @param {Object|null} params.resellerOrder - Reseller state data or null for normal orders
     * @returns {Promise<Object>} - { product, variant, effectivePrice, isReseller, markupPerUnit, displayVariantName }
     */
    async resolveOrderContext(ctx, {
        productName, variantName,
        productCode = null, variantCode = null,
        resellerOrder = null, quantity = 1
    }) {
        const ownerId = ctx.repositoryContext?.ownerId;

        if (!resellerOrder) {
            const result = (productCode && variantCode)
                ? await this.getProductAndVariantByCode(ctx, productCode, variantCode)
                : await this.getProductAndVariant(ctx, productName, variantName);
            const effectivePrice = await ctx.pricingService.calculatePriceForQty(result.variant, ownerId, quantity);
            const applicableTier = ctx.pricingService.getApplicableTier(result.variant, quantity);
            const nextTier = ctx.pricingService.getNextTier(result.variant, quantity);
            return {
                product: result.product,
                variant: result.variant,
                effectivePrice,
                isReseller: false,
                markupPerUnit: 0,
                displayVariantName: result.variant.name,
                applicableTier,
                nextTier,
                isResellerOverride: false
            };
        }

        // Reseller order resolution
        const platformVariant = await productVariantRepository.findPlatformVariant(resellerOrder.platformVariantCode);
        const resellerProduct = await productRepository.findByCode(ctx, resellerOrder.resellerProductCode);

        if (!platformVariant || !resellerProduct) {
            throw new Error("Reseller product or platform variant not found");
        }

        // Re-fetch config for latest markup/override values (state may be stale)
        const freshConfig = await resellerVariantConfigRepository.findConfig(ctx, resellerOrder.resellerProductCode, resellerOrder.platformVariantCode);
        const config = freshConfig || { markup_type: resellerOrder.markup_type, markup_value: resellerOrder.markup_value, tier_overrides: {} };

        const applicableTier = ctx.pricingService.getApplicableTier(platformVariant, quantity);
        const nextTier = ctx.pricingService.getNextTier(platformVariant, quantity);
        const rolePrice = await ctx.pricingService.calculatePriceForQty(platformVariant, ownerId, quantity);
        const { price: effectivePrice, isOverride } = resellerService.applyResellerPricing(rolePrice, config, applicableTier?.min_qty ?? null);

        return {
            product: resellerProduct,
            variant: platformVariant,
            effectivePrice,
            isReseller: true,
            markupPerUnit: effectivePrice - rolePrice,
            displayVariantName: resellerOrder.displayName,
            applicableTier,
            nextTier,
            isResellerOverride: isOverride
        };
    }

    /**
     * Process stock for order, dispatching to platform or owner-scoped stock
     *
     * @param {Object} ctx - Repository context
     * @param {Object} params
     * @param {boolean} params.isReseller - Whether this is a reseller order
     * @param {Object} params.variant - Variant document (with codeVariant)
     * @param {number} params.quantity - Quantity to order
     * @param {Object} params.productInfo - Product metadata for snapshot
     * @returns {Promise<Object>} - { dataStock, profit, totalProcessed, stockItems, productInfo }
     */
    async processOrderStock(ctx, { isReseller, variant, quantity, productInfo }) {
        if (isReseller) {
            return this.processStockForPlatform(variant.codeVariant, quantity, productInfo);
        }
        return this.processStockForItems(ctx, variant.codeVariant, quantity, productInfo);
    }

    /**
     * Re-add previously claimed stock items back to inventory.
     * Used as rollback when QRIS generation or transaction creation fails
     * after stock has already been atomically claimed via processOrderStock.
     * Idempotent — safe to call once per failed claim.
     */
    async restoreClaimedStock(ctx, { stockItems, isReseller }) {
        if (!Array.isArray(stockItems) || stockItems.length === 0) return;

        for (const item of stockItems) {
            try {
                if (isReseller) {
                    await stockRepository.addPlatformStock(
                        item.codeVariant,
                        item.dataStock,
                        item.profit || 0
                    );
                } else {
                    await stockRepository.addStock(
                        ctx.repositoryContext,
                        item.codeVariant,
                        item.dataStock,
                        item.profit || 0
                    );
                }
            } catch (restoreErr) {
                console.error('[ orderService.restoreClaimedStock ] Failed restoring item:', {
                    codeVariant: item.codeVariant,
                    error: restoreErr.message
                });
            }
        }
    }

    /**
     * Detect whether an error from processOrderStock indicates a stock shortage
     * (vs an unrelated infrastructure error). Used by callers to show a
     * user-friendly "out of stock" message instead of a generic error.
     */
    isStockUnavailableError(err) {
        if (!err || typeof err.message !== 'string') return false;
        const msg = err.message;
        return (
            msg.includes('No stock available') ||
            msg.includes('Insufficient stock') ||
            msg.includes('Stock race condition') ||
            msg.includes('Stok telah diambil pembeli lain')
        );
    }

    /**
     * Calculate transaction profit based on order type
     *
     * @param {Object} params
     * @param {boolean} params.isReseller - Whether this is a reseller order
     * @param {number} params.markupPerUnit - Markup per unit (reseller only)
     * @param {number} params.quantity - Order quantity
     * @param {number} params.stockProfit - Profit from stock (normal only)
     * @param {number} params.voucherDiscount - Voucher discount amount
     * @returns {number} - Calculated profit
     */
    calculateTransactionProfit({ isReseller, markupPerUnit, quantity, stockProfit, voucherDiscount }) {
        if (isReseller) {
            return Math.max(0, (markupPerUnit * quantity) - voucherDiscount);
        }
        return Math.max(0, parseInt(stockProfit) - voucherDiscount);
    }

    /**
     * Parse order details from message text
     * @param {string} messageText - Message text containing order details
     * @returns {Object} - Parsed order details
     */
    parseOrderFromMessage(messageText) {
        // Support both old box-style and new clean format
        const orderAmountMatch = messageText.match(/Jumlah(?:\s*Pesanan)?[:\s*┊・]*x?(\d+)/);
        const productMatch = messageText.match(/Produk[:\s*┊・]*(.+?)(?:\n)/);
        const variantNameMatch = messageText.match(/Varia(?:nt|si)[:\s*┊・]*(.+?)(?:\n)/);
        const priceMatch = messageText.match(/Harga(?:\s*satuan)?[:\s*┊・]*(?:Rp\s*)?([\d,.]+)/);
        const stockMatch = messageText.match(/Stok(?:\s*[Tt]ersedia)?[:\s*┊・]*(\d+)/);

        const orderAmount = orderAmountMatch ? parseInt(orderAmountMatch[1]) : null;
        const productName = productMatch ? productMatch[1].trim() : null;
        const variantName = variantNameMatch ? variantNameMatch[1].trim() : null;
        const price = priceMatch ? priceMatch[1].replace(/[.,]/g, '').trim() : null;
        const stockAvailable = stockMatch ? parseInt(stockMatch[1]) : null;

        return {
            orderAmount,
            productName,
            variantName,
            price: price ? parseInt(price) : null,
            stockAvailable
        };
    }

    /**
     * Get product and variant by names
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} productName - Product name
     * @param {string} variantName - Variant name
     * @returns {Promise<Object>} - { product, variant }
     */
    async getProductAndVariant(context, productName, variantName) {
        // Escape special regex characters
        const escapedProductName = productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedVariantName = variantName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        const product = await productRepository.findOne(context, {
            name: { $regex: new RegExp('^' + escapedProductName, 'i') }
        });

        if (!product) {
            throw new Error(`Product "${productName}" not found`);
        }

        const variant = await productVariantRepository.findOne(context, {
            name: { $regex: new RegExp('^' + escapedVariantName, 'i') },
            code: product.code
        });

        if (!variant) {
            throw new Error(`Variant "${variantName}" not found for product "${productName}"`);
        }

        return { product, variant };
    }

    /**
     * Get product and variant by codes (preferred — code lookups bypass
     * fragile name regex matching that breaks when two products share a
     * variant name, e.g. "HEAD 1 BULAN").
     */
    async getProductAndVariantByCode(context, productCode, variantCode) {
        if (!productCode || !variantCode) {
            throw new Error('productCode and variantCode are required');
        }

        const variant = await productVariantRepository.findByCodeVariant(context, variantCode);
        if (!variant) {
            throw new Error(`Variant code "${variantCode}" not found`);
        }

        const product = await productRepository.findByCode(context, productCode);
        if (!product) {
            throw new Error(`Product code "${productCode}" not found`);
        }

        return { product, variant };
    }

    /**
     * Check stock availability
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} codeVariant - Variant code
     * @returns {Promise<number>} - Available stock count
     */
    async getStockCount(context, codeVariant) {
        return await stockRepository.count(context, { codeVariant: codeVariant });
    }

    /**
     * Validate order before processing
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {Object} params - Validation parameters
     * @returns {Promise<Object>} - Validation result
     */
    async validateOrder(context, { variant, quantity }) {
        const availableStock = await this.getStockCount(context, variant.codeVariant);

        if (availableStock === 0) {
            return {
                valid: false,
                error: 'Out of stock'
            };
        }

        if (availableStock < quantity) {
            return {
                valid: false,
                error: `Insufficient stock. Available: ${availableStock}, Required: ${quantity}`
            };
        }

        return {
            valid: true,
            availableStock
        };
    }

    /**
     * Get voucher information for a user and calculate discount dynamically
     * Recalculates discount from (discountType, discountValue) on every call
     * to handle quantity changes correctly (fixes stale percentage discount bug)
     *
     * @param {number} userId - Telegram user ID
     * @param {number} subtotal - Order subtotal before discount
     * @param {Object|null} resellerContext - Reseller markup context for cap enforcement
     * @param {number} resellerContext.markupPerUnit - Markup per unit (effectivePrice - rolePrice)
     * @param {number} resellerContext.quantity - Order quantity
     * @returns {Object} - Voucher details and calculated amounts
     */
    async getVoucherDetails(userId, subtotal, resellerContext = null) {
        const userState = await voucherState.getUserVoucherState(userId);

        if (!userState || !userState.voucherCode) {
            return {
                voucherCode: null,
                voucherDiscount: 0,
                isCapped: false,
                subtotal,
                totalPrice: subtotal,
                hasVoucher: false
            };
        }

        let voucherDiscount = 0;
        let isCapped = false;
        const voucherCode = userState.voucherCode;

        // Dynamic calculation from type + value (not cached discountAmount)
        if (userState.discountType === 'percentage') {
            voucherDiscount = Math.floor((subtotal * userState.discountValue) / 100);
        } else {
            voucherDiscount = userState.discountValue || 0;
        }

        // Apply max_discount_amount cap if set
        if (userState.maxDiscountAmount && userState.maxDiscountAmount > 0) {
            voucherDiscount = Math.min(voucherDiscount, userState.maxDiscountAmount);
        }

        // Reseller cap: discount cannot exceed total markup
        if (resellerContext) {
            const maxDiscount = Math.max(0, resellerContext.markupPerUnit * resellerContext.quantity);
            isCapped = voucherDiscount > maxDiscount;
            voucherDiscount = Math.min(voucherDiscount, maxDiscount);
        }

        const totalPrice = Math.max(0, subtotal - voucherDiscount);

        return {
            voucherCode,
            voucherDiscount,
            isCapped,
            subtotal,
            totalPrice,
            hasVoucher: true
        };
    }

    /**
     * Calculate order totals with voucher and fees
     * @param {Object} params - Calculation parameters
     * @param {number} params.userId - Telegram user ID
     * @param {number} params.quantity - Order quantity
     * @param {number} params.unitPrice - Price per unit
     * @param {number} params.fee - Additional fee (optional)
     * @returns {Object} - Complete order calculation
     */
    async calculateOrderTotal({ userId, quantity, unitPrice, fee = 0, resellerContext = null }) {
        const baseSubtotal = quantity * unitPrice;
        const subtotal = baseSubtotal + fee;

        const voucherDetails = await this.getVoucherDetails(userId, subtotal, resellerContext);

        return {
            quantity,
            unitPrice,
            fee,
            baseSubtotal,
            subtotal,
            voucherCode: voucherDetails.voucherCode,
            voucherDiscount: voucherDetails.voucherDiscount,
            isCapped: voucherDetails.isCapped,
            totalPrice: voucherDetails.totalPrice,
            hasVoucher: voucherDetails.hasVoucher
        };
    }

    /**
     * Parse order amount from message text
     * Supports multiple formats to handle subtotal and total
     * @param {string} messageText - Message text containing order details
     * @returns {number|null} - Parsed order amount or null
     */
    parseOrderAmount(messageText) {
        if (!messageText) return null;

        // Try multiple patterns to find the order amount
        const patterns = [
            // Pattern 1: "Subtotal: Rp X.XXX" (when voucher is already applied)
            /Subtotal:\s*Rp\s*([\d.,]+)/i,
            // Pattern 2: "Total: Rp X.XXX" or "Total Pembayaran: Rp X.XXX" (with optional bold markers)
            /Total(?:\s*(?:Pembayaran|Bayar))?[:\s*]*Rp\s*([\d.,]+)/i,
            // Pattern 3: "Harga: Rp X.XXX" followed by quantity
            /Harga[:\s*]*(?:Rp\s*)?([\d.,]+)[\s\S]*?Jumlah(?:\s*Pesanan)?[:\s*]*x?(\d+)/i,
        ];

        for (const pattern of patterns) {
            const match = messageText.match(pattern);
            if (match) {
                // For pattern 3, calculate total (price * quantity)
                if (match[2]) {
                    const price = parseInt(match[1].replace(/\./g, '').replace(/,/g, ''));
                    const quantity = parseInt(match[2]);
                    return price * quantity;
                }

                // For pattern 1 & 2, just return the amount
                const amount = match[1].replace(/\./g, '').replace(/,/g, '');
                return parseInt(amount);
            }
        }

        return null;
    }

    /**
     * Consume stock items with race-condition protection
     * Shared between platform and owner-scoped stock processing
     *
     * @param {Array} stocks - Stock documents to consume
     * @param {Object} options - Strategy callbacks
     * @param {Function} options.deleteFn - (stock) => Promise<{deletedCount}> - deletes a stock item
     * @param {Function} options.rollbackFn - (item) => Promise - re-adds a consumed item on failure
     * @param {string} options.errorMessage - Error message for race condition failures
     * @returns {Promise<Object>} - { dataStock, profit, stockItems }
     * @private
     */
    async _consumeStockItems(stocks, { deleteFn, rollbackFn, errorMessage }) {
        let dataStock = "";
        let profit = 0;
        const stockItems = [];
        const consumed = [];

        for (const stock of stocks) {
            const deleteResult = await deleteFn(stock);
            if (deleteResult.deletedCount === 0) {
                for (const item of consumed) {
                    await rollbackFn(item);
                }
                throw new Error(errorMessage);
            }

            dataStock += `${stock.dataStock}\n`;
            profit += stock.profit || 0;

            stockItems.push({
                _id: stock._id,
                codeVariant: stock.codeVariant,
                dataStock: stock.dataStock,
                profit: stock.profit || 0,
                ownerId: stock.ownerId ?? null,
                expires_at: stock.expires_at ?? null,
                createdAt: stock.createdAt,
                updatedAt: stock.updatedAt
            });

            consumed.push({
                codeVariant: stock.codeVariant,
                dataStock: stock.dataStock,
                profit: stock.profit || 0
            });
        }

        return { dataStock: dataStock.trim(), profit: parseInt(profit) || 0, stockItems };
    }

    /**
     * Process PLATFORM stock for reseller orders (ownerId=null)
     * Uses direct model queries to bypass OwnerScoped isolation
     * Includes race-condition protection via deletedCount check
     *
     * @param {string} codeVariant - Platform variant code
     * @param {number} quantity - Quantity to order
     * @param {Object} productInfo - Product metadata for snapshot
     * @returns {Promise<Object>} - { dataStock, profit, totalProcessed, stockItems, productInfo }
     */
    async processStockForPlatform(codeVariant, quantity, productInfo = {}) {
        const availableCount = await stockRepository.countPlatformStock(codeVariant);

        if (availableCount === 0) {
            throw new Error('No stock available');
        }

        if (availableCount < quantity) {
            throw new Error(`Insufficient stock. Available: ${availableCount}, Required: ${quantity}`);
        }

        const stocks = await stockRepository.findPlatformStock(codeVariant, {
            sort: { createdAt: 1 },
            limit: quantity
        });

        const { dataStock, profit, stockItems } = await this._consumeStockItems(stocks, {
            deleteFn: (stock) => stockRepository.deletePlatformStockById(stock._id),
            rollbackFn: (item) => stockRepository.addPlatformStock(item.codeVariant, item.dataStock, item.profit),
            errorMessage: 'Stock race condition: item consumed by another buyer. Please retry.'
        });

        return { dataStock, profit, totalProcessed: stocks.length, stockItems, productInfo };
    }

    /**
     * Process stock for order with detailed item tracking (NEW)
     * Enhanced version of processStock() that returns structured data for OrderTransactionItem
     *
     * NOTE: dataStock is returned for legacy compatibility but should NOT be used for new transactions
     * New transactions should ONLY use stockItems array
     *
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} codeVariant - Variant code
     * @param {number} quantity - Quantity to order
     * @param {Object} productInfo - Product metadata for snapshot (optional)
     * @param {string} productInfo.productCode - Product code
     * @param {string} productInfo.productName - Product name
     * @param {string} productInfo.variantName - Variant name
     * @returns {Promise<Object>} - {dataStock (string - LEGACY), profit (number), totalProcessed (number), stockItems (array - USE THIS), productInfo (object)}
     */
    async processStockForItems(context, codeVariant, quantity, productInfo = {}) {
        // First, check if we have enough stock (count only, no data fetch)
        const availableCount = await stockRepository.count(context, { codeVariant: codeVariant });

        if (availableCount === 0) {
            throw new Error('No stock available');
        }

        if (availableCount < quantity) {
            throw new Error(`Insufficient stock. Available: ${availableCount}, Required: ${quantity}`);
        }

        // Fetch ONLY the quantity we need (FIFO - oldest first)
        const stocks = await stockRepository.find(
            context,
            { codeVariant: codeVariant },
            {
                sort: { createdAt: 1 },
                limit: quantity
            }
        );

        const { dataStock, profit, stockItems } = await this._consumeStockItems(stocks, {
            deleteFn: (stock) => stockRepository.deleteOne(context, { _id: stock._id }),
            rollbackFn: (item) => stockRepository.addStock(context, item.codeVariant, item.dataStock, item.profit),
            errorMessage: 'Stok telah diambil pembeli lain. Silakan coba lagi.'
        });

        return { dataStock, profit, totalProcessed: stocks.length, stockItems, productInfo };
    }
}

module.exports = new OrderService();
