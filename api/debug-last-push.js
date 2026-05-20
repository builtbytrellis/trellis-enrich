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
    const [perAgentRaw, globalRaw] = await Promise.all([
      redis.get(`last_push_debug:${agentId}`),
      redis.get('last_push_debug_global'),
    ]);
    const parse = v => v ? (typeof v === 'string' ? JSON.parse(v) : v) : null;
    const perAgent = parse(perAgentRaw);
    const global = parse(globalRaw);
    return res.status(200).json({
      debug: perAgent,
      global,
      note: (!perAgent && !global) ? 'no recent push debug record' : undefined,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
