const mongoose = require('mongoose');
const { Schema } = mongoose;

const AdminSchema = new Schema({
    idTelegram: {
        type: String,
        required: false,
    },
    idWhatsapp: {
        type: String,
        default: null
    },
    // Bot isolation for MULTI mode
    botId: {
        type: String,
        required: false,
        index: true,
        default: null
    }
}, {
    timestamps: true
});

// Compound index for efficient queries in MULTI mode
AdminSchema.index({ botId: 1, idTelegram: 1 });

// WhatsApp index
AdminSchema.index({ botId: 1, idWhatsapp: 1 }, { sparse: true });

module.exports = mongoose.model('Admin', AdminSchema, "admins");
