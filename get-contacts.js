const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const agentId = session.role === 'admin' && req.query.agentId
    ? req.query.agentId
    : session.agentId;

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const ids = await redis.lrange(`agent:${agentId}:contacts`, 0, 499);
    if (!ids || ids.length === 0) return res.status(200).json({ contacts: [] });

    const records = await Promise.all(ids.map(id => redis.get(id)));
    const contacts = records
      .filter(Boolean)
      .map(r => typeof r === 'string' ? JSON.parse(r) : r)
      .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));

    res.status(200).json({ contacts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
