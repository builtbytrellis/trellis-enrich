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

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    let agentId = session.agentId;
    if (session.role === 'admin' && req.query.agentId) agentId = req.query.agentId;

    let fubKey = null;
    const idRaw = await redis.get(`agent:id:${agentId}`);
    if (idRaw) {
      const a = typeof idRaw === 'string' ? JSON.parse(idRaw) : idRaw;
      fubKey = a.fubApiKey || a.fub_api_key;
    }
    if (!fubKey) return res.status(400).json({ error: 'No FUB key' });

    const encoded = Buffer.from(fubKey + ':').toString('base64');
    const r = await fetch('https://api.followupboss.com/v1/identity', {
      headers: { 'Authorization': `Basic ${encoded}` }
    });
    const data = await r.json();
    return res.status(200).json({ domain: data.account?.domain || null, accountName: data.account?.name || null });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
