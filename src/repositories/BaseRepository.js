const modeService = require('../services/modeService');
const IsolationStrategy = require('./IsolationStrategy');

/**
 * Base Repository
 * Abstract base class for all repositories with automatic filtering
 *
 * Responsibilities:
 * - Provide common CRUD operations
 * - Auto-inject botId/ownerId filters based on isolation strategy
 * - Mode-aware query building
 * - Error handling
 *
 * Isolation Strategies:
 * - IsolationStrategy.OwnerScoped: Filter by ownerId (products, variants, stock)
 * - IsolationStrategy.BotScoped: Filter by botId (admins, broadcast, balance, voucher)
 * - IsolationStrategy.DualScoped: Filter by both (transactions)
 * - IsolationStrategy.None: No filtering (SINGLE mode or shared data)
 */
class BaseRepository {
    /**
     * @param {Model} model - Mongoose model
     * @param {Symbol} isolationStrategy - Use IsolationStrategy constants (OwnerScoped, BotScoped, DualScoped, None)
     * @param {Object} options - Repository options
     * @param {Array<string>} options.caseInsensitiveFields - Fields to normalize to lowercase for case-insensitive matching
     */
    constructor(model, isolationStrategy = IsolationStrategy.None, options = {}) {
        if (!model) {
            throw new Error('[BaseRepository] model is required');
        }

        this.model = model;
        // Support both old strings and new Symbols during migration
        this.isolationStrategy = IsolationStrategy.fromString(isolationStrategy);
        this.modelName = model.modelName || model.collection.name;

        // Case-insensitive fields configuration
        this.caseInsensitiveFields = options.caseInsensitiveFields || [];

        // Validate strategy
        if (!IsolationStrategy.isValid(this.isolationStrategy)) {
            throw new Error(
                `[${this.modelName}Repository] Invalid isolation strategy: ${isolationStrategy}`
            );
        }
    }

    // ============================================
    // CASE-INSENSITIVE FIELD NORMALIZATION
    // ============================================

    /**
     * Normalize a value to lowercase if it's a string
     * @param {*} value - Value to normalize
     * @returns {*} - Normalized value (lowercase if string)
     * @private
     */
    _normalizeValue(value) {
        return value?.toLowerCase?.() ?? value;
    }

    /**
     * Normalize case-insensitive fields in a filter object
     * @param {Object} filter - Query filter
     * @returns {Object} - Filter with normalized case-insensitive fields
     * @private
     */
    _normalizeFilter(filter) {
        if (!this.caseInsensitiveFields.length || !filter) return filter;

        const normalized = { ...filter };
        for (const field of this.caseInsensitiveFields) {
            if (normalized[field] !== undefined) {
                normalized[field] = this._normalizeValue(normalized[field]);
            }
        }
        return normalized;
    }

    /**
     * Normalize case-insensitive fields in a data object (for create/update)
     * @param {Object} data - Data to normalize
     * @returns {Object} - Data with normalized case-insensitive fields
     * @private
     */
    _normalizeData(data) {
        if (!this.caseInsensitiveFields.length || !data) return data;

        const normalized = { ...data };
        for (const field of this.caseInsensitiveFields) {
            if (normalized[field] !== undefined) {
                normalized[field] = this._normalizeValue(normalized[field]);
            }
        }
        return normalized;
    }

