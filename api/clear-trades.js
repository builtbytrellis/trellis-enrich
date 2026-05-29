const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await verifySession(req, res);
  if (!session) return;

  const { targetAgentId } = req.body;
  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

    // Get all trade IDs for this agent
    const tradeIds = await redis.lrange(`agent:${agentId}:trades`, 0, -1);

    // Delete each trade record
    let deleted = 0;
    for (const id of tradeIds) {
      await redis.del(id);
      deleted++;
    }

    // Clear the trades list
    await redis.del(`agent:${agentId}:trades`);

    return res.status(200).json({ success: true, deleted });
  } catch (e) {
    console.error('clear-trades error:', e);
    return res.status(500).json({ error: e.message });
  }
};
