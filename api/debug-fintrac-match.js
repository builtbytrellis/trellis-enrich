const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const session = await verifySession(req, res);
  if (!session) return;
  const { targetAgentId, rows } = req.body || {};
  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;
  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const ids = await redis.lrange(`agent:${agentId}:contacts`, 0, 999);
    const raws = ids.length ? await Promise.all(ids.map(id => redis.get(id))) : [];
    const contacts = raws.filter(Boolean).map(r => typeof r === 'string' ? JSON.parse(r) : r);
    const normName = s => (s||'').toLowerCase().replace(/[^a-z ]/g,'').replace(/\\s+/g,' ').trim();
    function score(rn, cn){
      const r=normName(rn).split(' ').filter(t=>t.length>=2);
      const c=normName(cn).split(' ').filter(t=>t.length>=2);
      if(!r.length||!c.length)return 0;
      if(r[r.length-1]!==c[c.length-1])return 0;
      if(r[0]===c[0])return 3; return 0;
    }
    // Test the provided rows against all contacts
    const results = (rows||[]).map(row => {
      let best=0,bestName=null;
      for(const c of contacts){
        const s=score(row.full_name, c.full_name||c.name||'');
        if(s>best){best=s;bestName=c.full_name||c.name;}
      }
      return { received_full_name: row.full_name, received_keys: Object.keys(row), best_score: best, best_match: bestName };
    });
    return res.status(200).json({ total_contacts: contacts.length, results });
  } catch(e){ return res.status(500).json({error:e.message}); }
};
