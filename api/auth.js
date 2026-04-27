const { Redis } = require('@upstash/redis');

// Call this at the top of any protected API route
async function verifySession(req, res) {
  const token = req.headers['x-session-token'] || req.query.token;
  if (!token) { res.status(401).json({ error: 'Not authenticated' }); return null; }

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const raw = await redis.get(`session:${token}`);
    if (!raw) { res.status(401).json({ error: 'Session expired' }); return null; }
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    res.status(500).json({ error: 'Auth error' }); return null;
  }
}

module.exports = { verifySession };
