const redis = require('../config/redis');

const OTP_PREFIX = 'otp:';
const EXPIRY = parseInt(process.env.OTP_EXPIRY_SECONDS || '300');

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function storeOTP(userId, otp) {
  const key = OTP_PREFIX + userId;
  await redis.setex(key, EXPIRY, otp);
}

async function verifyOTP(userId, inputOtp) {
  const key = OTP_PREFIX + userId;
  const storedOtp = await redis.get(key);
  if (!storedOtp) return { valid: false, reason: 'OTP expired or not found' };
  if (storedOtp !== inputOtp.trim()) return { valid: false, reason: 'Incorrect OTP' };
  await redis.del(key);
  return { valid: true };
}

async function sendOTP(phone, otp, userId) {
  const delivery = process.env.OTP_DELIVERY || 'console';
  if (delivery === 'console') {
    console.log('\n==================================');
    console.log(`OTP for user ${userId}: ${otp}`);
    console.log('==================================\n');
    return { sent: true, method: 'console' };
  }
  if (delivery === 'twilio') {
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      body: `Your Smart Locker OTP is: ${otp}. Valid for ${EXPIRY / 60} minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone,
    });
    return { sent: true, method: 'sms' };
  }
  return { sent: false };
}

module.exports = { generateOTP, storeOTP, verifyOTP, sendOTP };
