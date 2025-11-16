require('dotenv').config();
const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');

// Load CA certificate
const caCertPath = path.join(__dirname, 'ca.pem');
let caCert = null;
if (fs.existsSync(caCertPath)) {
  caCert = fs.readFileSync(caCertPath);
  console.log('✅ CA certificate loaded successfully');
} else {
  console.warn('⚠️ CA certificate not found, SSL connection may fail.');
}

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  ssl: caCert ? { ca: caCert } : undefined
});

connection.connect((err) => {
  if (err) {
    console.error('❌ Database connection failed:', err);
    return;
  }
  console.log('✅ Connected to MySQL database successfully!');
  connection.end();
});
