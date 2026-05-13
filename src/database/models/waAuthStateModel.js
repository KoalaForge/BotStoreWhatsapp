const mongoose = require('mongoose');

const waAuthStateSchema = new mongoose.Schema({
    botId: {
        type: String,
        required: true,
        index: true
    },
    dataType: {
        type: String,
        required: true,
        enum: ['creds', 'keys']
    },
    dataKey: {
        type: String,
        required: true
    },
    data: {
        type: String,
        required: true
    }
}, {
    timestamps: true,
    collection: 'wa_auth_states'
});

waAuthStateSchema.index({ botId: 1, dataType: 1, dataKey: 1 }, { unique: true });

module.exports = mongoose.model('WaAuthState', waAuthStateSchema);
