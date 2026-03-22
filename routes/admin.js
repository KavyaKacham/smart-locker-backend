const express = require('express');
const db = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireAdmin);

// GET /api/admin/logs
router.get('/logs', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  try {
    const result = await db.query(
      `SELECT al.id, al.action, al.status, al.ip_address, al.device_info,
              al.notes, al.created_at, u.name AS user_name, u.user_id, l.locker_code
       FROM access_logs al
       LEFT JOIN users u ON al.user_id = u.id
       LEFT JOIN lockers l ON al.locker_id = l.id
       ORDER BY al.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const countResult = await db.query('SELECT COUNT(*) FROM access_logs');
    const total = parseInt(countResult.rows[0].count);
    res.json({ logs: result.rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch logs' }); }
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.user_id, u.name, u.email, u.phone, u.role, u.is_active, u.created_at,
              l.locker_code AS assigned_locker
       FROM users u LEFT JOIN lockers l ON l.assigned_to = u.id ORDER BY u.created_at DESC`
    );
    res.json({ users: result.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch users' }); }
});

// PATCH /api/admin/users/:id/toggle
router.patch('/users/:id/toggle', async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE users SET is_active = NOT is_active WHERE id=$1 RETURNING id, user_id, name, is_active`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Failed to update user' }); }
});

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [users, lockers, logs, recentActivity] = await Promise.all([
      db.query('SELECT COUNT(*) AS total, SUM(CASE WHEN is_active THEN 1 ELSE 0 END) AS active FROM users'),
      db.query(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) AS available,
        SUM(CASE WHEN status='occupied' THEN 1 ELSE 0 END) AS occupied FROM lockers`),
      db.query(`SELECT COUNT(*) AS total_today FROM access_logs WHERE created_at > NOW() - INTERVAL '24 hours'`),
      db.query(`SELECT al.action, al.status, al.created_at, u.name, l.locker_code
        FROM access_logs al LEFT JOIN users u ON al.user_id=u.id LEFT JOIN lockers l ON al.locker_id=l.id
        ORDER BY al.created_at DESC LIMIT 10`),
    ]);
    res.json({ users: users.rows[0], lockers: lockers.rows[0],
      activity: logs.rows[0], recentActivity: recentActivity.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch stats' }); }
});

module.exports = router;
