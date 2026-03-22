const db = require('../config/db');

async function log({ userId, lockerId, action, status = 'success', ipAddress, deviceInfo, notes }) {
  try {
    await db.query(
      `INSERT INTO access_logs (user_id, locker_id, action, status, ip_address, device_info, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId || null, lockerId || null, action, status, ipAddress || null, deviceInfo || null, notes || null]
    );
  } catch (err) {
    console.error('Failed to write access log:', err.message);
  }
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
}

module.exports = { log, getClientIp };
