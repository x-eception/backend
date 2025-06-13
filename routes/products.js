const express = require('express');
const mysql = require('mysql2');
const nodemailer = require('nodemailer');
const router = express.Router();

// MySQL connection
const db = mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
});

// Check MySQL connection
db.connect(err => {
  if (err) {
    console.error('❌ MySQL connection failed:', err);
  } else {
    console.log('✅ MySQL Connected');
  }
});

// GET all products
router.get('/', (req, res) => {
  db.query('SELECT * FROM shop_details', (err, results) => {
    if (err) {
      console.error('❌ MySQL query error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(results);
  });
});

// POST a new product
router.post('/', (req, res) => {
  const { id, Name, buying_price, selling_price, stock } = req.body;

  // Field presence check
  if (!id || !Name || buying_price == null || selling_price == null || stock == null) {
    return res.status(400).json({ error: 'All product fields are required' });
  }

  // Type validation
  if (isNaN(buying_price) || isNaN(selling_price) || isNaN(stock)) {
    return res.status(400).json({ error: 'Price and stock must be valid numbers' });
  }

  const query = 'INSERT INTO shop_details (id, Name, buying_price, selling_price, stock) VALUES (?, ?, ?, ?, ?)';
  const values = [id, Name, buying_price, selling_price, stock];

  db.query(query, values, (err, result) => {
    if (err) {
      console.error('❌ MySQL insert error:', err);
      return res.status(500).json({ error: 'Failed to add product' });
    }
    res.status(201).json({ message: 'Product added successfully', id: result.insertId });
  });
});


// DELETE product by ID
router.delete('/:id', (req, res) => {
  const id = req.params.id;
  db.query('DELETE FROM shop_details WHERE id = ?', [id], (err, result) => {
    if (err) {
      console.error('❌ MySQL delete error:', err);
      return res.status(500).json({ error: 'Failed to delete product' });
    }
    res.json({ message: 'Product deleted successfully' });
  });
});

// SEND email for low stock
router.get('/low-stock/email', (req, res) => {
  const query = 'SELECT * FROM shop_details WHERE stock < 3';

  db.query(query, async (err, results) => {
    if (err) {
      console.error('❌ Error fetching low stock:', err);
      return res.status(500).json({ error: 'Failed to fetch low stock items' });
    }

    if (results.length === 0) {
      return res.json({ message: 'No low-stock products to report.' });
    }

    const lowStockList = results.map(p => `${p.Name} (Stock: ${p.stock})`).join('\n');

    // Nodemailer setup
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
      }
    });

    const mailOptions = {
      from: `"Stock Alert - Tharkuri Malig" <${process.env.MAIL_USER}>`,
      to: process.env.ALERT_EMAIL || 'bharathkumar21cse@gmail.com',
      subject: '⚠️ Low Stock Alert',
      text: `The following products have stock less than 3:\n\n${lowStockList}`
    };

    try {
      await transporter.sendMail(mailOptions);
      res.json({ message: 'Low stock email sent successfully.' });
    } catch (mailErr) {
      console.error('❌ Email error:', mailErr);
      res.status(500).json({ error: 'Failed to send email' });
    }
  });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { buying_price, selling_price, stock } = req.body;

  db.query(
    'UPDATE shop_details SET buying_price = ?, selling_price = ?, stock = ? WHERE id = ?',
    [buying_price, selling_price, stock, id],
    (err, result) => {
      if (err) return res.status(500).json({ message: 'Update failed', error: err });
      res.json({ message: 'Product updated successfully' });
    }
  );
});


module.exports = router;
