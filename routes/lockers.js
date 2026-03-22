const express = require('express');
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { log, getClientIp } = require('../services/logService');

const router = express.Router();

// GET /api/lockers/available
router.get('/available', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, locker_code, location FROM lockers WHERE status='available' ORDER BY locker_code`
    );
    res.json({ lockers: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch lockers' }); }
});

// GET /api/lockers/my
router.get('/my', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, locker_code, location, status, assigned_at FROM lockers WHERE assigned_to=$1`,
      [req.user.id]
    );
    res.json({ locker: result.rows[0] || null });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch your locker' }); }
});

// GET /api/lockers/all
router.get('/all', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT l.id, l.locker_code, l.location, l.status, l.assigned_at,
              u.name AS assigned_user_name, u.user_id AS assigned_user_id
       FROM lockers l LEFT JOIN users u ON l.assigned_to = u.id ORDER BY l.locker_code`
    );
    res.json({ lockers: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch lockers' }); }
});

// POST /api/lockers/assign
router.post('/assign', authenticate, async (req, res) => {
  const ip = getClientIp(req);
  const userId = req.user.id;
  try {
    const existing = await db.query('SELECT id FROM lockers WHERE assigned_to=$1', [userId]);
    if (existing.rows.length > 0)
      return res.status(409).json({ error: 'You already have a locker assigned' });
    const { lockerId } = req.body;
    let result;
    if (lockerId) {
      result = await db.query(
        `UPDATE lockers SET status='occupied', assigned_to=$1, assigned_at=NOW()
         WHERE id=$2 AND status='available' RETURNING id, locker_code, location`,
        [userId, lockerId]
      );
    } else {
      result = await db.query(
        `UPDATE lockers SET status='occupied', assigned_to=$1, assigned_at=NOW()
         WHERE id=(SELECT id FROM lockers WHERE status='available' ORDER BY locker_code LIMIT 1)
         RETURNING id, locker_code, location`,
        [userId]
      );
    }
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'No available locker found' });
    const locker = result.rows[0];
    await log({ userId, lockerId: locker.id, action: 'locker_assigned', ipAddress: ip });
    res.json({ message: `Locker ${locker.locker_code} assigned successfully`, locker });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to assign locker' }); }
});

// POST /api/lockers/release
router.post('/release', authenticate, async (req, res) => {
  const ip = getClientIp(req);
  const userId = req.user.id;
  try {
    const result = await db.query(
      `UPDATE lockers SET status='available', assigned_to=NULL, released_at=NOW()
       WHERE assigned_to=$1 RETURNING id, locker_code`,
      [userId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'You have no locker to release' });
    const locker = result.rows[0];
    await log({ userId, lockerId: locker.id, action: 'locker_released', ipAddress: ip });
    res.json({ message: `Locker ${locker.locker_code} released successfully` });
  } catch (err) { res.status(500).json({ error: 'Failed to release locker' }); }
});

module.exports = router;
