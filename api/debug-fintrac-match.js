const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const { targetAgentId, sampleNames } = req.body || {};
  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const ids = await redis.lrange(`agent:${agentId}:contacts`, 0, 999);
    const raws = ids.length ? await Promise.all(ids.map(id => redis.get(id))) : [];
    const contacts = raws.filter(Boolean).map(r => typeof r === 'string' ? JSON.parse(r) : r);

    // Show first 10 contact name fields exactly as stored
    const sample = contacts.slice(0, 10).map(c => ({
      full_name: c.full_name,
      name: c.name,
      keys: Object.keys(c).filter(k => k.toLowerCase().includes('name'))
    }));

    // For provided sample names, try to find them
    const lookups = [];
    if (sampleNames) {
      for (const sn of sampleNames) {
        const found = contacts.find(c =>
          (c.full_name||'').toLowerCase() === sn.toLowerCase() ||
          (c.name||'').toLowerCase() === sn.toLowerCase()
        );
        lookups.push({ search: sn, found: found ? (found.full_name||found.name) : 'NOT FOUND' });
      }
    }

    return res.status(200).json({
      agentId,
      total_contacts: contacts.length,
      sample_contact_names: sample,
      lookups
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
