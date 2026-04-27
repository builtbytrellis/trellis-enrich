const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

    const key = `agent:email:${email.toLowerCase().trim()}`;
    const raw = await redis.get(key);
    if (!raw) return res.status(401).json({ error: 'Invalid email or password' });

    const agent = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // Hash the incoming password and compare
    const hash = crypto.createHash('sha256').update(password + agent.salt).digest('hex');
    if (hash !== agent.passwordHash) return res.status(401).json({ error: 'Invalid email or password' });

    // Issue session token
    const token = crypto.randomBytes(32).toString('hex');
    const session = { agentId: agent.agentId, email: agent.email, name: agent.name, role: agent.role || 'agent', token };
    await redis.set(`session:${token}`, JSON.stringify(session), { ex: 60 * 60 * 24 * 30 }); // 30 days

    return res.status(200).json({ success: true, token, agent: { agentId: agent.agentId, name: agent.name, email: agent.email, role: agent.role || 'agent' } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