    /**
     * Ensure we have a valid context object
     * Accepts three input types:
     * 1. Direct context object { botId, ownerId, mode } - for background jobs
     * 2. Telegraf ctx with ctx.repositoryContext (from middleware) - recommended
     * 3. Telegraf ctx without repositoryContext (will extract it) - fallback
     *
     * @param {Object} ctxOrContext - Telegraf context or repository context
     * @returns {Promise<Object>} - Repository context { botId, ownerId, mode }
     * @private
     */
    async _ensureContext(ctxOrContext) {
        // Already a repository context object (has botId, ownerId, or mode)
        if (ctxOrContext && (
            ctxOrContext.hasOwnProperty('botId') ||
            ctxOrContext.hasOwnProperty('ownerId') ||
            ctxOrContext.hasOwnProperty('mode')
        )) {
            return ctxOrContext;
        }

        // Telegraf ctx with repositoryContext (from middleware)
        if (ctxOrContext && ctxOrContext.repositoryContext) {
            return ctxOrContext.repositoryContext;
        }

        // Telegraf ctx without repositoryContext - extract it
        if (ctxOrContext) {
            const repositoryContext = require('../services/repositoryContext');
            return await repositoryContext.extractContext(ctxOrContext);
        }

        // Fallback to empty context (will be handled by _buildFilter)
        return {};
    }

    /**
     * Build query filter based on context and isolation strategy
     * @param {Object} context - { botId, ownerId, mode }
     * @param {Object} additionalFilters - Custom filters to merge
     * @returns {Object} - MongoDB query filter
     * @private
     */
    _buildFilter(context, additionalFilters = {}) {
        // Normalize case-insensitive fields first
        const normalizedFilters = this._normalizeFilter(additionalFilters);
        const filter = { ...normalizedFilters };

        // SINGLE mode: Explicitly filter OUT records that belong to specific bots/owners
        // This ensures SINGLE mode only sees "legacy" unscoped data (botId=null, ownerId=null)
        // and doesn't see MULTI mode data in shared databases
        if (modeService.isSingleMode()) {
            switch (this.isolationStrategy) {
                case IsolationStrategy.BotScoped:
                    // Only show records without botId (legacy SINGLE mode data)
                    filter.botId = null;
                    break;

                case IsolationStrategy.OwnerScoped:
                    // Only show records without ownerId
                    filter.ownerId = null;
                    break;

                case IsolationStrategy.DualScoped:
                    // Only show records without both botId and ownerId
                    filter.botId = null;
                    filter.ownerId = null;
                    break;

                case IsolationStrategy.None:
                    // No filtering needed
                    break;
            }
            return filter;
        }

        // MULTI mode: Apply isolation
        const { botId, ownerId } = context;

        // Use Symbol comparison instead of string comparison
        switch (this.isolationStrategy) {
            case IsolationStrategy.OwnerScoped:
                if (!ownerId) {
                    throw new Error(
                        `[${this.modelName}Repository] ownerId is required for ${IsolationStrategy.getName(this.isolationStrategy)} in MULTI mode`
                    );
                }
                filter.ownerId = ownerId;
                break;

            case IsolationStrategy.BotScoped:
                if (!botId) {
                    throw new Error(
                        `[${this.modelName}Repository] botId is required for ${IsolationStrategy.getName(this.isolationStrategy)} in MULTI mode`
                    );
                }
                filter.botId = botId;
                break;

            case IsolationStrategy.DualScoped:
                if (!botId || !ownerId) {
                    throw new Error(
                        `[${this.modelName}Repository] Both botId and ownerId are required for ${IsolationStrategy.getName(this.isolationStrategy)} in MULTI mode`
                    );
                }
                filter.botId = botId;
                filter.ownerId = ownerId;
                break;

            case IsolationStrategy.None:
                // No filtering
                break;

            default:
                throw new Error(
                    `[${this.modelName}Repository] Invalid isolation strategy: ${IsolationStrategy.getName(this.isolationStrategy)}`
                );
        }

        return filter;
    }

