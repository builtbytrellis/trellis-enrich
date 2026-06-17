const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');
const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'q required' });

  try {
    // Resolve the agent's FUB key
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const agentId = session.agentId;
    let fubKey = null;
    const idRaw = await redis.get(`agent:id:${agentId}`);
    if (idRaw) {
      const a = typeof idRaw === 'string' ? JSON.parse(idRaw) : idRaw;
      fubKey = a.fubApiKey || a.fub_api_key;
    }
    // Admin impersonation: allow ?agentId override
    if (session.role === 'admin' && req.query.agentId) {
      const r2 = await redis.get(`agent:id:${req.query.agentId}`);
      if (r2) { const a2 = typeof r2 === 'string' ? JSON.parse(r2) : r2; fubKey = a2.fubApiKey || a2.fub_api_key; }
    }
    if (!fubKey) return res.status(400).json({ error: 'No FUB key' });

    const encoded = Buffer.from(fubKey + ':').toString('base64');
    const r = await fetch(`https://api.followupboss.com/v1/people?q=${encodeURIComponent(q)}&limit=10&fields=id,firstName,lastName,customBirthday`, {
      headers: { 'Authorization': `Basic ${encoded}` }
    });
    const data = await r.json();
    const people = (data.people || []).map(p => ({
      id: p.id,
      name: `${p.firstName||''} ${p.lastName||''}`.trim(),
      hasBirthday: !!p.customBirthday
    }));
    return res.status(200).json({ people });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
