require('dotenv').config();
const mysql = require('mysql2');

// Optional: Load Aiven CA certificate if needed
const fs = require('fs');
const path = require('path');

// Path to Aiven CA certificate (download from Aiven dashboard)
const caCert = fs.readFileSync(path.join(__dirname, 'AivenClass2Root.pem'));

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: {
    ca: caCert
  }
});

connection.connect((err) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    return;
  }
  console.log('✅ Connected to MySQL database successfully!');
  connection.end();
});
