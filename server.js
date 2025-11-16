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

// === Directories ===
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const STUDENTS_UPLOAD_DIR = path.join(UPLOAD_DIR, 'students');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(STUDENTS_UPLOAD_DIR)) fs.mkdirSync(STUDENTS_UPLOAD_DIR, { recursive: true });

// === Middlewares ===
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(fileUpload({ limits: { fileSize: 25 * 1024 * 1024 }, abortOnLimit: true }));

// ✅ Serve static files
app.use(express.static(PUBLIC_DIR));

// === Database config ===
const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'qr_attendance'
};

// Create MySQL pool
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
      console.error('⚠️ MySQL Pool Error:', err);
      if (err.code === 'PROTOCOL_CONNECTION_LOST') global.pool = null;
    });
  }
  return global.pool;
}

// Test DB
app.get('/testdb', async (req, res) => {
  try {
    const pool = await getPool();
    const [rows] = await pool.query('SELECT NOW() AS current_time');
    res.json({ ok: true, time: rows[0].current_time });
  } catch (err) {
    console.error('❌ DB Test Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Helpers
function genToken(len = 48) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
}

function parseUploadedFileSync(buffer, filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const txt = buffer.toString('utf8');
    return parse(txt, { columns: true, skip_empty_lines: true, trim: true });
  } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  } else {
    throw new Error('Unsupported file type: ' + filename);
  }
}

// === HTML Routes ===
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'teacher.html')));
app.get('/teacher', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'teacher.html')));
app.get('/student', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'student_scan.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

// === API Routes ===

// Metadata
app.get('/api/meta', async (req, res) => {
  try {
    const pool = await getPool();
    const [subjects] = await pool.query("SELECT id, subject_name FROM subjects ORDER BY id DESC");
    const [classes] = await pool.query("SELECT id, class_name FROM classes ORDER BY id DESC");
    res.json({ ok: true, subjects, classes });
  } catch (err) {
    console.error("Meta load error:", err);
    res.json({ ok: false, error: err.message });
  }
});


// Teachers endpoints
app.get('/api/teachers', async (req, res) => {
  try {
    const pool = await getPool();
    const [rows] = await pool.query('SELECT id, full_name FROM teachers ORDER BY full_name');
    res.json({ ok: true, teachers: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});
app.post('/api/add-teacher', async (req, res) => {
  try {
    const { full_name } = req.body;
    if (!full_name) return res.status(400).json({ ok: false, error: 'Teacher name required' });
    const pool = await getPool();
    await pool.query('INSERT IGNORE INTO teachers (full_name) VALUES (?)', [full_name.trim()]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Add Subject
app.post('/api/add-subject', async (req, res) => {
  try {
    const { subject_name } = req.body;
    if (!subject_name) return res.json({ ok: false, error: "Missing subject_name" });
    const pool = await getPool();
    await pool.query("INSERT IGNORE INTO subjects (subject_name) VALUES (?)", [subject_name]);
    const [rows] = await pool.query("SELECT id, subject_name FROM subjects WHERE subject_name = ?", [subject_name]);
    res.json({ ok: true, subject: rows[0] });
  } catch (err) {
    console.error("Add subject error:", err);
    res.json({ ok: false, error: err.message });
  }
});

// Add Class
app.post('/api/add-class', async (req, res) => {
  try {
    const { class_name } = req.body;
    if (!class_name) return res.json({ ok: false, error: "Missing class_name" });
    const pool = await getPool();
    await pool.query("INSERT IGNORE INTO classes (class_name) VALUES (?)", [class_name]);
    const [rows] = await pool.query("SELECT id, class_name FROM classes WHERE class_name = ?", [class_name]);
    res.json({ ok: true, class: rows[0] });
  } catch (err) {
    console.error("Add class error:", err);
    res.json({ ok: false, error: err.message });
  }
});

// Create session
app.post('/api/create-session', async (req, res) => {
  try {
    const { subject_id, class_id, created_by } = req.body;
    if (!subject_id || !class_id || !created_by)
      return res.status(400).json({ ok: false, error: 'Missing required fields' });

    const pool = await getPool();
    const session_code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const session_token = genToken(16);
    const start_time = new Date();
    const end_time = new Date(start_time.getTime() + 10 * 60000);

    const [result] = await pool.query(
      `INSERT INTO sessions (subject_id, class_id, created_by, session_code, session_token, start_time, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [subject_id, class_id, created_by, session_code, session_token, start_time, end_time]
    );

    const session_id = result.insertId;
    const baseUrl = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, '') : 'https://qr-attendance-2025.onrender.com';
     const qrLink = `${baseUrl}/student?session_code=${session_code}&token=${session_token}`;
    const qrDataUrl = await QRCode.toDataURL(qrLink);

    res.json({ ok: true, session_code, session_id, qrDataUrl, qrLink });
  } catch (err) {
    console.error('QR generation failed:', err);
    res.json({ ok: false, error: 'QR generation failed' });
  }
});

// Record attendance
app.post('/api/record-attendance', async (req, res) => {
  const { session_code, token, roll, full_name, email } = req.body;
  if (!session_code || !token || !roll || !full_name || !email)
    return res.json({ ok: false, error: 'Missing field' });

  try {
    const pool = await getPool();
    const [sessions] = await pool.query('SELECT * FROM sessions WHERE session_code = ? AND session_token = ?', [session_code, token]);
    if (sessions.length === 0) return res.json({ ok: false, error: 'Invalid or expired session' });

    const session = sessions[0];
    let [students] = await pool.query('SELECT * FROM students WHERE email = ?', [email]);
    let student_id;

    if (students.length === 0) {
      const [ins] = await pool.query('INSERT INTO students (roll, full_name, email) VALUES (?, ?, ?)', [roll, full_name, email]);
      student_id = ins.insertId;
    } else {
      student_id = students[0].id;
    }

    await pool.query(
      `INSERT INTO attendance (session_id, student_id, roll, full_name, email, status)
       VALUES (?, ?, ?, ?, ?, 'Present')`,
      [session.id, student_id, roll, full_name, email]
    );

    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.json({ ok: false, error: 'Already marked attendance' });
    console.error('Attendance error:', err);
    res.json({ ok: false, error: 'Database error' });
  }
});

// Upload students
app.post('/api/upload-students', async (req, res) => {
  try {
    const file = req.files?.file;
    const class_id = req.body.class_id;
    if (!file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    if (!class_id) return res.status(400).json({ ok: false, error: 'Missing class_id' });

    const records = parseUploadedFileSync(file.data, file.name);
    const pool = await getPool();
    let imported = 0, skipped = 0;

    for (const row of records) {
      const normalized = {};
      for (const key in row) normalized[key.trim().toLowerCase()] = row[key];
      const roll = normalized.roll || '';
      const full_name = normalized.full_name || '';
      if (!roll || !full_name) { skipped++; continue; }

      await pool.query(
        `INSERT INTO students (roll, prn, full_name, contact, email, class_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           prn = VALUES(prn),
           full_name = VALUES(full_name),
           contact = VALUES(contact),
           email = VALUES(email),
           class_id = VALUES(class_id)`,
        [roll, normalized.prn || '', full_name, normalized.contact || '', normalized.email || '', class_id]
      );
      imported++;
    }

    res.json({ ok: true, imported, skipped, message: `✅ Imported ${imported} students, skipped ${skipped}.` });
  } catch (err) {
    console.error("❌ Upload error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Reports
app.get('/api/report/subject/:id', async (req, res) => {
  try {
    const subject_id = req.params.id;
    const pool = await getPool();

    const [sessions] = await pool.query(
      `SELECT id, start_time, session_code 
       FROM sessions 
       WHERE subject_id = ? 
       ORDER BY start_time`, [subject_id]
    );

    if (sessions.length === 0) return res.json({ ok: true, sessions: [], students: [] });

    const sessionIds = sessions.map(s => s.id);
    const [attendanceData] = await pool.query(
      `SELECT a.session_id, s.id AS student_id, s.roll, s.full_name
       FROM attendance a
       JOIN students s ON a.student_id = s.id
       WHERE a.session_id IN (?)
       ORDER BY s.roll`, [sessionIds]
    );

    const [students] = await pool.query(`SELECT id, roll, full_name FROM students ORDER BY roll`);

    const attendanceMap = new Map();
    attendanceData.forEach(row => {
      if (!attendanceMap.has(row.student_id)) attendanceMap.set(row.student_id, new Set());
      attendanceMap.get(row.student_id).add(row.session_id);
    });

    students.forEach(st => {
      st.attendance = sessions.map(s => attendanceMap.get(st.id)?.has(s.id) ? '✔️' : '❌');
    });

    res.json({ ok: true, sessions, students });
  } catch (err) {
    console.error('Error in report/subject:', err);
    res.json({ ok: false, error: err.message });
  }
});

// Live attendance fetch
app.get('/api/session/:session_code/attendance', async (req, res) => {
  const { session_code } = req.params;
  try {
    const pool = await getPool();
    const [session] = await pool.query('SELECT id FROM sessions WHERE session_code = ?', [session_code]);
    if (session.length === 0) return res.json({ ok: false, msg: 'Invalid session code' });

    const session_id = session[0].id;
    const [rows] = await pool.query(`
      SELECT s.roll, s.full_name, DATE_FORMAT(a.timestamp, '%H:%i:%s') AS timestamp
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      WHERE a.session_id = ?
      ORDER BY a.timestamp ASC
    `, [session_id]);

    res.json({ ok: true, attendance: rows });
  } catch (err) {
    console.error('Error fetching attendance:', err);
    res.json({ ok: false, msg: 'Error fetching attendance' });
  }
});

// Fetch all students (Admin Panel)
app.get('/api/students', async (req, res) => {
  try {
    const pool = await getPool();
    const [rows] = await pool.query(`
      SELECT s.id, s.roll, s.prn, s.full_name, s.contact, s.email, c.class_name
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      ORDER BY s.roll
    `);
    res.json({ ok: true, students: rows });
  } catch (err) {
    console.error('Error fetching students:', err);
    res.json({ ok: false, error: err.message });
  }
});

// Keep-alive function
setInterval(() => {
  const url = process.env.BASE_URL ? process.env.BASE_URL + '/testdb' : 'https://qr-attendance-2025.onrender.com/testdb';
  https.get(url, res => console.log('🌐 Pinged testdb to keep MySQL awake'))
    .on('error', err => console.error('Ping error:', err.message));
}, 5 * 60 * 1000); // every 5 minutes

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
