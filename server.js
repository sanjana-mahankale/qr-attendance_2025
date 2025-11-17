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

// === DATABASE POOL USING RAILWAY PUBLIC URL ===
// === DATABASE POOL USING RAILWAY PUBLIC URL ===
let pool;
async function getPool() {
  if (!pool) {
    if (!process.env.MYSQL_PUBLIC_URL) throw new Error("MYSQL_PUBLIC_URL not set in .env");
    
    // Add multipleStatements=true if you plan to run multiple queries at once
    pool = mysql.createPool(process.env.MYSQL_PUBLIC_URL + "?multipleStatements=true");
    
    pool.on('error', (err) => {
      console.error("MySQL Pool Error:", err);
      pool = null;
    });
  }
  return pool;
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

/* Teachers endpoints (for datalist) */
app.get('/api/teachers', async (req, res) => {
  try {
    const pool = await getPool();
    const [rows] = await pool.query('SELECT id, full_name FROM teachers ORDER BY full_name');
    res.json({ ok: true, teachers: rows });
  } catch (err) { console.error(err); res.status(500).json({ ok:false, error: err.message }); }
});
app.post('/api/add-teacher', async (req, res) => {
  try {
    const { full_name } = req.body;
    if (!full_name) return res.status(400).json({ ok:false, error:'Teacher name required' });
    const pool = await getPool();
    await pool.query('INSERT IGNORE INTO teachers (full_name) VALUES (?)', [full_name.trim()]);
    res.json({ ok:true });
  } catch (err) { console.error(err); res.status(500).json({ ok:false, error: err.message }); }
});

// ✅ Add Subject
app.post('/api/add-subject', async (req, res) => {
  try {
    const { subject_name } = req.body;
    if (!subject_name) return res.json({ ok: false, error: "Missing subject_name" });

    const pool = await getPool(); // ✅ FIXED: get connection pool

    const [result] = await pool.query(
      "INSERT IGNORE INTO subjects (subject_name) VALUES (?)",
      [subject_name]
    );

    const [rows] = await pool.query(
      "SELECT id, subject_name FROM subjects WHERE subject_name = ?",
      [subject_name]
    );

    res.json({ ok: true, subject: rows[0] });
  } catch (err) {
    console.error("Add subject error:", err);
    res.json({ ok: false, error: err.message });
  }
});

// ✅ Add Class
app.post('/api/add-class', async (req, res) => {
  try {
    const { class_name } = req.body;
    if (!class_name) return res.json({ ok: false, error: "Missing class_name" });

    const pool = await getPool(); // ✅ FIXED: get connection pool

    const [result] = await pool.query(
      "INSERT IGNORE INTO classes (class_name) VALUES (?)",
      [class_name]
    );

    const [rows] = await pool.query(
      "SELECT id, class_name FROM classes WHERE class_name = ?",
      [class_name]
    );

    res.json({ ok: true, class: rows[0] });
  } catch (err) {
    console.error("Add class error:", err);
    res.json({ ok: false, error: err.message });
  }
});


// === Create session ===
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

    // After session creation
const session_id = result.insertId;

// ✅ Define base URL dynamically
const baseUrl = process.env.BASE_URL 
  ? process.env.BASE_URL.replace(/\/$/, '') 
  : 'https://qr-attendance-2025.onrender.com'; // your deployed URL fallback

// ✅ Generate QR link that points to student_scan.html (public folder)
const qrLink = `${baseUrl}/student_scan.html?session_code=${session_code}&token=${session_token}`;

// ✅ Generate QR as DataURL (you can also save to file if needed)
const qrDataUrl = await QRCode.toDataURL(qrLink);


    res.json({ ok: true, session_code, session_id, qrDataUrl, qrLink });
  } catch (err) {
    console.error('QR generation failed:', err);
    res.json({ ok: false, error: 'QR generation failed' });
  }
});
app.post('/api/record-attendance', async (req, res) => {
  try {
    const { session_code, token, roll, full_name, email, type } = req.body;

    if (!session_code || !token || !roll || !full_name || !email || !type) {
      return res.json({ ok: false, error: 'Missing fields' });
    }

    // ✅ Get database pool
    const pool = await getPool();

    // ✅ Validate session_code & session_token (your DB should have column 'session_token', not 'token')
    const [session] = await pool.query(
      'SELECT * FROM sessions WHERE session_code = ? AND session_token = ?',
      [session_code, token]
    );

    if (!session.length) return res.json({ ok: false, error: 'Invalid session' });

    // ✅ Insert attendance
    await pool.query(
      'INSERT INTO attendance (session_code, roll, full_name, email, type) VALUES (?, ?, ?, ?, ?)',
      [session_code, roll, full_name, email, type]
    );

    res.json({ ok: true });

  } catch (err) {
    console.error('Record attendance error:', err);
    res.json({ ok: false, error: 'Server error' });
  }
});


