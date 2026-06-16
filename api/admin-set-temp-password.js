const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');
const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session || session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const { agentEmail, tempPassword } = req.body || {};
  if (!agentEmail || !tempPassword) return res.status(400).json({ error: 'agentEmail and tempPassword required' });

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const emailKey = `agent:email:${agentEmail.toLowerCase().trim()}`;
    const raw = await redis.get(emailKey);
    if (!raw) return res.status(404).json({ error: 'Agent not found' });
    const agent = typeof raw === 'string' ? JSON.parse(raw) : raw;

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.createHash('sha256').update(tempPassword + salt).digest('hex');
    agent.salt = salt;
    agent.passwordHash = passwordHash;
    agent.mustChangePassword = true;
    agent.tempPasswordSetAt = new Date().toISOString();
    await redis.set(emailKey, JSON.stringify(agent));

    // sync id-keyed record
    if (agent.agentId) {
      const idKey = `agent:id:${agent.agentId}`;
      const idRaw = await redis.get(idKey);
      if (idRaw) {
        const idAgent = typeof idRaw === 'string' ? JSON.parse(idRaw) : idRaw;
        idAgent.salt = salt; idAgent.passwordHash = passwordHash; idAgent.mustChangePassword = true;
        await redis.set(idKey, JSON.stringify(idAgent));
      }
    }

    return res.status(200).json({ success: true, agent: agent.name, mustChangePassword: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
