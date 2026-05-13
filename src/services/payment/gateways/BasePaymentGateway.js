/**
 * Base Payment Gateway Abstract Class
 * All payment gateways must extend this class and implement the required methods
 */
class BasePaymentGateway {
  constructor(name) {
    if (this.constructor === BasePaymentGateway) {
      throw new Error('BasePaymentGateway is an abstract class and cannot be instantiated directly');
    }
    this.name = name;
  }

  /**
   * Create a QRIS payment and generate QR code image
   * @param {Object} params - Payment parameters
   * @param {number} params.amount - Payment amount
   * @param {string} params.referenceId - Unique transaction reference ID
   * @param {string} params.customerId - Customer ID (telegram user id)
   * @param {string} params.customerName - Customer name
   * @param {string} [params.customerPhone] - Customer phone number
   * @param {string} [params.customerEmail] - Customer email
   * @param {Object} [params.qrOptions] - QR code styling options
   * @param {Object} [params.ctx] - Telegraf context (optional, for multi-mode support)
   * @returns {Promise<{imageBuffer: Buffer, expired: string, raw: any}>}
   */
  async createQRIS(params) {
    throw new Error('Method createQRIS() must be implemented by subclass');
  }

  /**
   * Check payment status for a transaction
   * @param {Object} params - Check parameters
   * @param {string} params.referenceId - Transaction reference ID
   * @param {number} params.amount - Expected payment amount
   * @returns {Promise<{success: boolean, amount?: number, date?: string}>}
   */
  async checkPaymentStatus(params) {
    throw new Error('Method checkPaymentStatus() must be implemented by subclass');
  }

  /**
   * Validate gateway configuration
   * @returns {boolean} - True if configuration is valid
   * @throws {Error} - If configuration is invalid
   */
  validateConfig() {
    throw new Error('Method validateConfig() must be implemented by subclass');
  }

  /**
   * Set custom credentials on the gateway instance (for dynamic per-owner gateways)
   * @param {Object} credentials - Credential key-value pairs
   */
  setCredentials(credentials) {
    this._customCredentials = credentials;
    this._applyCredentials(credentials);
  }

  /**
   * Apply custom credentials to gateway-specific properties.
   * Subclasses should override this to map credential keys to their instance properties.
   * @param {Object} credentials - Credential key-value pairs
   * @protected
   */
  _applyCredentials(credentials) {
    // Subclasses override
  }

  /**
   * Get gateway name
   * @returns {string} - Gateway name
   */
  getName() {
    return this.name;
  }

  /**
   * Get transaction fee percentage (optional, default 0)
   * @returns {number} - Fee percentage (0.017 = 1.7%)
   */
  getFeePercentage() {
    return 0;
  }

  /**
   * Get fixed fee component (used for combined fee gateways like Tripay QRIS)
   * @returns {number} - Fixed fee amount in Rupiah (0 = no fixed component)
   */
  getFeeFixed() {
    return 0;
  }

  /**
   * Calculate total amount with fee
   * @param {number} baseAmount - Base amount before fee
   * @returns {number} - Total amount including fee
   */
  calculateTotalWithFee(baseAmount) {
    const feePercentage = this.getFeePercentage();
    const fee = Math.ceil(baseAmount * feePercentage);
    return baseAmount + fee;
  }

  /**
   * Get payment method code for transaction records
   * This is used to identify which payment method was used in the transaction
   * @returns {string} - Payment method code (e.g., 'qris', 'qris-linkqu', 'qris-tokopay')
   */
  getPaymentMethodCode() {
    return 'qris'; // Default, should be overridden by subclass if needed
  }
}

module.exports = BasePaymentGateway;
