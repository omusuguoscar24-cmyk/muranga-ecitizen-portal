const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const db = require('./database');

const app = express();

// Ensure uploads directory exists cleanly on server startup
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Storage Configuration for Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

app.use(session({
  secret: 'ecitizen-muranga-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Access Control Middlewares
const requireAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/login');
  next();
};

const requireCitizen = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'citizen') return res.redirect('/login');
  next();
};

// --- AUTH ROUTES ---

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  return req.session.user.role === 'admin' ? res.redirect('/admin/dashboard') : res.redirect('/citizen/dashboard');
});

app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (user && bcrypt.compareSync(password, user.password)) {
      req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
      return user.role === 'admin' ? res.redirect('/admin/dashboard') : res.redirect('/citizen/dashboard');
    }
    res.render('login', { error: 'Invalid email or password credentials.' });
  });
});

app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  const hashedPassword = bcrypt.hashSync(password, 10);
  db.run(
    'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
    [name, email, hashedPassword, 'citizen'],
    function(err) {
      if (err) return res.render('register', { error: 'Email address is already registered.' });
      res.redirect('/login');
    }
  );
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// --- CITIZEN DASHBOARD ROUTES ---

app.get('/citizen/dashboard', requireCitizen, (req, res) => {
  db.all(
    'SELECT * FROM requests WHERE user_id = ? ORDER BY created_at DESC',
    [req.session.user.id],
    (err, requests) => {
      res.render('citizen-dashboard', { user: req.session.user, requests: requests || [] });
    }
  );
});

// Single, clean route for citizen submission
app.post('/citizen/submit-request', requireCitizen, upload.single('image'), (req, res) => {
  const { category, location, description } = req.body;
  const image_path = req.file ? `/uploads/${req.file.filename}` : null;
  const ticket_number = 'MRC-' + Math.floor(100000 + Math.random() * 900000);

  db.run(
    'INSERT INTO requests (user_id, category, location, description, image_path, ticket_number, status, assigned_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [req.session.user.id, category, location, description, image_path, ticket_number, 'Pending', 'Unassigned'],
    (err) => {
      if (err) {
        console.error('Submission DB Error:', err);
        return res.status(500).send("Database error occurred while filing report.");
      }
      res.redirect('/citizen/dashboard');
    }
  );
});

// --- ADMIN DASHBOARD ROUTES ---

app.get('/admin/dashboard', requireAdmin, (req, res) => {
  const filterCategory = req.query.category || '';
  const filterStatus = req.query.status || '';

  let sql = `
    SELECT requests.*, users.name as citizen_name, users.email as citizen_email 
    FROM requests 
    JOIN users ON requests.user_id = users.id 
    WHERE 1=1
  `;
  const params = [];

  if (filterCategory) { sql += ' AND requests.category = ?'; params.push(filterCategory); }
  if (filterStatus) { sql += ' AND requests.status = ?'; params.push(filterStatus); }
  sql += ' ORDER BY requests.created_at DESC';

  db.all(sql, params, (err, requests) => {
    db.all('SELECT status FROM requests', [], (err, allRows) => {
      const rows = allRows || [];
      const analytics = {
        total: rows.length,
        pending: rows.filter(r => r.status === 'Pending').length,
        inProgress: rows.filter(r => r.status === 'In Progress').length,
        resolved: rows.filter(r => r.status === 'Resolved').length
      };

      res.render('admin-dashboard', {
        user: req.session.user,
        requests: requests || [],
        analytics,
        filters: { category: filterCategory, status: filterStatus }
      });
    });
  });
});

app.get('/admin/export-csv', requireAdmin, (req, res) => {
  db.all('SELECT requests.*, users.name, users.email FROM requests JOIN users ON requests.user_id = users.id', [], (err, rows) => {
    let csv = 'Ticket Number,Citizen,Email,Category,Location,Status,Assigned Department,Date\n';
    (rows || []).forEach(r => {
      csv += `"${r.ticket_number || 'N/A'}","${r.name}","${r.email}","${r.category}","${r.location}","${r.status}","${r.assigned_to || 'Unassigned'}","${r.created_at}"\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=muranga_county_service_report.csv');
    res.status(200).send(csv);
  });
});

app.post('/admin/update-status/:id', requireAdmin, (req, res) => {
  const { status, assigned_to } = req.body;
  
  db.run(
    'UPDATE requests SET status = ?, assigned_to = ? WHERE id = ?',
    [status, assigned_to || 'Unassigned', req.params.id],
    (err) => {
      if (err) {
        console.error('Update Error:', err.message);
      }
      res.redirect('/admin/dashboard');
    }
  );
});

// --- SERVER BINDING FOR RENDER ---

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 eCitizen Portal active on port ${PORT}`));
