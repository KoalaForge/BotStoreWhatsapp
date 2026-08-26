const mongoose = require('mongoose');

const stockBatchSchema = new mongoose.Schema({
    _id: { type: String },
    batchCode: { type: String, required: true, unique: true },
    codeVariant: { type: String, required: true },
    ownerId: { type: String, default: null },
    profitPerUnit: { type: Number, default: 0 },
    quantityAdded: { type: Number, required: true },
    sourceSystem: { type: String, required: true },
    status: { type: String, default: 'completed' }
}, { timestamps: true, collection: 'stock_batches' });

module.exports = mongoose.model('Stock_Batches', stockBatchSchema, 'stock_batches');
