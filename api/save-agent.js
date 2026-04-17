const { Redis } = require('@upstash/redis');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    if (req.method === 'POST') {
      const { agentId, name, fubApiKey } = req.body;
      if (!agentId || !name) return res.status(400).json({ error: 'Missing agentId or name' });

      const agent = { agentId, name, fubApiKey: fubApiKey || '', createdAt: new Date().toISOString() };
      await redis.set(`agent:${agentId}`, JSON.stringify(agent));
      await redis.sadd('agents', agentId);
      return res.status(200).json({ success: true, agent });
    }

    if (req.method === 'GET') {
      const agentId = req.query.agentId;
      if (agentId) {
        const data = await redis.get(`agent:${agentId}`);
        if (!data) return res.status(404).json({ error: 'Agent not found' });
        return res.status(200).json({ agent: typeof data === 'string' ? JSON.parse(data) : data });
      }
      // Return all agents (admin)
      const agentIds = await redis.smembers('agents');
      if (!agentIds || agentIds.length === 0) return res.status(200).json({ agents: [] });
      const agents = await Promise.all(agentIds.map(id => redis.get(`agent:${id}`)));
      return res.status(200).json({ agents: agents.filter(Boolean).map(a => typeof a === 'string' ? JSON.parse(a) : a) });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
