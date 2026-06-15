const { verifySession } = require('./auth');
const { Redis } = require('@upstash/redis');
const fetch = require('node-fetch');

function normName(n){ return (n||'').toLowerCase().replace(/\s+/g,' ').trim(); }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const { targetAgentId, fubApiKey } = req.body || {};
  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

    // Get the agent's FUB key
    let key = fubApiKey;
    if (!key) {
      const agentRaw = await redis.get(`agent:id:${agentId}`);
      const agent = agentRaw ? (typeof agentRaw === 'string' ? JSON.parse(agentRaw) : agentRaw) : null;
      key = agent?.fubApiKey || agent?.fub_api_key;
    }
    if (!key) return res.status(400).json({ error: 'No FUB key found for this agent' });

    const encoded = Buffer.from(key + ':').toString('base64');
    const headers = { 'Authorization': `Basic ${encoded}` };

    // Build set of names that have a VERIFIED trade (from the clean reconciled trades in Redis)
    const tradeIds = await redis.lrange(`agent:${agentId}:trades`, 0, -1);
    const tradeRaws = tradeIds.length ? await Promise.all(tradeIds.map(id => redis.get(id))) : [];
    const verifiedNames = new Set();
    for (const raw of tradeRaws) {
      if (!raw) continue;
      const t = typeof raw === 'string' ? JSON.parse(raw) : raw;
      [t.buyer_or_tenant_name, t.seller_or_landlord_name, t.client_name].filter(Boolean)
        .forEach(n => verifiedNames.add(normName(n)));
    }

    // Trade-derived tags we care about
    const TRADE_TAGS = ['Past Client','Buyer','Seller'];
    const isYearTag = (t) => /^(Buyer|Seller|Tenant|Landlord) \d{4}$/.test(t);
    const isAreaTag = (t) => t.startsWith('Area:') || t.startsWith('Street:');

    // Page through FUB contacts
    const suspects = [];
    let next = 'https://api.followupboss.com/v1/people?limit=100&fields=id,name,firstName,lastName,tags,background,stage';
    let pages = 0;
    while (next && pages < 8) {
      const r = await fetch(next, { headers });
      const data = await r.json();
      for (const p of (data.people || [])) {
        const fullName = normName(`${p.firstName||''} ${p.lastName||''}`);
        const tags = p.tags || [];
        const tradeTags = tags.filter(t => TRADE_TAGS.includes(t) || isYearTag(t) || isAreaTag(t));
        const hasTradeNote = /purchas|closed|sold|bought|deal|trade/i.test(p.background || '');
        const looksLikeClient = tradeTags.length > 0 || hasTradeNote;
        const isVerified = verifiedNames.has(fullName);

        // SUSPECT = looks like a client in FUB, but has NO verified trade in clean data
        if (looksLikeClient && !isVerified) {
          suspects.push({
            id: p.id,
            name: `${p.firstName||''} ${p.lastName||''}`.trim(),
            stage: p.stage || '',
            trade_tags: tradeTags,
            has_trade_note: hasTradeNote,
            note_preview: (p.background||'').slice(0, 120)
          });
        }
      }
      next = data._metadata?.nextLink || null;
      pages++;
    }

    return res.status(200).json({
      success: true,
      verified_trade_names: verifiedNames.size,
      suspects_found: suspects.length,
      suspects: suspects.slice(0, 200),
      note: 'Suspects have trade-style tags/notes in FUB but NO matching verified trade in the clean master list. Likely bad matches from before.'
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
