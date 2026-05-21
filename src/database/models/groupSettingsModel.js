const mongoose = require('mongoose');
const { Schema } = mongoose;

const groupSettingsSchema = new Schema({
    botId: {
        type: String,
        required: false,
        index: true
    },
    groupJid: {
        type: String,
        required: true,
        index: true
    },
    compactListEnabled: {
        type: Boolean,
        required: false,
        default: false
    }
}, {
    timestamps: true
});

groupSettingsSchema.index({ botId: 1, groupJid: 1 }, { unique: true });

module.exports = mongoose.model('GroupSettings', groupSettingsSchema, 'groupSettings');
