const { Redis } = require('@upstash/redis');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    const { agentId, contact } = req.body;
    if (!agentId || !contact) return res.status(400).json({ error: 'Missing agentId or contact' });

    const id = `contact:${agentId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const record = { ...contact, id, agentId, savedAt: new Date().toISOString() };

    await redis.set(id, JSON.stringify(record));
    await redis.lpush(`agent:${agentId}:contacts`, id);

    res.status(200).json({ success: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
