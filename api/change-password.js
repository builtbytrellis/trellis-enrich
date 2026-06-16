const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');
const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await verifySession(req, res);
  if (!session) return;

  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

    // Load agent by email
    const emailKey = `agent:email:${session.email.toLowerCase().trim()}`;
    const raw = await redis.get(emailKey);
    if (!raw) return res.status(404).json({ error: 'Agent not found' });
    const agent = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // Set new password
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.createHash('sha256').update(newPassword + salt).digest('hex');
    agent.salt = salt;
    agent.passwordHash = passwordHash;
    agent.mustChangePassword = false;
    agent.passwordChangedAt = new Date().toISOString();

    await redis.set(emailKey, JSON.stringify(agent));
    // Also update the id-keyed record if it exists
    if (agent.agentId) {
      const idKey = `agent:id:${agent.agentId}`;
      const idRaw = await redis.get(idKey);
      if (idRaw) {
        const idAgent = typeof idRaw === 'string' ? JSON.parse(idRaw) : idRaw;
        idAgent.salt = salt;
        idAgent.passwordHash = passwordHash;
        idAgent.mustChangePassword = false;
        await redis.set(idKey, JSON.stringify(idAgent));
      }
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
