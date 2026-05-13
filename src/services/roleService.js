const RoleModel = require('../database/models/roleModels');
const Role = require('../enums/Role');

/**
 * Role Service
 * Handles role lookup for bot owners
 *
 * Responsibility:
 * - Query roles collection to find user's role
 * - REALTIME: No caching - role changes take effect immediately
 * - Handle priority when user has multiple roles
 * - Return default role (Explorer) when not found
 */
class RoleService {
    constructor() {
        // Cache disabled for realtime role changes
        this._roleCache = new Map();
        this._CACHE_TTL = 0; // Disabled - always query database
    }

    /**
     * Get user's role by ownerId (REALTIME - no cache)
     * @param {string} ownerId - User's MongoDB ObjectId as string
     * @returns {Promise<string>} - Role name (Explorer, Connector, or Provider)
     */
    async getUserRole(ownerId) {
        if (!ownerId) {
            return Role.getDefault();
        }

        // Cache is disabled (_CACHE_TTL = 0), always query database
        // This ensures role changes take effect immediately
        const roleName = await this._fetchRoleFromDb(ownerId);

        return roleName;
    }

    /**
     * Fetch role from database with priority handling
     * @param {string} ownerId - User's MongoDB ObjectId as string
     * @returns {Promise<string>} - Role name
     * @private
     */
    async _fetchRoleFromDb(ownerId) {
        try {
            // Find all roles that contain this user in model_has_roles
            const roles = await RoleModel.find({
                'model_has_roles.model_id': ownerId,
                name: { $in: Role.getPricingRoles() }
            }).select('name').lean();

            if (!roles || roles.length === 0) {
                return Role.getDefault();
            }

            // If user has multiple roles, return the highest priority one
            // Priority: Provider > Connector > Explorer
            let highestRole = Role.getDefault();
            let highestPriority = Role.getPriority(highestRole);

            for (const role of roles) {
                const priority = Role.getPriority(role.name);
                if (priority > highestPriority) {
                    highestPriority = priority;
                    highestRole = role.name;
                }
            }

            return highestRole;
        } catch (err) {
            console.error(`[RoleService] Error fetching role for ownerId ${ownerId}:`, err.message);
            return Role.getDefault();
        }
    }

    /**
     * Clear cache for specific ownerId or all
     * @param {string|null} ownerId - Specific ownerId to clear, or null to clear all
     */
    clearCache(ownerId = null) {
        if (ownerId) {
            this._roleCache.delete(ownerId);
        } else {
            this._roleCache.clear();
        }
    }

    /**
     * Get cache statistics (for debugging/monitoring)
     * @returns {Object} - Cache stats
     */
    getCacheStats() {
        return {
            size: this._roleCache.size,
            ttl: this._CACHE_TTL
        };
    }
}

// Export singleton instance
module.exports = new RoleService();
