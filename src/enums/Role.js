/**
 * Role Enum
 * Defines user roles for bot owners with different pricing tiers
 *
 * Priority order (highest to lowest): Provider > Connector > Explorer
 * - Provider: Highest tier with best pricing
 * - Connector: Mid tier
 * - Explorer: Default tier for new users
 * - Admin: Administrative role (not used for pricing)
 */
const Role = Object.freeze({
    ADMIN: 'Admin',
    EXPLORER: 'Explorer',
    CONNECTOR: 'Connector',
    PROVIDER: 'Provider',

    /**
     * Get the default role for new users
     * @returns {string} Default role name
     */
    getDefault() {
        return this.EXPLORER;
    },

    /**
     * Get all valid role values
     * @returns {string[]} Array of role names
     */
    values() {
        return [this.ADMIN, this.EXPLORER, this.CONNECTOR, this.PROVIDER];
    },

    /**
     * Get pricing roles only (excludes Admin)
     * @returns {string[]} Array of pricing role names
     */
    getPricingRoles() {
        return [this.EXPLORER, this.CONNECTOR, this.PROVIDER];
    },

    /**
     * Get role priority (higher number = higher tier)
     * @param {string} role - Role name
     * @returns {number} Priority value
     */
    getPriority(role) {
        const priorities = {
            [this.EXPLORER]: 1,
            [this.CONNECTOR]: 2,
            [this.PROVIDER]: 3,
            [this.ADMIN]: 0
        };
        return priorities[role] || 0;
    }
});

module.exports = Role;