    /**
     * Build data object for create/update with context fields
     * @param {Object} context - { botId, ownerId, mode }
     * @param {Object} data - Data to save
     * @returns {Object} - Data with context fields injected
     * @private
     */
    _buildData(context, data = {}) {
        // Normalize case-insensitive fields first
        const normalizedData = this._normalizeData(data);
        const result = { ...normalizedData };

        // SINGLE mode: No context injection
        if (modeService.isSingleMode()) {
            return result;
        }

        // MULTI mode: Inject context fields
        const { botId, ownerId } = context;

        // Use Symbol comparison instead of string comparison
        switch (this.isolationStrategy) {
            case IsolationStrategy.OwnerScoped:
                result.ownerId = ownerId;
                break;

            case IsolationStrategy.BotScoped:
                result.botId = botId;
                break;

            case IsolationStrategy.DualScoped:
                result.botId = botId;
                result.ownerId = ownerId;
                break;

            case IsolationStrategy.None:
                // No injection
                break;
        }

        return result;
    }

    // ============================================
    // COMMON CRUD OPERATIONS
    // ============================================

    /**
     * Create new document
     * @param {Object} ctxOrContext - Telegraf ctx or repository context
     * @param {Object} data - Document data
     * @returns {Promise<Object>} - Created document
     */
    async create(ctxOrContext, data) {
        const context = await this._ensureContext(ctxOrContext);
        const dataWithContext = this._buildData(context, data);
        const document = new this.model(dataWithContext);
        return await document.save();
    }

    /**
     * Find one document
     * @param {Object} ctxOrContext - Telegraf ctx or repository context
     * @param {Object} filter - Query filter
     * @param {Object} options - Query options (select, populate, etc.)
     * @returns {Promise<Object|null>} - Document or null
     */
    async findOne(ctxOrContext, filter = {}, options = {}) {
        const context = await this._ensureContext(ctxOrContext);
        const finalFilter = this._buildFilter(context, filter);

        let query = this.model.findOne(finalFilter);

        if (options.select) query = query.select(options.select);
        if (options.populate) query = query.populate(options.populate);
        if (options.sort) query = query.sort(options.sort);
        if (options.lean !== false) query = query.lean();

        return await query.exec();
    }

    /**
     * Find multiple documents
     * @param {Object} ctxOrContext - Telegraf ctx or repository context
     * @param {Object} filter - Query filter
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of documents
     */
    async find(ctxOrContext, filter = {}, options = {}) {
        const context = await this._ensureContext(ctxOrContext);
        const finalFilter = this._buildFilter(context, filter);

        let query = this.model.find(finalFilter);

        if (options.select) query = query.select(options.select);
        if (options.populate) query = query.populate(options.populate);
        if (options.sort) query = query.sort(options.sort);
        if (options.limit) query = query.limit(options.limit);
        if (options.skip) query = query.skip(options.skip);
        if (options.lean !== false) query = query.lean();

        return await query.exec();
    }

    /**
     * Find ALL documents without isolation filtering (for background jobs)
     * WARNING: This bypasses multi-tenancy isolation - use ONLY in background jobs
     * that need to process records across all bots/owners
     * @param {Object} filter - Query filter (no context filtering applied)
     * @param {Object} options - Query options
     * @returns {Promise<Array>} - Array of documents across all contexts
     */
    async findAllUnscoped(filter = {}, options = {}) {
        let query = this.model.find(filter);

        if (options.select) query = query.select(options.select);
        if (options.populate) query = query.populate(options.populate);
        if (options.sort) query = query.sort(options.sort);
        if (options.limit) query = query.limit(options.limit);
        if (options.skip) query = query.skip(options.skip);
        if (options.lean !== false) query = query.lean();

        return await query.exec();
    }

    /**
     * Update one document without isolation filtering (for background jobs)
     * WARNING: This bypasses multi-tenancy isolation - use ONLY in background jobs
     * that need to update records across all bots/owners (e.g., owner top-up with ownerId=null)
     * @param {Object} filter - Query filter (no context filtering applied)
     * @param {Object} update - Update operations
     * @param {Object} options - Update options
     * @returns {Promise<Object>} - Update result
     */
    async updateOneUnscoped(filter, update, options = {}) {
        return await this.model.updateOne(filter, update, options);
    }

