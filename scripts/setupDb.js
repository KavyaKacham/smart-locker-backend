require('dotenv').config();
const db = require('../config/db');

async function setupDatabase() {
  console.log('Setting up database...');

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      user_id     VARCHAR(20) UNIQUE NOT NULL,
      name        VARCHAR(100) NOT NULL,
      email       VARCHAR(150) UNIQUE NOT NULL,
      phone       VARCHAR(20) NOT NULL,
      pin_hash    VARCHAR(255) NOT NULL,
      role        VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      is_active   BOOLEAN DEFAULT true,
      created_at  TIMESTAMP DEFAULT NOW(),
      updated_at  TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('users table ready');

  await db.query(`
    CREATE TABLE IF NOT EXISTS lockers (
      id          SERIAL PRIMARY KEY,
      locker_code VARCHAR(20) UNIQUE NOT NULL,
      location    VARCHAR(100) NOT NULL,
      status      VARCHAR(20) DEFAULT 'available'
                  CHECK (status IN ('available', 'occupied', 'maintenance')),
      assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assigned_at TIMESTAMP,
      released_at TIMESTAMP,
      created_at  TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('lockers table ready');

  await db.query(`
    CREATE TABLE IF NOT EXISTS access_logs (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id),
      locker_id   INTEGER REFERENCES lockers(id),
      action      VARCHAR(30) NOT NULL
                  CHECK (action IN ('login_attempt','login_success','login_failed',
                                    'otp_sent','otp_success','otp_failed',
                                    'locker_opened','locker_closed','locker_assigned',
                                    'locker_released','esp32_unlock')),
      status      VARCHAR(20) DEFAULT 'success' CHECK (status IN ('success','failed')),
      ip_address  VARCHAR(50),
      device_info VARCHAR(100),
      notes       TEXT,
      created_at  TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('access_logs table ready');

  await db.query(`
    INSERT INTO lockers (locker_code, location) VALUES
      ('L001', 'Block A - Row 1'),
      ('L002', 'Block A - Row 1'),
      ('L003', 'Block A - Row 2'),
      ('L004', 'Block B - Row 1'),
      ('L005', 'Block B - Row 2')
    ON CONFLICT (locker_code) DO NOTHING;
  `);
  console.log('Sample lockers added');

  console.log('\nDatabase setup complete!');
  process.exit(0);
}

setupDatabase().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
