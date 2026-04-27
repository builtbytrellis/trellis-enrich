const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const { key } = req.query;
  if (!key) return res.status(400).json({ error: 'Missing key' });

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const raw = await redis.get(key);
    if (!raw) return res.status(404).json({ error: 'Token not found or expired' });
    
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    
    // Delete the temp key after retrieval
    await redis.del(key);
    
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