// === Upload Students ===
app.post('/api/upload-students', async (req, res) => {
  try {
    const file = req.files?.file;
    const class_id = req.body.class_id;
    const created_by = req.body.created_by || 'Unknown';
    const mode = req.body.mode || 'merge';

    if (!file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    if (!class_id) return res.status(400).json({ ok: false, error: 'Missing class_id' });

    const records = parseUploadedFileSync(file.data, file.name);
    const pool = await getPool();

    let imported = 0, skipped = 0;
   const headers = Object.keys(records[0]).map(h => h.trim());
     console.log('Cleaned Headers:', headers);

    // inner try block
    try {
      for (const row of records) {
        const normalized = {};
        for (const key in row) {
          normalized[key.trim().toLowerCase()] = row[key];
        }

        const roll = normalized.roll || '';
        const prn = normalized.prn || '';
        const full_name = normalized.full_name || '';
        const contact = normalized.contact || '';
        const email = normalized.email || '';

        if (!roll || !full_name) {
          skipped++;
          continue;
        }

        await pool.query(
          `INSERT INTO students (roll, prn, full_name, contact, email, class_id)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             prn = VALUES(prn),
             full_name = VALUES(full_name),
             contact = VALUES(contact),
             email = VALUES(email),
             class_id = VALUES(class_id)`,
          [roll, prn, full_name, contact, email, class_id]
        );
        imported++;
      }

      res.json({
        ok: true,
        imported,
        skipped,
        message: `✅ Imported ${imported} students, skipped ${skipped}.`,
      });
    } catch (e) {
      console.error("❌ Upload error:", e);
      res.status(500).json({ ok: false, error: e.message });
    }

  } catch (err) {
    console.error("❌ Outer error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}); // ✅ this was missing!



// ✅ Get all students for a class (for admin panel)
app.get('/api/students', async (req, res) => {
  try {
    const class_id = req.query.class_id;

    const pool = await getPool();
    let query = 'SELECT s.*, c.class_name FROM students s LEFT JOIN classes c ON s.class_id = c.id';
    const params = [];
    if (class_id) {
      query += ' WHERE s.class_id = ?';
      params.push(class_id);
    }
    query += ' ORDER BY s.roll';

    const [students] = await pool.query(query, params);
    res.json({ ok: true, students });
  } catch (err) {
    console.error('Fetch students error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});



// === Reports ===
app.get('/api/report/subject/:id', async (req, res) => {
  try {
    const subject_id = req.params.id;
    const pool = await getPool();

    // ✅ Get sessions for that subject
    const [sessions] = await pool.query(
      `SELECT id, start_time, session_code 
       FROM sessions 
       WHERE subject_id = ? 
       ORDER BY start_time`,
      [subject_id]
    );

    if (sessions.length === 0) {
      return res.json({ ok: true, sessions: [], students: [] });
    }

    // ✅ Get all attendance data for those sessions in one query
    const sessionIds = sessions.map(s => s.id);
    const [attendanceData] = await pool.query(
      `SELECT a.session_id, s.id AS student_id, s.roll, s.full_name
       FROM attendance a
       JOIN students s ON a.student_id = s.id
       WHERE a.session_id IN (?)
       ORDER BY s.roll`,
      [sessionIds]
    );

    // ✅ Get all students once
    const [students] = await pool.query(`SELECT id, roll, full_name FROM students ORDER BY roll`);

    // ✅ Build attendance map for quick lookup
    const attendanceMap = new Map();
    attendanceData.forEach(row => {
      if (!attendanceMap.has(row.student_id)) attendanceMap.set(row.student_id, new Set());
      attendanceMap.get(row.student_id).add(row.session_id);
    });

    // ✅ Fill attendance matrix
    students.forEach(st => {
      st.attendance = sessions.map(s =>
        attendanceMap.get(st.id)?.has(s.id) ? '✔️' : '❌'
      );
    });

    res.json({ ok: true, sessions, students });
  } catch (err) {
    console.error('Error in report/subject:', err);
    res.json({ ok: false, error: err.message });
  }
});

// ✅ Get overall defaulters (across all subjects)
// ✅ Subject-wise defaulters
app.get('/api/defaulters/subject/:subject_id', async (req, res) => {
  try {
    const subject_id = req.params.subject_id;
    const threshold = parseFloat(req.query.threshold) || 75;

    const pool = await getPool();

    // 1️⃣ Get sessions for this subject
    const [sessions] = await pool.query(
      `SELECT id, session_type FROM sessions WHERE subject_id = ?`,
      [subject_id]
    );
    if (sessions.length === 0) return res.json({ ok:true, defaulters: [] });

    const sessionIds = sessions.map(s => s.id);
    const totalTH = sessions.filter(s => s.session_type === 'TH').length;
    const totalPR = sessions.filter(s => s.session_type === 'PR').length;

    // 2️⃣ Get students who belong to the classes of these sessions
    const [students] = await pool.query(
      `SELECT DISTINCT s.id, s.roll, s.full_name, c.class_name
       FROM students s
       JOIN classes c ON s.class_id = c.id
       JOIN sessions sess ON sess.class_id = s.class_id
       WHERE sess.subject_id = ?`,
      [subject_id]
    );

    // 3️⃣ Get attendance
    const [attendance] = await pool.query(
      `SELECT student_id, session_id FROM attendance WHERE session_id IN (?)`,
      [sessionIds]
    );

    // Build attendance map
    const attendanceMap = new Map();
    attendance.forEach(a => {
      if (!attendanceMap.has(a.student_id)) attendanceMap.set(a.student_id, new Set());
      attendanceMap.get(a.student_id).add(a.session_id);
    });

    // 4️⃣ Calculate TH, PR, TOTAL, %
    const defaulters = students.map((st, idx) => {
      const presentSessions = attendanceMap.get(st.id) || new Set();
      const th = sessions.filter(s => s.session_type === 'TH' && presentSessions.has(s.id)).length;
      const pr = sessions.filter(s => s.session_type === 'PR' && presentSessions.has(s.id)).length;
      const total = th + pr;
      const percent = sessionIds.length ? (total / sessionIds.length * 100).toFixed(2) : 0;

      return {
        sr_no: idx + 1,
        roll: st.roll,
        name: st.full_name,
        subject: st.class_name, // or you can fetch subject name separately
        TH: th,
        PR: pr,
        TOTAL: total,
        percent
      };
    }).filter(s => s.percent < threshold); // Only defaulters

    res.json({ ok:true, defaulters });

  } catch (err) {
    console.error('Subject defaulters error:', err);
    res.json({ ok:false, error: err.message });
  }
});

// ✅ All subjects + students attendance summary
app.get('/api/subjects-students-summary', async (req, res) => {
  try {
    const pool = await getPool();

    // 1️⃣ Get all subjects
    const [subjects] = await pool.query(`SELECT id, subject_name FROM subjects ORDER BY id`);

    const result = [];

    for (const sub of subjects) {
      // 2️⃣ Get sessions for this subject
      const [sessions] = await pool.query(
        `SELECT id, session_type FROM sessions WHERE subject_id = ?`,
        [sub.id]
      );

      if (sessions.length === 0) continue;

      const sessionIds = sessions.map(s => s.id);
      const totalTH = sessions.filter(s => s.session_type === 'TH').length;
      const totalPR = sessions.filter(s => s.session_type === 'PR').length;

      // 3️⃣ Get all students who attended these sessions
      const [students] = await pool.query(
        `SELECT s.id, s.roll, s.full_name
         FROM students s
         JOIN classes c ON s.class_id = c.id
         WHERE c.id IN (SELECT DISTINCT class_id FROM sessions WHERE id IN (?))`,
        [sessionIds]
      );

      // 4️⃣ Get attendance records for these sessions
      const [attendance] = await pool.query(
        `SELECT student_id, session_id FROM attendance WHERE session_id IN (?)`,
        [sessionIds]
      );

      const attendanceMap = new Map();
      attendance.forEach(a => {
        if (!attendanceMap.has(a.student_id)) attendanceMap.set(a.student_id, new Set());
        attendanceMap.get(a.student_id).add(a.session_id);
      });

      // 5️⃣ Build student attendance summary
      students.forEach((st, idx) => {
        const attendedCount = attendanceMap.get(st.id)?.size || 0;
        const percent = sessionIds.length ? (attendedCount / sessionIds.length) * 100 : 0;

        result.push({
          sr_no: idx + 1,
          roll: st.roll,
          name: st.full_name,
          subject: sub.subject_name,
          TH: totalTH,
          PR: totalPR,
          TOTAL: totalTH + totalPR,
          percent: percent.toFixed(2)
        });
      });
    }

    res.json({ ok: true, data: result });

  } catch (err) {
    console.error(err);
    res.json({ ok: false, error: err.message });
  }
});


 // ✅ Live attendance fetch route
app.get('/api/session/:session_code/attendance', async (req, res) => {
  const { session_code } = req.params;

  try {
    const pool = await getPool(); // ✅ Add this line

    // Get session_id from session_code
    const [session] = await pool.query(
      'SELECT id FROM sessions WHERE session_code = ?',
      [session_code]
    );
    if (session.length === 0)
      return res.json({ ok: false, msg: 'Invalid session code' });

    const session_id = session[0].id;

    // Fetch attendance records with student info
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

// Keep-alive function
// Keep-alive function
setInterval(() => {
  https.get('https://qr-attendance-2025.onrender.com/testdb', res => {
    console.log('🌐 Pinged testdb to keep MySQL awake');
  }).on('error', err => console.error('Ping error:', err.message));
}, 5 * 60 * 1000); // every 5 minutes



// === Start server ===
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 
