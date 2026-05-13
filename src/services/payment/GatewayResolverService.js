const clc = require('cli-color');
const modeService = require('../modeService');
const paymentGatewayFactory = require('./PaymentGatewayFactory');
const encryptionService = require('../encryptionService');

const UserPaymentGateway = require('../../database/models/userPaymentGatewayModel');
const PaymentGateway = require('../../database/models/paymentGatewayModel');
const PaymentMethod = require('../../database/models/paymentMethodModel');

const LOG_PREFIX = clc.green.bold('[ GatewayResolver ]');

/**
 * GatewayResolverService
 *
 * Resolves the correct payment gateway, credentials, and fee configuration
 * for a given ownerId in MULTI mode. In SINGLE mode, always returns .env fallback.
 *
 * Always reads from DB for realtime config changes (no caching).
 *
 * Resolution chain:
 *   1. Check user_payment_gateways for ownerId
 *   2. If use_own_credentials: decrypt encrypted_credentials
 *   3. If platform credentials: read from payment_gateways.credentials
 *   4. Look up payment_methods for fee config and payment_method_code
 *   5. Fallback to .env at any failure point
 */
class GatewayResolverService {
    constructor() {
        this._pgEncryptionService = null;
    }

    /**
     * Get or create the encryption service for user payment gateway credentials
     * @returns {EncryptionService|null}
     * @private
     */
    _getPgEncryptionService() {
        if (this._pgEncryptionService) return this._pgEncryptionService;

        const key = process.env.USER_PG_ENCRYPTION_KEY;
        if (!key) {
            console.warn(LOG_PREFIX, 'USER_PG_ENCRYPTION_KEY not set, cannot decrypt user credentials');
            return null;
        }

        this._pgEncryptionService = encryptionService.createInstance(key, 'USER_PG_ENCRYPTION_KEY');
        return this._pgEncryptionService;
    }

    /**
     * Resolve payment gateway for a given owner
     * @param {string} ownerId - The owner ID (user_id in user_payment_gateways)
     * @returns {Promise<{gateway: BasePaymentGateway, feeConfig: Object|null, paymentMethodCode: string}>}
     */
    async resolveGateway(ownerId) {
        // SINGLE mode: always use .env
        if (modeService.isSingleMode()) {
            return this._createEnvFallback();
        }

        if (!ownerId) {
            return this._createEnvFallback();
        }


        try {
            return await this._resolveFromDb(ownerId);
        } catch (err) {
            console.error(LOG_PREFIX, `Error resolving gateway for owner ${ownerId}:`, err.message);
            return this._createEnvFallback();
        }
    }

    /**
     * Resolve gateway configuration from database
     * @param {string} ownerId
     * @returns {Promise<Object>}
     * @private
     */
    async _resolveFromDb(ownerId) {
        // Step 1: Find user's active payment gateway config
        const userGateway = await UserPaymentGateway.findOne({
            user_id: ownerId,
            is_active: true
        }).lean();

        if (!userGateway) {
            return this._createEnvFallback();
        }

        const gatewayType = userGateway.gateway_type;

        // Step 2: Resolve credentials
        const credentials = await this._resolveCredentials(userGateway, gatewayType, ownerId);

        if (!credentials) {
            console.warn(LOG_PREFIX, `No credentials available for owner ${ownerId}, falling back to .env for gateway type '${gatewayType}'`);
            return this._createEnvFallback(gatewayType);
        }

        // Step 3: Look up fee config from payment_methods
        const { feeConfig, paymentMethodCode } = await this._resolveFeeConfig(gatewayType, userGateway.use_own_credentials);

        // Step 4: Create gateway with credentials
        let gateway;
        try {
            gateway = paymentGatewayFactory.createGatewayWithCredentials(gatewayType, credentials);
        } catch (err) {
            console.error(LOG_PREFIX, `Failed to create gateway '${gatewayType}' for owner ${ownerId}:`, err.message);
            return this._createEnvFallback();
        }

        return { gateway, feeConfig, paymentMethodCode, useOwnCredentials: userGateway.use_own_credentials };
    }

    /**
     * Resolve credentials for a user gateway config
     * Fallback chain: user own credentials -> platform credentials -> null
     * @param {Object} userGateway - user_payment_gateways document
     * @param {string} gatewayType - e.g. 'linkqu'
     * @param {string} ownerId - for logging
     * @returns {Promise<Object|null>}
     * @private
     */
    async _resolveCredentials(userGateway, gatewayType, ownerId) {
        if (!userGateway.use_own_credentials || !userGateway.encrypted_credentials) {
            return await this._getPlatformCredentials(gatewayType);
        }

        const decrypted = this._decryptCredentials(userGateway.encrypted_credentials);
        if (decrypted) {
            return decrypted;
        }

        console.warn(LOG_PREFIX, `Failed to decrypt credentials for owner ${ownerId}, trying platform credentials`);
        return await this._getPlatformCredentials(gatewayType);
    }

