// billingDB.js
const mongoose = require('mongoose');

module.exports = async function connectBillingDB() {
  const connection = await mongoose.createConnection(process.env.MONGO_URI + 'billing').asPromise();

  connection.on('connected', () => {
    console.log('✅ Billing DB connected');
  });

  connection.on('error', (err) => {
    console.error('❌ Billing DB connection error:', err);
  });

  return connection;
};
