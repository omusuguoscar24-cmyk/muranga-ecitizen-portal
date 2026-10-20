const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'ecitizen.db'));

db.serialize(() => {
  // Create Users Table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT CHECK(role IN ('citizen', 'admin')) DEFAULT 'citizen',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create Requests Table
  db.run(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      location TEXT NOT NULL,
      description TEXT NOT NULL,
      image_path TEXT,
      status TEXT CHECK(status IN ('Pending', 'In Progress', 'Resolved')) DEFAULT 'Pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Safely add missing columns to existing databases
  db.run(`ALTER TABLE requests ADD COLUMN ticket_number TEXT`, () => {});
  db.run(`ALTER TABLE requests ADD COLUMN priority TEXT DEFAULT 'Normal'`, () => {});
  db.run(`ALTER TABLE requests ADD COLUMN assigned_to TEXT DEFAULT 'Unassigned'`, (err) => {
    if (err) {
      // Column already exists, ignore error
    } else {
      console.log('✅ Added assigned_to column to database');
    }
  });

  // Seed Default Admin User
  const adminEmail = 'admin@muranga.go.ke';
  db.get('SELECT * FROM users WHERE email = ?', [adminEmail], (err, row) => {
    if (err) {
      console.error('Error checking admin user:', err);
      return;
    }

    if (!row) {
      const hashedPassword = bcrypt.hashSync('Admin@2026', 10);
      db.run(
        'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
        ["County Admin (Murang'a)", adminEmail, hashedPassword, 'admin']
      );
      console.log('✅ Default Admin created');
    }
  });
});

module.exports = db;