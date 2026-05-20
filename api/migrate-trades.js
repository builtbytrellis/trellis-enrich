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
  if (session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const { fromAgentId, toAgentId } = req.body;
  if (!fromAgentId || !toAgentId) return res.status(400).json({ error: 'fromAgentId and toAgentId required' });
  if (fromAgentId === toAgentId) return res.status(400).json({ error: 'fromAgentId and toAgentId must differ' });

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

    const fromKey = `agent:${fromAgentId}:trades`;
    const toKey = `agent:${toAgentId}:trades`;

    const ids = await redis.lrange(fromKey, 0, 9999);
    if (!ids || !ids.length) return res.status(200).json({ migrated: 0, note: 'no trades to migrate' });

    // Rewrite each trade record with the new agentId (the key prefix stays the
    // same — we don't rename Redis keys, we just update agentId on the value).
    let updated = 0;
    for (const id of ids) {
      const raw = await redis.get(id);
      if (!raw) continue;
      const trade = typeof raw === 'string' ? JSON.parse(raw) : raw;
      trade.agentId = toAgentId;
      trade.migratedFrom = fromAgentId;
      trade.migratedAt = new Date().toISOString();
      await redis.set(id, JSON.stringify(trade));
      updated++;
    }

    // Move list entries: append all ids to the target list, then delete the source list.
    if (ids.length) {
      await redis.lpush(toKey, ...ids);
      await redis.ltrim(toKey, 0, 999);
      await redis.del(fromKey);
    }

    return res.status(200).json({ migrated: updated, totalIds: ids.length, fromAgentId, toAgentId });
  } catch (e) {
    console.error('migrate-trades error:', e);
    return res.status(500).json({ error: e.message });
  }
};
