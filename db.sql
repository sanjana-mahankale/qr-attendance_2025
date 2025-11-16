-- QR Attendance (Enhanced)
CREATE DATABASE IF NOT EXISTS qr_attendance;
USE qr_attendance;

CREATE TABLE IF NOT EXISTS students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  roll VARCHAR(50) NOT NULL UNIQUE,
  full_name VARCHAR(200) NOT NULL,
  email VARCHAR(200) DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS subjects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(200) NOT NULL
);

CREATE TABLE IF NOT EXISTS classes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL -- e.g. "SE-A", "TE-CSE"
);

CREATE TABLE IF NOT EXISTS sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subject_id INT NOT NULL,
  class_id INT NOT NULL,
  session_code VARCHAR(120) NOT NULL UNIQUE,
  start_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_time DATETIME DEFAULT NULL,
  created_by VARCHAR(100) DEFAULT NULL,
  title VARCHAR(200) DEFAULT NULL,
  FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attendance (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  student_id INT NULL,
  roll VARCHAR(50) NOT NULL,
  full_name VARCHAR(200) NOT NULL,
  email VARCHAR(200) DEFAULT NULL,
  status ENUM('present','absent') NOT NULL DEFAULT 'present',
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_session_roll (session_id, roll),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL
);

-- sample data
INSERT INTO subjects (code, name) VALUES ('CS101','Data Structures'), ('CS102','Operating Systems') ON DUPLICATE KEY UPDATE name=VALUES(name);
INSERT INTO classes (name) VALUES ('SE-A'),('TE-CSE') ON DUPLICATE KEY UPDATE name=VALUES(name);

INSERT INTO students (roll, full_name, email) VALUES
('R001','Aman Sharma','aman@example.com'),
('R002','Priya Verma','priya@example.com'),
('R003','Rahul Singh','rahul@example.com')
ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), email=VALUES(email);
