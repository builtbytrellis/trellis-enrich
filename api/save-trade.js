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

  const { trade, targetAgentId } = req.body;
  if (!trade) return res.status(400).json({ error: 'Trade required' });

  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const tradeId = `trade:${agentId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const tradeData = { ...trade, savedAt: new Date().toISOString(), agentId };

    await redis.set(tradeId, JSON.stringify(tradeData));
    await redis.lpush(`agent:${agentId}:trades`, tradeId);
    await redis.ltrim(`agent:${agentId}:trades`, 0, 999);

    return res.status(200).json({ success: true, tradeId });
  } catch (e) {
    console.error('save-trade error:', e);
    return res.status(500).json({ error: e.message });
  }
};
