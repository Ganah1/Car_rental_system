require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const flash = require('connect-flash');
const bcrypt = require('bcryptjs');
const { pool, initSchema } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 1 day
  })
);
app.use(flash());

// Globals for templates
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.active = '';
  next();
});

// Helpers
function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Please log in first.');
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    req.flash('error', 'Admin access required.');
    return res.redirect('/');
  }
  next();
}

// ====== ROUTES ======

// HOME — show available cars with search
app.get('/', async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const q = search
      ? `SELECT * FROM cars WHERE available = TRUE AND (name ILIKE $1 OR model ILIKE $1) ORDER BY id`
      : `SELECT * FROM cars WHERE available = TRUE ORDER BY id`;
    const params = search ? [`%${search}%`] : [];
    const { rows: cars } = await pool.query(q, params);
    res.render('home', { cars, search, active: 'home' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// REGISTER
app.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('register', { active: 'register' });
});

app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    if (!name || !email || !password) {
      req.flash('error', 'All fields are required.');
      return res.redirect('/register');
    }
    if (password.length < 6) {
      req.flash('error', 'Password must be at least 6 characters.');
      return res.redirect('/register');
    }
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) {
      req.flash('error', 'Email already registered.');
      return res.redirect('/register');
    }
    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1,$2,$3)',
      [name, email, hash]
    );
    req.flash('success', 'Account created. Please log in.');
    res.redirect('/login');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Registration failed.');
    res.redirect('/register');
  }
});

// LOGIN
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { active: 'login' });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (rows.length === 0) {
      req.flash('error', 'Invalid credentials.');
      return res.redirect('/login');
    }
    const user = rows[0];
    if (!user.is_active) {
      req.flash('error', 'Account disabled. Contact admin.');
      return res.redirect('/login');
    }
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      req.flash('error', 'Invalid credentials.');
      return res.redirect('/login');
    }
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
    req.flash('success', `Welcome back, ${user.name}!`);
    res.redirect(user.role === 'admin' ? '/admin' : '/');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Login failed.');
    res.redirect('/login');
  }
});

// LOGOUT
app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// CAR DETAILS
app.get('/cars/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM cars WHERE id = $1', [req.params.id]);
    if (rows.length === 0) {
      req.flash('error', 'Car not found.');
      return res.redirect('/');
    }
    res.render('car', { car: rows[0], active: 'home' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// BOOK A CAR
app.post('/book/:id', requireAuth, async (req, res) => {
  const carId = req.params.id;
  const { start_date, end_date } = req.body;
  try {
    if (!start_date || !end_date) {
      req.flash('error', 'Select start and end dates.');
      return res.redirect(`/cars/${carId}`);
    }
    const start = new Date(start_date);
    const end = new Date(end_date);
    if (isNaN(start) || isNaN(end) || end <= start) {
      req.flash('error', 'End date must be after start date.');
      return res.redirect(`/cars/${carId}`);
    }
    const carRes = await pool.query('SELECT * FROM cars WHERE id = $1 AND available = TRUE', [carId]);
    if (carRes.rows.length === 0) {
      req.flash('error', 'Car not available.');
      return res.redirect('/');
    }
    const car = carRes.rows[0];
    const days = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
    const total = (Number(car.price_per_day) * days).toFixed(2);

    await pool.query(
      `INSERT INTO bookings (user_id, car_id, start_date, end_date, total_price, status)
       VALUES ($1,$2,$3,$4,$5,'pending')`,
      [req.session.user.id, carId, start_date, end_date, total]
    );
    req.flash('success', 'Booking request submitted. Await admin confirmation.');
    res.redirect('/bookings');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Booking failed.');
    res.redirect(`/cars/${carId}`);
  }
});

// MY BOOKINGS
app.get('/bookings', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*, c.name AS car_name, c.image AS car_image, c.model AS car_model
       FROM bookings b JOIN cars c ON b.car_id = c.id
       WHERE b.user_id = $1 ORDER BY b.created_at DESC`,
      [req.session.user.id]
    );
    res.render('bookings', { bookings: rows, active: 'bookings' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// CANCEL BOOKING
app.post('/bookings/:id/cancel', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM bookings WHERE id = $1 AND user_id = $2',
      [req.params.id, req.session.user.id]
    );
    if (rows.length === 0) {
      req.flash('error', 'Booking not found.');
      return res.redirect('/bookings');
    }
    const booking = rows[0];
    if (!['pending', 'confirmed'].includes(booking.status)) {
      req.flash('error', 'This booking cannot be cancelled.');
      return res.redirect('/bookings');
    }
    await pool.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [booking.id]);
    req.flash('success', 'Booking cancelled.');
    res.redirect('/bookings');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Cancellation failed.');
    res.redirect('/bookings');
  }
});

// ====== ADMIN ROUTES ======

// ADMIN DASHBOARD
app.get('/admin', requireAdmin, async (req, res) => {
  try {
    const cars = (await pool.query('SELECT * FROM cars ORDER BY id')).rows;
    const bookings = (await pool.query(
      `SELECT b.*, u.name AS user_name, u.email AS user_email, c.name AS car_name
       FROM bookings b JOIN users u ON b.user_id = u.id JOIN cars c ON b.car_id = c.id
       ORDER BY b.created_at DESC`
    )).rows;
    const users = (await pool.query('SELECT id, name, email, role, is_active, created_at FROM users ORDER BY id')).rows;

    const stats = {
      totalCars: cars.length,
      availableCars: cars.filter(c => c.available).length,
      totalBookings: bookings.length,
      pendingBookings: bookings.filter(b => b.status === 'pending').length,
      totalUsers: users.length,
    };

    res.render('admin', { cars, bookings, users, stats, active: 'admin' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// ADD CAR
app.post('/admin/cars', requireAdmin, async (req, res) => {
  const { name, model, year, price_per_day, seats, transmission, fuel, image, description } = req.body;
  try {
    await pool.query(
      `INSERT INTO cars (name, model, year, price_per_day, seats, transmission, fuel, image, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [name, model, year || null, price_per_day, seats || 5, transmission || 'Automatic', fuel || 'Petrol', image || '', description || '']
    );
    req.flash('success', 'Car added.');
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to add car.');
    res.redirect('/admin');
  }
});

