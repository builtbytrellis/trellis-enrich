const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

function normName(n) { return (n||'').toLowerCase().replace(/\s+/g,' ').trim(); }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const { targetAgentId } = req.body || {};
  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

    const tradeIds = await redis.lrange(`agent:${agentId}:trades`, 0, -1);
    const raws = tradeIds.length ? await Promise.all(tradeIds.map(id => redis.get(id))) : [];

    const seen = new Set();
    const keepIds = [];
    const deleteIds = [];

    for (let i = 0; i < tradeIds.length; i++) {
      const raw = raws[i];
      if (!raw) { deleteIds.push(tradeIds[i]); continue; }
      const t = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const key = `${normName(t.property_address)}|${t.close_date || ''}|${t.agent_side || ''}|${normName(t.buyer_or_tenant_name || t.client_name || '')}`;
      if (seen.has(key)) {
        deleteIds.push(tradeIds[i]);
      } else {
        seen.add(key);
        keepIds.push(tradeIds[i]);
      }
    }

    // Delete duplicate records and rebuild the list
    for (const id of deleteIds) await redis.del(id);
    await redis.del(`agent:${agentId}:trades`);
    if (keepIds.length) {
      // lpush reverses order; push in reverse to preserve
      for (let i = keepIds.length - 1; i >= 0; i--) {
        await redis.lpush(`agent:${agentId}:trades`, keepIds[i]);
      }
    }

    return res.status(200).json({
      success: true,
      kept: keepIds.length,
      removed: deleteIds.length
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
