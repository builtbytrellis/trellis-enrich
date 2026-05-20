const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const agentId = (session.role === 'admin' && req.query.agentId) ? req.query.agentId : session.agentId;

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const raw = await redis.get(`last_push_debug:${agentId}`);
    if (!raw) return res.status(200).json({ debug: null, note: 'no recent push debug record' });
    return res.status(200).json({ debug: typeof raw === 'string' ? JSON.parse(raw) : raw });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
