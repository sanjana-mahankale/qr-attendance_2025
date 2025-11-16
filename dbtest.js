require('dotenv').config();
const mysql = require('mysql2');

// Railway does NOT use SSL → remove ca.pem completely
// Clean + simple connection

const connection = mysql.createConnection({
  host: process.env.DB_HOST,     // mysql.railway.internal
  user: process.env.DB_USER,     // root
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, // railway
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306
});

connection.connect((err) => {
  if (err) {
    console.error('❌ Database connection failed:', err);
    return;
  }
  console.log('✅ Connected to MySQL database successfully!');
  connection.end();
});
