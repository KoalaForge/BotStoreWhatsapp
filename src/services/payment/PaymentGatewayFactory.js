const LinkQuGateway = require('./gateways/LinkQuGateway');
const TokopayGateway = require('./gateways/TokopayGateway');
const TripayGateway = require('./gateways/TripayGateway');
const PakasirGateway = require('./gateways/PakasirGateway');
const OrderKuotaGateway = require('./gateways/OrderKuotaGateway');
const QrispyGateway = require('./gateways/QrispyGateway');
const BelibayarGateway = require('./gateways/BelibayarGateway');

/**
 * Payment Gateway Factory
 * Creates and manages payment gateway instances based on configuration
 */
class PaymentGatewayFactory {
  constructor() {
    this.gateways = new Map();
    this.defaultGateway = null;
    this._initializeGateways();
  }

  /**
   * Initialize and register all available payment gateways
   * @private
   */
  _initializeGateways() {
    // Register available gateways
    this.registerGateway('linkqu', LinkQuGateway);
    this.registerGateway('tokopay', TokopayGateway);
    this.registerGateway('tripay', TripayGateway);
    this.registerGateway('pakasir', PakasirGateway);
    this.registerGateway('orderkuota', OrderKuotaGateway);
    this.registerGateway('qrispy', QrispyGateway);
    this.registerGateway('belibayar', BelibayarGateway);

    // Set default gateway from environment or fallback to 'linkqu'
    const defaultGatewayName = (process.env.DEFAULT_PAYMENT_GATEWAY || 'linkqu').toLowerCase();
    this.setDefaultGateway(defaultGatewayName);
  }

  /**
   * Register a payment gateway
   * @param {string} name - Gateway identifier (lowercase)
   * @param {Class} GatewayClass - Gateway class (must extend BasePaymentGateway)
   */
  registerGateway(name, GatewayClass) {
    this.gateways.set(name.toLowerCase(), GatewayClass);
  }

  /**
   * Set the default payment gateway
   * @param {string} gatewayName - Gateway name to set as default
   * @throws {Error} if gateway is not registered
   */
  setDefaultGateway(gatewayName) {
    const name = gatewayName.toLowerCase();
    if (!this.gateways.has(name)) {
      throw new Error(`Payment gateway '${gatewayName}' is not registered. Available: ${Array.from(this.gateways.keys()).join(', ')}`);
    }
    this.defaultGateway = name;
  }

  /**
   * Get default payment gateway name
   * @returns {string}
   */
  getDefaultGatewayName() {
    return this.defaultGateway;
  }

  /**
   * Create a gateway instance
   * @param {string} [gatewayName] - Gateway name, uses default if not specified
   * @returns {BasePaymentGateway} - Gateway instance
   * @throws {Error} if gateway is not found or configuration is invalid
   */
  createGateway(gatewayName = null) {
    const name = (gatewayName || this.defaultGateway).toLowerCase();

    if (!this.gateways.has(name)) {
      throw new Error(`Payment gateway '${gatewayName}' not found. Available: ${Array.from(this.gateways.keys()).join(', ')}`);
    }

    const GatewayClass = this.gateways.get(name);
    const gateway = new GatewayClass();

    // Validate configuration on creation
    try {
      gateway.validateConfig();
    } catch (error) {
      throw new Error(`Failed to initialize ${gateway.getName()} gateway: ${error.message}`);
    }

    return gateway;
  }

  /**
   * Create a gateway instance with custom credentials injected
   * Used by GatewayResolverService for per-owner dynamic gateways
   * @param {string} gatewayType - Gateway type (e.g., 'linkqu', 'tokopay')
   * @param {Object} credentials - Credential key-value pairs to inject
   * @returns {BasePaymentGateway} - Gateway instance with credentials applied
   * @throws {Error} if gateway type not found or validation fails
   */
  createGatewayWithCredentials(gatewayType, credentials) {
    const name = gatewayType.toLowerCase();

    if (!this.gateways.has(name)) {
      throw new Error(`Payment gateway '${gatewayType}' not found. Available: ${Array.from(this.gateways.keys()).join(', ')}`);
    }

    const GatewayClass = this.gateways.get(name);
    const gateway = new GatewayClass();

    // Inject custom credentials
    gateway.setCredentials(credentials);

    // Re-validate with new credentials
    gateway.validateConfig();

    return gateway;
  }

  /**
   * Get list of all registered gateway names
   * @returns {string[]}
   */
  getAvailableGateways() {
    return Array.from(this.gateways.keys());
  }

  /**
   * Check if a gateway is registered
   * @param {string} gatewayName - Gateway name to check
   * @returns {boolean}
   */
  hasGateway(gatewayName) {
    return this.gateways.has(gatewayName.toLowerCase());
  }
}

// Export singleton instance
module.exports = new PaymentGatewayFactory();
