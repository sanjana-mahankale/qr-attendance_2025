CREATE TABLE IF NOT EXISTS subjects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subject_name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS classes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  class_name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS teachers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  roll VARCHAR(50) NOT NULL,
  prn VARCHAR(50) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  contact VARCHAR(20),
  email VARCHAR(100),
  class_id INT,
  UNIQUE KEY (roll, class_id),
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subject_id INT,
  class_id INT,
  session_code VARCHAR(100) UNIQUE,
  session_token VARCHAR(100),
  created_by VARCHAR(100),
  start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  end_time DATETIME,
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  FOREIGN KEY (class_id) REFERENCES classes(id)
);


CREATE TABLE IF NOT EXISTS attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT,
  student_id INT,
  roll VARCHAR(50),
  full_name VARCHAR(100),
  email VARCHAR(100),
  status VARCHAR(20),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (session_id, student_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (student_id) REFERENCES students(id)
);

CREATE TABLE IF NOT EXISTS class_students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  class_id INT,
  student_id INT,
  created_by VARCHAR(100),
  UNIQUE KEY (class_id, student_id),
  FOREIGN KEY (class_id) REFERENCES classes(id),
  FOREIGN KEY (student_id) REFERENCES students(id)
);