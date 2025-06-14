// models/Billing.js
const mongoose = require('mongoose');

const BillingSchema = new mongoose.Schema({
  items: [
    {
      productId: Number,
      name: String,
      unitPrice: Number,
      qty: Number,
      subtotal: Number
    }
  ],
  total: Number,
  timestamp: { type: Date, default: Date.now }
});

// ✅ Export a function to create the model using the given connection
module.exports = function createBillingModel(billingDB) {
  return billingDB.model('Billing', BillingSchema);
};
