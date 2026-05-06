const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  const agentId = (session.role === 'admin' && req.query.agentId) ? req.query.agentId : session.agentId;
  const queueKey = 'queue:' + agentId;

  try {
    if (req.method === 'GET') {
      const raw = await redis.get(queueKey);
      const queue = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      return res.status(200).json({ queue });
    }

    if (req.method === 'POST') {
      const { contact } = req.body;
      if (!contact || !contact.id) return res.status(400).json({ error: 'Contact with id required' });
      const raw = await redis.get(queueKey);
      const queue = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      const existing = queue.findIndex(c => c.id === contact.id);
      if (existing >= 0) queue[existing] = contact;
      else queue.unshift(contact);
      await redis.set(queueKey, JSON.stringify(queue.slice(0, 1000)));
      return res.status(200).json({ success: true });
    }

    if (req.method === 'PUT') {
      const { id, status, result, approved_tags } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const raw = await redis.get(queueKey);
      const queue = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      const idx = queue.findIndex(c => c.id === id);
      if (idx >= 0) {
        if (status) queue[idx].status = status;
        if (result) queue[idx].result = result;
        if (approved_tags !== undefined) queue[idx].approved_tags = approved_tags;
        queue[idx].updatedAt = new Date().toISOString();
      }
      await redis.set(queueKey, JSON.stringify(queue));
      return res.status(200).json({ success: true });
    }

    if (req.method === 'DELETE') {
      const { id, clearAll } = req.body;
      if (clearAll) { await redis.del(queueKey); return res.status(200).json({ success: true }); }
      if (!id) return res.status(400).json({ error: 'id or clearAll required' });
      const raw = await redis.get(queueKey);
      const queue = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      await redis.set(queueKey, JSON.stringify(queue.filter(c => c.id !== id)));
      return res.status(200).json({ success: true });
    }

  } catch(e) {
    console.error('Queue API error:', e);
    return res.status(500).json({ error: e.message });
  }
};
