const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

// Admin-only endpoint: proves no contact/trade in one agent's account carries another
// agent's ID, FUB domain, or appears in another agent's lists. Returns a clean/dirty report.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;
  if (session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

  try {
    // Discover all agents
    const agentIds = await redis.smembers('agents:all');
    const agents = [];
    for (const aid of agentIds) {
      const raw = await redis.get(`agent:id:${aid}`);
      if (raw) { const a = typeof raw==='string'?JSON.parse(raw):raw; agents.push({ agentId: aid, name: a.name || aid, fubDomain: (a.fubDomain||a.fub_domain||'').toLowerCase() }); }
    }

    const findings = [];
    const perAgent = {};

    // Load each agent's contacts + trades, indexed by agentId
    const data = {};
    for (const a of agents) {
      const cIds = await redis.lrange(`agent:${a.agentId}:contacts`, 0, -1);
      const tIds = await redis.lrange(`agent:${a.agentId}:trades`, 0, -1);
      const contacts = cIds.length ? (await Promise.all(cIds.map(id=>redis.get(id)))).filter(Boolean).map(r=>typeof r==='string'?JSON.parse(r):r) : [];
      const trades = tIds.length ? (await Promise.all(tIds.map(id=>redis.get(id)))).filter(Boolean).map(r=>typeof r==='string'?JSON.parse(r):r) : [];
      data[a.agentId] = { contacts, trades };
      perAgent[a.agentId] = { name: a.name, contacts: contacts.length, trades: trades.length };
    }

    // CHECK 1: every record's own agentId matches the list it lives in
    for (const a of agents) {
      for (const c of data[a.agentId].contacts) {
        if (c.agentId && c.agentId !== a.agentId)
          findings.push({ type: 'mistagged_contact', owner: a.agentId, record: c.contactId, claims_agent: c.agentId, name: c.full_name||c.name });
      }
      for (const t of data[a.agentId].trades) {
        if (t.agentId && t.agentId !== a.agentId)
          findings.push({ type: 'mistagged_trade', owner: a.agentId, record: t.tradeId||t.id, claims_agent: t.agentId });
      }
    }

    // CHECK 2: a record ID appears in more than one agent's list
    const idOwners = {};
    for (const a of agents) {
      for (const c of data[a.agentId].contacts) {
        if (!c.contactId) continue;
        (idOwners[c.contactId] = idOwners[c.contactId] || []).push(a.agentId);
      }
    }
    for (const [cid, owners] of Object.entries(idOwners)) {
      if (owners.length > 1) findings.push({ type: 'shared_record_id', record: cid, owners });
    }

    // CHECK 3: a contact references another agent's FUB domain in its fub_data
    for (const a of agents) {
      const otherDomains = agents.filter(x=>x.agentId!==a.agentId && x.fubDomain).map(x=>x.fubDomain);
      for (const c of data[a.agentId].contacts) {
        const blob = JSON.stringify(c.fub_data||{}).toLowerCase();
        for (const dom of otherDomains) {
          if (dom && blob.includes(dom))
            findings.push({ type: 'cross_domain_reference', owner: a.agentId, record: c.contactId, name: c.full_name||c.name, foreign_domain: dom });
        }
      }
    }

    return res.status(200).json({
      success: true,
      checked_at: new Date().toISOString(),
      agents: perAgent,
      isolation: findings.length === 0 ? 'CLEAN' : 'ISSUES_FOUND',
      findings
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
