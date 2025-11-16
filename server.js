require('dotenv').config();

const express = require('express');
const fileUpload = require('express-fileupload');
const XLSX = require('xlsx');
const { parse } = require('csv-parse/sync');
const mysql = require('mysql2/promise');
const QRCode = require('qrcode');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bodyParser = require('body-parser');
const https = require('https');

const app = express();

// === FOLDERS ===
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const STUDENTS_UPLOAD_DIR = path.join(UPLOAD_DIR, 'students');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(STUDENTS_UPLOAD_DIR)) fs.mkdirSync(STUDENTS_UPLOAD_DIR, { recursive: true });

// === MIDDLEWARES ===
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(fileUpload({ limits: { fileSize: 25 * 1024 * 1024 }, abortOnLimit: true }));
app.use(express.static(PUBLIC_DIR));

// === DATABASE CONFIG (Railway) ===
const DB = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

// === MySQL Pool (NO SSL REQUIRED FOR RAILWAY) ===
async function getPool() {
  if (!global.pool) {
    global.pool = mysql.createPool({
      host: DB.host,
      port: DB.port,
      user: DB.user,
      password: DB.password,
      database: DB.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    global.pool.on('error', (err) => {
      console.error("MySQL Pool Error:", err);
      global.pool = null;
    });
  }
  return global.pool;
}

// === HELPERS ===
function genToken(len = 48) {
  return crypto.randomBytes(len).toString("hex").slice(0, len);
}

function parseUploadedFileSync(buffer, filename) {
  const name = filename.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const txt = buffer.toString("utf8");
    return parse(txt, { columns: true, skip_empty_lines: true, trim: true });
  } else if (name.endsWith(".xlsx")) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet);
  }
  throw new Error("Unsupported file type: " + filename);
}

// === ROUTES ===
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'teacher.html')));
app.get('/teacher', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'teacher.html')));
app.get('/student', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'student_scan.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

// === DB TEST ===
app.get("/testdb", async (req, res) => {
  try {
    const pool = await getPool();
    const [rows] = await pool.query("SELECT NOW() AS time");
    res.json({ ok: true, time: rows[0].time });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// -------- META --------
app.get("/api/meta", async (req, res) => {
  try {
    const pool = await getPool();
    const [subjects] = await pool.query("SELECT id, subject_name FROM subjects ORDER BY id DESC");
    const [classes] = await pool.query("SELECT id, class_name FROM classes ORDER BY id DESC");
    res.json({ ok: true, subjects, classes });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// -------- TEACHERS --------
app.get('/api/teachers', async (req, res) => {
  try {
    const pool = await getPool();
    const [rows] = await pool.query("SELECT id, full_name FROM teachers ORDER BY full_name");
    res.json({ ok: true, teachers: rows });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/add-teacher', async (req, res) => {
  try {
    const { full_name } = req.body;
    if (!full_name) return res.json({ ok: false, error: "Name required" });

    const pool = await getPool();
    await pool.query("INSERT IGNORE INTO teachers (full_name) VALUES (?)", [full_name]);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// -------- SUBJECT --------
app.post('/api/add-subject', async (req, res) => {
  try {
    const { subject_name } = req.body;
    const pool = await getPool();
    await pool.query("INSERT IGNORE INTO subjects (subject_name) VALUES (?)", [subject_name]);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// -------- CLASS --------
app.post('/api/add-class', async (req, res) => {
  try {
    const { class_name } = req.body;
    const pool = await getPool();
    await pool.query("INSERT IGNORE INTO classes (class_name) VALUES (?)", [class_name]);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// -------- CREATE SESSION --------
app.post('/api/create-session', async (req, res) => {
  try {
    const { subject_id, class_id, created_by } = req.body;

    const pool = await getPool();
    const session_code = Math.random().toString(36).substr(2, 6).toUpperCase();
    const session_token = genToken(16);
    const start = new Date();
    const end = new Date(start.getTime() + 10 * 60000);

    const [result] = await pool.query(
      `INSERT INTO sessions (subject_id, class_id, created_by, session_code, session_token, start_time, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [subject_id, class_id, created_by, session_code, session_token, start, end]
    );

    const session_id = result.insertId;

    const baseUrl =
      process.env.BASE_URL?.replace(/\/$/, "") ||
      "https://qr-attendance-2025.onrender.com";

    const qrLink = `${baseUrl}/student?session_code=${session_code}&token=${session_token}`;
    const qrDataUrl = await QRCode.toDataURL(qrLink);

    res.json({ ok: true, session_code, session_id, qrLink, qrDataUrl });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// -------- RECORD ATTENDANCE --------
app.post('/api/record-attendance', async (req, res) => {
  const { session_code, token, roll, full_name, email } = req.body;

  try {
    const pool = await getPool();

    const [sessions] = await pool.query(
      "SELECT * FROM sessions WHERE session_code=? AND session_token=?",
      [session_code, token]
    );

    if (!sessions.length) return res.json({ ok: false, error: "Invalid session" });

    const session = sessions[0];

    let [students] = await pool.query(
      "SELECT * FROM students WHERE email=?",
      [email]
    );

    let student_id;

    if (!students.length) {
      const [ins] = await pool.query(
        "INSERT INTO students (roll, full_name, email) VALUES (?, ?, ?)",
        [roll, full_name, email]
      );
      student_id = ins.insertId;
    } else {
      student_id = students[0].id;
    }

    await pool.query(
      "INSERT INTO attendance (session_id, student_id, roll, full_name, email, status) VALUES (?, ?, ?, ?, ?, 'Present')",
      [session.id, student_id, roll, full_name, email]
    );

    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// -------- UPLOAD STUDENTS --------
app.post("/api/upload-students", async (req, res) => {
  try {
    const file = req.files?.file;
    const class_id = req.body.class_id;

    const rows = parseUploadedFileSync(file.data, file.name);
    const pool = await getPool();

    let imported = 0;

    for (const row of rows) {
      await pool.query(
        `INSERT IGNORE INTO students (roll, full_name, email, class_id)
         VALUES (?, ?, ?, ?)`,
        [row.roll, row.full_name, row.email, class_id]
      );
      imported++;
    }

    res.json({ ok: true, imported });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// -------- ALL STUDENTS --------
app.get("/api/students", async (req, res) => {
  try {
    const pool = await getPool();
    const [rows] = await pool.query(`
      SELECT s.id, s.roll, s.full_name, s.email, c.class_name
      FROM students s
      LEFT JOIN classes c ON s.class_id=c.id
      ORDER BY s.roll
    `);
    res.json({ ok: true, students: rows });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Keep-alive
setInterval(() => {
  const url = (process.env.BASE_URL || "https://qr-attendance-2025.onrender.com") + "/testdb";
  https.get(url);
}, 5 * 60 * 1000);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
