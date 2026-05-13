const mongoose = require('mongoose');
const { Schema } = mongoose;

const stockVariantsSchema = new Schema({
    codeVariant: {
        type: String,
        required: true
    },
    dataStock: {
        type: String,
        required: true
    },
    profit: {
        type: Number,
        required: true
    },
    // Owner isolation for MULTI mode
    ownerId: {
        type: String,
        required: false,
        index: true,
        default: null
    },
    expires_at: {
        type: Date,
        default: null
        // Kapan credentials ini tidak bisa digunakan lagi.
        // Wajib diisi jika variant is_cyclable = true.
        // Digunakan backend untuk chain-break check saat cycle.
    }
}, {
    timestamps: true
});

// Compound index for efficient queries in MULTI mode
stockVariantsSchema.index({ ownerId: 1, codeVariant: 1 });

module.exports = mongoose.model('Stock_Data_Variants', stockVariantsSchema, "stock_data_variants");