    /**
     * Count documents
     * @param {Object} ctxOrContext - Telegraf ctx or repository context
     * @param {Object} filter - Query filter
     * @returns {Promise<number>} - Document count
     */
    async count(ctxOrContext, filter = {}) {
        const context = await this._ensureContext(ctxOrContext);
        const finalFilter = this._buildFilter(context, filter);
        return await this.model.countDocuments(finalFilter);
    }

    /**
     * Update one document
     * @param {Object} ctxOrContext - Telegraf ctx or repository context
     * @param {Object} filter - Query filter
     * @param {Object} update - Update operations
     * @param {Object} options - Update options
     * @returns {Promise<Object>} - Update result
     */
    async updateOne(ctxOrContext, filter, update, options = {}) {
        const context = await this._ensureContext(ctxOrContext);
        const finalFilter = this._buildFilter(context, filter);
        return await this.model.updateOne(finalFilter, update, options);
    }

    /**
     * Update multiple documents
     * @param {Object} ctxOrContext - Telegraf ctx or repository context
     * @param {Object} filter - Query filter
     * @param {Object} update - Update operations
     * @param {Object} options - Update options
     * @returns {Promise<Object>} - Update result
     */
    async updateMany(ctxOrContext, filter, update, options = {}) {
        const context = await this._ensureContext(ctxOrContext);
        const finalFilter = this._buildFilter(context, filter);
        return await this.model.updateMany(finalFilter, update, options);
    }

    /**
     * Find one and update
     * @param {Object} ctxOrContext - Telegraf ctx or repository context
     * @param {Object} filter - Query filter
     * @param {Object} update - Update operations
     * @param {Object} options - Update options
     * @returns {Promise<Object|null>} - Updated document
     */
    async findOneAndUpdate(ctxOrContext, filter, update, options = {}) {
        const context = await this._ensureContext(ctxOrContext);
        const finalFilter = this._buildFilter(context, filter);
        const defaultOptions = { new: true, ...options };
        return await this.model.findOneAndUpdate(finalFilter, update, defaultOptions);
    }

    /**
     * Delete one document
     * @param {Object} ctxOrContext - Telegraf ctx or repository context
     * @param {Object} filter - Query filter
     * @returns {Promise<Object>} - Delete result
     */
    async deleteOne(ctxOrContext, filter) {
        const context = await this._ensureContext(ctxOrContext);
        const finalFilter = this._buildFilter(context, filter);
        return await this.model.deleteOne(finalFilter);
    }

    /**
     * Delete multiple documents
     * @param {Object} ctxOrContext - Telegraf ctx or repository context
     * @param {Object} filter - Query filter
     * @returns {Promise<Object>} - Delete result
     */
    async deleteMany(ctxOrContext, filter) {
        const context = await this._ensureContext(ctxOrContext);
        const finalFilter = this._buildFilter(context, filter);
        return await this.model.deleteMany(finalFilter);
    }

    /**
     * Aggregate query
     * @param {Object} ctxOrContext - Telegraf ctx or repository context
     * @param {Array} pipeline - Aggregation pipeline
     * @returns {Promise<Array>} - Aggregation results
     */
    async aggregate(ctxOrContext, pipeline = []) {
        const context = await this._ensureContext(ctxOrContext);
        // Inject $match stage at the beginning with context filter
        const contextFilter = this._buildFilter(context, {});

        // Only add $match if there are filters
        if (Object.keys(contextFilter).length > 0) {
            pipeline = [{ $match: contextFilter }, ...pipeline];
        }

        return await this.model.aggregate(pipeline);
    }

    /**
     * Check if document exists
     * @param {Object} ctxOrContext - Telegraf ctx or repository context
     * @param {Object} filter - Query filter
     * @returns {Promise<boolean>} - True if exists
     */
    async exists(ctxOrContext, filter = {}) {
        const count = await this.count(ctxOrContext, filter);
        return count > 0;
    }
}

module.exports = BaseRepository;
