// dbtest.js
require('dotenv').config();
const mysql = require('mysql2');

const port = process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306;

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: port
});

connection.connect((err) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    return;
  }

  console.log('✅ Connected to MySQL database successfully!');

  // Fixed syntax for MySQL/MariaDB
  connection.query('SELECT NOW() AS `current_time`', (err, results) => {
    if (err) {
      console.error('❌ Test query failed:', err.message);
    } else {
      console.log('🕒 Current DB time:', results[0].current_time);
    }
    connection.end();
  });
});
