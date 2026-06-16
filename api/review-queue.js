const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const { action, targetAgentId, items, itemId, note, status } = req.body || {};
  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;
  const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  const KEY = `agent:${agentId}:review_queue`;

  try {
    if (action === 'add') {
      const existing = await redis.get(KEY);
      const queue = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : [];
      const seen = new Set(queue.map(q => (q.name||'').toLowerCase() + '|' + (q.reason||'')));
      let added = 0;
      for (const it of (items || [])) {
        const k = (it.name||'').toLowerCase() + '|' + (it.reason||'');
        if (seen.has(k)) continue;
        queue.push({
          id: 'rv' + Date.now() + Math.random().toString(36).slice(2),
          name: it.name,
          reason: it.reason || '',
          detail: it.detail || '',
          birthday: it.birthday || '',
          occupation: it.occupation || '',
          address: it.address || '',
          year: it.year || '',
          status: 'pending',
          note: '',
          addedAt: new Date().toISOString()
        });
        seen.add(k);
        added++;
      }
      await redis.set(KEY, JSON.stringify(queue));
      return res.status(200).json({ success: true, added, total: queue.length });
    }

    if (action === 'list') {
      const existing = await redis.get(KEY);
      const queue = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : [];
      return res.status(200).json({ success: true, items: queue });
    }

    if (action === 'update') {
      const existing = await redis.get(KEY);
      let queue = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : [];
      const item = queue.find(q => q.id === itemId);
      if (!item) return res.status(404).json({ error: 'Item not found' });
      if (note !== undefined) item.note = note;
      if (status !== undefined) item.status = status;
      item.updatedAt = new Date().toISOString();
      await redis.set(KEY, JSON.stringify(queue));
      return res.status(200).json({ success: true });
    }

    if (action === 'clear') {
      await redis.del(KEY);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