    /**
     * Resolve fee config and payment method code from payment_gateways + payment_methods
     * @param {string} gatewayType - e.g. 'linkqu'
     * @param {boolean} useOwnCredentials - whether user uses own credentials
     * @returns {Promise<{feeConfig: Object|null, paymentMethodCode: string}>}
     * @private
     */
    async _resolveFeeConfig(gatewayType, useOwnCredentials) {
        const platformGateway = await PaymentGateway.findOne({
            gateway_type: gatewayType,
            is_active: true
        }).lean();

        if (!platformGateway) {
            return { feeConfig: null, paymentMethodCode: 'qris' };
        }

        const paymentMethod = await PaymentMethod.findOne({
            payment_gateway_slug: platformGateway.slug,
            method_type: 'qris',
            is_active: true
        }).lean();

        if (!paymentMethod) {
            return { feeConfig: null, paymentMethodCode: 'qris' };
        }

        const paymentMethodCode = paymentMethod.code || 'qris';
        const feeConfig = this._buildFeeConfig(paymentMethod, useOwnCredentials);

        return { feeConfig, paymentMethodCode };
    }

    /**
     * Build fee config object from payment method document
     * @param {Object} paymentMethod - payment_methods document
     * @param {boolean} useOwnCredentials
     * @returns {Object}
     * @private
     */
    _buildFeeConfig(paymentMethod, useOwnCredentials) {
        const minAmount = paymentMethod.min_amount ?? null;
        const maxAmount = paymentMethod.max_amount ?? null;

        // Own credentials = fee from .env (fee: null signals _computeFee to use gateway defaults)
        if (useOwnCredentials) {
            return { fee: null, feeType: null, feeFixed: null, minAmount, maxAmount };
        }

        // Priority: user_processing_fee > processing_fee
        // != null covers null & undefined, but NOT 0 (0 = free)
        const hasUserFee = paymentMethod.user_processing_fee != null;
        const fee = hasUserFee
            ? paymentMethod.user_processing_fee
            : (paymentMethod.processing_fee ?? 0);
        const feeType = hasUserFee
            ? (paymentMethod.user_processing_fee_type || 'fixed')
            : (paymentMethod.processing_fee_type || 'percentage');
        const feeFixed = hasUserFee
            ? (paymentMethod.user_processing_fee_fixed || 0)
            : (paymentMethod.processing_fee_fixed || 0);

        return { fee, feeType, feeFixed, minAmount, maxAmount };
    }

    /**
     * Get platform credentials from payment_gateways collection
     * @param {string} gatewayType
     * @returns {Promise<Object|null>}
     * @private
     */
    async _getPlatformCredentials(gatewayType) {
        try {
            const platformGateway = await PaymentGateway.findOne({
                gateway_type: gatewayType,
                is_active: true
            }).lean();

            const creds = platformGateway?.credentials;
            if (!creds) return null;

            // koalabotbe may store credentials as a JSON string instead of an embedded object
            if (typeof creds === 'string') {
                try {
                    return JSON.parse(creds);
                } catch {
                    console.error(LOG_PREFIX, `Failed to parse credentials JSON string for ${gatewayType}`);
                    return null;
                }
            }

            return creds;
        } catch (err) {
            console.error(LOG_PREFIX, `Error fetching platform credentials for ${gatewayType}:`, err.message);
            return null;
        }
    }

    /**
     * Decrypt user credentials
     * @param {string} encryptedCredentials
     * @returns {Object|null} - Parsed credentials object or null on failure
     * @private
     */
    _decryptCredentials(encryptedCredentials) {
        try {
            const pgEncryption = this._getPgEncryptionService();
            if (!pgEncryption) return null;

            const decrypted = pgEncryption.decrypt(encryptedCredentials);
            return JSON.parse(decrypted);
        } catch (err) {
            console.error(LOG_PREFIX, 'Failed to decrypt user credentials:', err.message);
            return null;
        }
    }

    /**
     * Create .env fallback result using env credentials for the specified gateway type.
     * If gatewayType is provided and registered, instantiates that specific gateway from .env.
     * Falls back to DEFAULT_PAYMENT_GATEWAY if type is unknown or instantiation fails.
     * @param {string|null} [gatewayType] - e.g. 'tokopay', 'linkqu'
     * @returns {{gateway: BasePaymentGateway, feeConfig: null, paymentMethodCode: string, useOwnCredentials: boolean}}
     * @private
     */
    _createEnvFallback(gatewayType = null) {
        let gateway;
        if (gatewayType && paymentGatewayFactory.hasGateway(gatewayType)) {
            try {
                gateway = paymentGatewayFactory.createGateway(gatewayType);
            } catch (err) {
                console.warn(LOG_PREFIX, `Failed to create env fallback for type '${gatewayType}', using default:`, err.message);
                gateway = paymentGatewayFactory.createGateway();
            }
        } else {
            gateway = paymentGatewayFactory.createGateway();
        }
        return {
            gateway,
            feeConfig: null,
            paymentMethodCode: gateway.getPaymentMethodCode(),
            useOwnCredentials: false
        };
    }
}

module.exports = new GatewayResolverService();