// UPDATE CAR
app.post('/admin/cars/:id/update', requireAdmin, async (req, res) => {
  const { name, model, year, price_per_day, seats, transmission, fuel, image, description, available } = req.body;
  try {
    await pool.query(
      `UPDATE cars SET name=$1, model=$2, year=$3, price_per_day=$4, seats=$5,
       transmission=$6, fuel=$7, image=$8, description=$9, available=$10 WHERE id=$11`,
      [name, model, year || null, price_per_day, seats || 5, transmission, fuel, image, description, available === 'on', req.params.id]
    );
    req.flash('success', 'Car updated.');
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update car.');
    res.redirect('/admin');
  }
});

// DELETE CAR
app.post('/admin/cars/:id/delete', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM cars WHERE id = $1', [req.params.id]);
    req.flash('success', 'Car deleted.');
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete car.');
    res.redirect('/admin');
  }
});

// UPDATE BOOKING STATUS (confirm / reject)
app.post('/admin/bookings/:id/status', requireAdmin, async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'confirmed', 'rejected', 'cancelled', 'completed'].includes(status)) {
    req.flash('error', 'Invalid status.');
    return res.redirect('/admin');
  }
  try {
    await pool.query('UPDATE bookings SET status = $1 WHERE id = $2', [status, req.params.id]);
    req.flash('success', `Booking marked as ${status}.`);
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Update failed.');
    res.redirect('/admin');
  }
});

// USERS LIST PAGE
app.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, is_active, created_at FROM users ORDER BY id'
    );
    res.render('users', { users: rows, active: 'admin' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// TOGGLE USER ACCESS
app.post('/admin/users/:id/toggle', requireAdmin, async (req, res) => {
  try {
    if (Number(req.params.id) === req.session.user.id) {
      req.flash('error', 'You cannot disable your own account.');
      return res.redirect('/admin/users');
    }
    await pool.query('UPDATE users SET is_active = NOT is_active WHERE id = $1', [req.params.id]);
    req.flash('success', 'User access updated.');
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Update failed.');
    res.redirect('/admin/users');
  }
});

// CHANGE ROLE
app.post('/admin/users/:id/role', requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) {
    req.flash('error', 'Invalid role.');
    return res.redirect('/admin/users');
  }
  try {
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, req.params.id]);
    req.flash('success', 'Role updated.');
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Update failed.');
    res.redirect('/admin/users');
  }
});

// 404
app.use((req, res) => {
  res.status(404).render('404', { active: '' });
});

// Start
(async () => {
  try {
    await initSchema();
    app.listen(PORT, () => {
      console.log(`🚀 Server running: http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Startup failed:', err);
    process.exit(1);
  }
})();