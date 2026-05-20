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
    const limit = parseInt(req.query.limit) || 500;
    const ids = await redis.lrange(`agent:${agentId}:trades`, 0, limit - 1);
    if (!ids || !ids.length) return res.status(200).json({ trades: [] });

    const raws = await Promise.all(ids.map(id => redis.get(id)));
    const trades = ids
      .map((id, i) => {
        const raw = raws[i];
        if (!raw) return null;
        const t = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return { ...t, _tradeId: id };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));

    return res.status(200).json({ trades });
  } catch (e) {
    console.error('get-trades error:', e);
    return res.status(500).json({ error: e.message });
  }
};
