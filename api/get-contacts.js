const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  // Admin can fetch any agent's contacts
  const agentId = (session.role === 'admin' && req.query.agentId)
    ? req.query.agentId
    : session.agentId;

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const limit = parseInt(req.query.limit) || 500;
    if (limit === 0) return res.status(200).json({ contacts: [] });

    const ids = await redis.lrange(`agent:${agentId}:contacts`, 0, limit - 1);
    if (!ids || !ids.length) return res.status(200).json({ contacts: [] });

    const contacts = await Promise.all(ids.map(id => redis.get(id)));
    const parsed = contacts
      .filter(Boolean)
      .map(c => typeof c === 'string' ? JSON.parse(c) : c)
      .sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));

    return res.status(200).json({ contacts: parsed });
  } catch(e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
