const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  // This line automatically handles SSL for Neon but ignores it for your local computer
  ssl: process.env.DB_HOST !== 'localhost' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('Unexpected DB error:', err);
});

// Initialize schema
async function initSchema() {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) DEFAULT 'user',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cars (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      model VARCHAR(100),
      year INTEGER,
      price_per_day NUMERIC(10,2) NOT NULL,
      seats INTEGER DEFAULT 5,
      transmission VARCHAR(20) DEFAULT 'Automatic',
      fuel VARCHAR(20) DEFAULT 'Petrol',
      image VARCHAR(255),
      description TEXT,
      available BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      car_id INTEGER REFERENCES cars(id) ON DELETE CASCADE,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      total_price NUMERIC(10,2) NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await pool.query(schema);
    console.log('✅ Schema ready');

    const adminCheck = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    if (adminCheck.rows.length === 0) {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash('admin123', 10);
      await pool.query(
        "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'admin')",
        ['Administrator', 'admin@carental.com', hash]
      );
      console.log('👤 Admin seeded: admin@carental.com / admin123');
    }

    const carCheck = await pool.query('SELECT id FROM cars LIMIT 1');
    if (carCheck.rows.length === 0) {
      const cars = [
        ['Mercedes-Benz C-Class', 'C200', 2022, 120.00, 5, 'Automatic', 'Petrol', '/images/benz.jpg', 'Luxury sedan with premium interior.'],
        ['Honda Civic', 'EX', 2021, 65.00, 5, 'Automatic', 'Petrol', '/images/civic.jpg', 'Reliable and efficient compact sedan.'],
        ['Toyota Corolla', 'LE', 2020, 55.00, 5, 'Automatic', 'Petrol', '/images/corolla.jpg', 'Fuel-efficient and dependable.'],
        ['Honda CR-V', 'EX-L', 2022, 85.00, 5, 'Automatic', 'Petrol', '/images/crv.jpg', 'Spacious SUV perfect for families.'],
        ['Hyundai Elantra', 'SEL', 2021, 60.00, 5, 'Automatic', 'Petrol', '/images/elantra.jpeg', 'Modern sedan with great mileage.'],
        ['Range Rover Sport', 'HSE', 2023, 200.00, 5, 'Automatic', 'Diesel', '/images/range-rover.jpeg', 'Premium luxury SUV.'],
        ['Kia Sportage', 'EX', 2022, 75.00, 5, 'Automatic', 'Petrol', '/images/sportage.jpeg', 'Stylish and versatile crossover.'],
        ['Toyota Camry', 'XSE', 2021, 70.00, 5, 'Automatic', 'Petrol', '/images/toyota camry.jpeg', 'Comfortable midsize sedan.'],
      ];
      for (const c of cars) {
        await pool.query(
          `INSERT INTO cars (name, model, year, price_per_day, seats, transmission, fuel, image, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          c
        );
      }
      console.log('🚗 Cars seeded');
    }
  } catch (err) {
    console.error('Schema init failed:', err);
    throw err;
  }
}

module.exports = { pool, initSchema };