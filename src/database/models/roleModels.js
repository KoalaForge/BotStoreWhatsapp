const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Role Model
 * Shared collection with Laravel (Spatie Permission package)
 *
 * This model is READ-ONLY from the bot's perspective.
 * Roles are managed through Laravel admin panel.
 *
 * Collection: 'roles'
 * Structure follows Laravel/Spatie format with model_has_roles embedded
 */
const roleSchema = new Schema({
    name: {
        type: String,
        required: true
    },
    guard_name: {
        type: String,
        default: 'web'
    },
    // Embedded array of model-role relationships
    // Laravel stores this separately, but for query efficiency we embed it
    model_has_roles: [{
        model_id: {
            type: String,  // User._id reference (ObjectId as string)
            required: true
        },
        model_type: {
            type: String,  // 'App\\Models\\User'
            default: 'App\\Models\\User'
        }
    }],
    created_at: {
        type: Date,
        default: Date.now
    },
    updated_at: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: false, // Laravel manages timestamps differently
    collection: 'roles'
});

// Index for efficient role lookup by model_id
roleSchema.index({ 'model_has_roles.model_id': 1 });
roleSchema.index({ name: 1 });

module.exports = mongoose.model('Role', roleSchema, 'roles');
