const { Redis } = require('@upstash/redis');
const crypto = require('crypto');
const { verifySession } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

    // GET — list all agents (admin) or get own FUB key (agent)
    if (req.method === 'GET') {
      // Agent requesting their own FUB key
      if (req.query.fubKey === 'true') {
        const raw = await redis.get(`agent:id:${session.agentId}`);
        if (!raw) return res.status(404).json({ error: 'Agent not found' });
        const agent = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return res.status(200).json({ fubApiKey: agent.fubApiKey || '' });
      }

      if (session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const ids = await redis.smembers('agents:all');
      if (!ids || !ids.length) return res.status(200).json({ agents: [] });
      const agents = await Promise.all(ids.map(id => redis.get(`agent:id:${id}`)));
      const list = agents.filter(Boolean)
        .map(a => typeof a === 'string' ? JSON.parse(a) : a)
        .map(a => ({ agentId: a.agentId, name: a.name, email: a.email, role: a.role, createdAt: a.createdAt, hasFubKey: !!a.fubApiKey }));
      return res.status(200).json({ agents: list });
    }

    // POST — create new agent (admin only)
    if (req.method === 'POST') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { name, email, password, role = 'agent', fubApiKey = '' } = req.body;
      if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });

      const emailKey = `agent:email:${email.toLowerCase().trim()}`;
      const existing = await redis.get(emailKey);
      if (existing) return res.status(409).json({ error: 'Agent with this email already exists' });

      const agentId = 'agent_' + crypto.randomBytes(8).toString('hex');
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = crypto.createHash('sha256').update(password + salt).digest('hex');

      const agent = { agentId, name, email: email.toLowerCase().trim(), passwordHash, salt, role, fubApiKey, createdAt: new Date().toISOString() };

      await redis.set(emailKey, JSON.stringify(agent));
      await redis.set(`agent:id:${agentId}`, JSON.stringify(agent));
      await redis.sadd('agents:all', agentId);

      return res.status(200).json({ success: true, agent: { agentId, name, email: agent.email, role } });
    }

    // PUT — update agent FUB key (agent updates their own, admin updates any)
    if (req.method === 'PUT') {
      const { agentId, fubApiKey } = req.body;
      const targetId = agentId && session.role === 'admin' ? agentId : session.agentId;

      const raw = await redis.get(`agent:id:${targetId}`);
      if (!raw) return res.status(404).json({ error: 'Agent not found' });
      const agent = typeof raw === 'string' ? JSON.parse(raw) : raw;
      agent.fubApiKey = fubApiKey;
      await redis.set(`agent:id:${targetId}`, JSON.stringify(agent));
      await redis.set(`agent:email:${agent.email}`, JSON.stringify(agent));
      return res.status(200).json({ success: true });
    }

    // DELETE — remove agent (admin only)
    if (req.method === 'DELETE') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
      const { agentId } = req.body;
      if (!agentId) return res.status(400).json({ error: 'agentId required' });
      const raw = await redis.get(`agent:id:${agentId}`);
      if (!raw) return res.status(404).json({ error: 'Agent not found' });
      const agent = typeof raw === 'string' ? JSON.parse(raw) : raw;
      await redis.del(`agent:id:${agentId}`);
      await redis.del(`agent:email:${agent.email}`);
      await redis.srem('agents:all', agentId);
      return res.status(200).json({ success: true });
    }

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
