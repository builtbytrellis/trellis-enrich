const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

// ONE-TIME USE: Creates the admin account
// Hit this endpoint once with: POST /api/bootstrap { "secret": "TRELLIS_BOOTSTRAP", "password": "your-admin-password" }
// Then never use it again

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { secret, password, name = 'Trellis Admin', email = 'admin@builtbytrellis.com' } = req.body;

  if (secret !== 'TRELLIS_BOOTSTRAP_2024') {
    return res.status(403).json({ error: 'Invalid bootstrap secret' });
  }

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

    const emailKey = `agent:email:${email.toLowerCase()}`;
    const existing = await redis.get(emailKey);
    if (existing) return res.status(409).json({ error: 'Admin already exists' });

    const agentId = 'admin_trellis';
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.createHash('sha256').update(password + salt).digest('hex');

    const agent = { agentId, name, email: email.toLowerCase(), passwordHash, salt, role: 'admin', createdAt: new Date().toISOString() };

    await redis.set(emailKey, JSON.stringify(agent));
    await redis.set(`agent:id:${agentId}`, JSON.stringify(agent));
    await redis.sadd('agents:all', agentId);

    return res.status(200).json({ success: true, message: 'Admin account created. Do not call this endpoint again.' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
