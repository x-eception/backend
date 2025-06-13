require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path');

const User = require('./models/User');
const productRoutes = require('./routes/products');
const db = require('./db');
const connectBillingDB = require('./billingDB');
const createBillingModel = require('./models/Billing');

const app = express();
const PORT = process.env.PORT || 5000;
const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS) || 10;

app.use(cors({
  origin: 'https://frontend-one-eta-56.vercel.app', // allow frontend to access backend
  credentials: true
}));

app.use(bodyParser.json());

let Billing; // 🟡 Declare Billing model globally

// MongoDB (Users) connection
mongoose.connect(process.env.MONGO_URI + 'users')
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Billing DB connection
(async () => {
  try {
    const billingDB = await connectBillingDB();
    Billing = createBillingModel(billingDB);
    console.log('✅ Billing DB connected');
  } catch (err) {
    console.error('❌ Billing DB connection failed:', err);
  }
})();

// Nodemailer Setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

// Cron - Stock Alert Email
cron.schedule('0 13 * * *', () => {
  console.log('⏰ Running daily 1 PM stock check...');
  const query = 'SELECT * FROM shop_details WHERE stock <= 3';

  db.query(query, async (err, results) => {
    if (err) return console.error('❌ Error fetching low stock:', err);
    if (!results.length) return console.log('✅ No low-stock items to report.');

    const list = results.map(p => `${p.Name} (Stock: ${p.stock})`).join('\n');
    const mailOptions = {
      from: `"Stock Alert - Bakery" <${process.env.MAIL_USER}>`,
      to: process.env.ALERT_EMAIL,
      subject: '⚠️ Low Stock Alert',
      text: `The following products have stock less than 3:\n\n${list}`
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log('📧 Stock alert email sent at 1 PM.');
    } catch (mailErr) {
      console.error('❌ Email sending error:', mailErr);
    }
  });
});

// Signup Route
app.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(409).json({ message: 'Email already exists' });

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const newUser = new User({ name, email, password: hashedPassword });

    await newUser.save();
    res.status(201).json({ message: 'Signup successful' });
  } catch (err) {
    console.error('❌ Signup error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Login Route
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  console.log("🛂 Login attempt:", email); // Debug

  try {
    const user = await User.findOne({ email });
    if (!user) {
      console.warn("❌ No user found with email:", email);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.warn("❌ Invalid password for email:", email);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    console.log("✅ Login successful for:", email);
    res.status(200).json({ message: 'Login successful' });

  } catch (err) {
    console.error('❌ Login error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// Product Routes
app.use('/products', productRoutes);
app.use('/bills', express.static(path.join(__dirname, 'bills')));

// Billing Route
app.post('/billing', async (req, res) => {
  const { items, email } = req.body;

  try {
    if (!Billing) throw new Error('Billing DB not initialized yet');

    const mysqlConn = db.promise();
    const ids = items.map(i => i.productId).join(',');
    const [rows] = await mysqlConn.query(`SELECT * FROM shop_details WHERE id IN (${ids})`);

    let total = 0;
    const billedItems = items.map(i => {
      const product = rows.find(p => p.id === i.productId);
      if (!product) throw `Product ID ${i.productId} not found.`;
      if (i.qty > product.stock) throw `Only ${product.stock} kg of "${product.Name}" is available.`;

      const subtotal = i.qty * product.selling_price;
      total += subtotal;

      return {
        productId: product.id,
        name: product.Name,
        unitPrice: product.selling_price,
        qty: i.qty,
        subtotal
      };
    });

    // Update stock
    for (const item of billedItems) {
      await mysqlConn.query(
        'UPDATE shop_details SET stock = stock - ? WHERE id = ?',
        [item.qty, item.productId]
      );
    }

    // Save to Billing DB
    const bill = await Billing.create({ items: billedItems, total });

    // Generate PDF
    const doc = new PDFDocument();
    const fileName = `bill_${bill._id}.pdf`;
    const filePath = path.join(__dirname, 'bills', fileName);

    if (!fs.existsSync(path.join(__dirname, 'bills'))) {
      fs.mkdirSync(path.join(__dirname, 'bills'));
    }

    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    doc.fontSize(20).text('🧾 Tharkuri Maligai Bill', { align: 'center' }).moveDown();
    billedItems.forEach((item, index) => {
      doc.text(`${index + 1}. ${item.name} - ${item.qty} x ₹${item.unitPrice} = ₹${item.subtotal}`);
    });
    doc.moveDown().fontSize(16).text(`Total: ₹${total}`, { align: 'right' });
    doc.end();

    writeStream.on('finish', async () => {
      const downloadUrl = `/bills/${fileName}`;

      // Optional Email
      if (email) {
        try {
          await transporter.sendMail({
            from: `"Tharkuri Maligai Billing" <${process.env.MAIL_USER}>`,
            to: email,
            subject: '🧾 Your Bill from Tharkuri Maligai',
            text: `Thank you for your purchase. You can download your bill here: ${downloadUrl}`,
            attachments: [{ filename: fileName, path: filePath }]
          });
          console.log(`📧 Bill emailed to ${email}`);
        } catch (emailErr) {
          console.error('❌ Email sending error:', emailErr);
        }
      }

      res.json({
        message: '✅ Bill generated and saved successfully',
        billId: bill._id,
        items: billedItems,
        total,
        downloadUrl
      });
    });

  } catch (err) {
    console.error('❌ Billing error:', err);
    res.status(400).json({ message: err.toString() });
  }
});

// Default route
app.get('/', (req, res) => {
  res.send('🚀 Welcome to the Bakery Backend!');
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
