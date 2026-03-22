const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../config/db');
const { generateOTP, storeOTP, verifyOTP, sendOTP } = require('../services/otpService');
const { log, getClientIp } = require('../services/logService');
 
const router = express.Router();
 
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Too many login attempts, try again in 15 minutes' } });
const otpLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 5,
  message: { error: 'Too many OTP attempts' } });
 
// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { userId, name, email, phone, pin } = req.body;
  if (!userId || !name || !email || !phone || !pin)
    return res.status(400).json({ error: 'All fields required: userId, name, email, phone, pin' });
  if (pin.length < 4 || pin.length > 8)
    return res.status(400).json({ error: 'PIN must be 4-8 digits' });
  try {
    const existing = await db.query('SELECT id FROM users WHERE user_id=$1 OR email=$2', [userId, email]);
    if (existing.rows.length > 0)
      return res.status(409).json({ error: 'User ID or email already exists' });
    const pinHash = await bcrypt.hash(pin, 12);
    const result = await db.query(
      `INSERT INTO users (user_id, name, email, phone, pin_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, user_id, name, email, phone`,
      [userId, name, email, phone, pinHash]
    );
    res.status(201).json({ message: 'Registered successfully', user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});
 
// POST /api/auth/login  — Step 1: verify PIN, send OTP
router.post('/login', loginLimiter, async (req, res) => {
  const { userId, pin } = req.body;
  const ip = getClientIp(req);
  if (!userId || !pin) return res.status(400).json({ error: 'userId and pin required' });
  try {
    const result = await db.query(
      'SELECT id, user_id, name, phone, email, pin_hash, role, is_active FROM users WHERE user_id=$1',
      [userId]
    );
    if (result.rows.length === 0) {
      await log({ action: 'login_failed', status: 'failed', ipAddress: ip, notes: `Unknown userId: ${userId}` });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = result.rows[0];
    if (!user.is_active) return res.status(403).json({ error: 'Account is disabled' });
    const pinMatch = await bcrypt.compare(pin, user.pin_hash);
    if (!pinMatch) {
      await log({ userId: user.id, action: 'login_failed', status: 'failed', ipAddress: ip });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const otp = generateOTP();
    await storeOTP(user.id, otp);
    await sendOTP(user.phone, otp, user.user_id);
    await log({ userId: user.id, action: 'otp_sent', ipAddress: ip });
 
    const response = {
      message: 'PIN verified. OTP sent to your registered phone.',
      userId: user.id,
      name: user.name,
      otpSentTo: user.phone.replace(/(\d{2})\d+(\d{2})/, '$1****$2'),
    };
 
    if (process.env.OTP_DELIVERY === 'console') {
      response.otp = otp;
      response.demoMode = true;
    }
 
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});
 
// POST /api/auth/verify-otp  — Step 2: verify OTP, return JWT (for App)
router.post('/verify-otp', otpLimiter, async (req, res) => {
  const { userId, otp } = req.body;
  const ip = getClientIp(req);
  if (!userId || !otp) return res.status(400).json({ error: 'userId and otp required' });
  try {
    const result = await db.query('SELECT id, user_id, name, role FROM users WHERE id=$1', [userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = result.rows[0];
    const { valid, reason } = await verifyOTP(userId, otp);
    if (!valid) {
      await log({ userId: user.id, action: 'otp_failed', status: 'failed', ipAddress: ip, notes: reason });
      return res.status(401).json({ error: reason || 'OTP verification failed' });
    }
    const token = jwt.sign(
      { id: user.id, userId: user.user_id, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );
    await log({ userId: user.id, action: 'otp_success', ipAddress: ip });
    res.json({ message: 'Authentication successful', token,
      user: { id: user.id, userId: user.user_id, name: user.name, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'OTP verification failed' });
  }
});
 
// POST /api/auth/esp32/verify  — Called by ESP32 keypad
router.post('/esp32/verify', async (req, res) => {
  const { userId, otp, lockerId, espDeviceId } = req.body;
  const ip = getClientIp(req);
  if (!userId || !otp || !lockerId)
    return res.status(400).json({ error: 'userId, otp, and lockerId required' });
  try {
    const userResult = await db.query('SELECT id, user_id, name FROM users WHERE id=$1', [userId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = userResult.rows[0];
 
    const lockerResult = await db.query(
      'SELECT id, locker_code, status, assigned_to FROM lockers WHERE id=$1', [lockerId]);
    if (lockerResult.rows.length === 0) return res.status(404).json({ error: 'Locker not found' });
    const locker = lockerResult.rows[0];
 
    if (locker.assigned_to !== user.id) {
      await log({ userId: user.id, lockerId: locker.id, action: 'esp32_unlock', status: 'failed',
        ipAddress: ip, deviceInfo: espDeviceId, notes: 'Locker not assigned to this user' });
      return res.status(403).json({ error: 'This locker is not assigned to you' });
    }
    const { valid, reason } = await verifyOTP(userId, otp);
    if (!valid) {
      await log({ userId: user.id, lockerId: locker.id, action: 'otp_failed', status: 'failed',
        ipAddress: ip, deviceInfo: espDeviceId, notes: reason });
      return res.status(401).json({ error: reason || 'OTP verification failed' });
    }
    await log({ userId: user.id, lockerId: locker.id, action: 'esp32_unlock',
      ipAddress: ip, deviceInfo: espDeviceId });
    await log({ userId: user.id, lockerId: locker.id, action: 'locker_opened', ipAddress: ip });
    res.json({ success: true, action: 'unlock', lockerCode: locker.locker_code,
      message: `Access granted. Unlock locker ${locker.locker_code}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verification failed' });
  }
});
 
module.exports = router;
 