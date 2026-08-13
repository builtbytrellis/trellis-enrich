const fetch = require('node-fetch');
const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

async function fubFetch(path, method, headers, body) {
  const url = `https://api.followupboss.com/v1${path}`;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { _raw: t }; }
  return { ok: r.ok, status: r.status, body: j };
}

function normalizeNameFromTrade(name) {
  if (!name) return name;
  const commaMatch = name.match(/^([^,]+),\s*(.+)$/);
  if (commaMatch) return `${commaMatch[2].trim()} ${commaMatch[1].trim()}`;
  return name;
}

async function findFubPersonRobust(name, headers) {
  if (!name) return { person: null, tried: [] };
  name = normalizeNameFromTrade(name);
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  const tried = [];
  const isConfidentMatch = (person, query) => {
    const fubFull = `${person.firstName || ''} ${person.lastName || ''}`.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
    const qt = query.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim().split(' ').filter(t => t.length >= 2);
    return qt.filter(t => fubFull.includes(t)).length >= 2;
  };
  const r1 = await fubFetch(`/people?q=${encodeURIComponent(name)}&limit=5`, 'GET', headers);
  const people1 = r1.body?.people || [];
  tried.push({ q: name, found: people1.length });
  const exact = people1.find(p => isConfidentMatch(p, name));
  if (exact) return { person: exact, tried };
  if (tokens.length >= 3) {
    const fl = `${tokens[0]} ${tokens[tokens.length - 1]}`;
    const r2 = await fubFetch(`/people?q=${encodeURIComponent(fl)}&limit=5`, 'GET', headers);
    const people2 = r2.body?.people || [];
    tried.push({ q: fl, found: people2.length });
    const flMatch = people2.find(p => isConfidentMatch(p, fl));
    if (flMatch) return { person: flMatch, tried };
  }
  return { person: null, tried };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await verifySession(req, res);
  if (!session) return;

  const { tradeId, clientName, agentSide, ensureFub, targetAgentId } = req.body;
  if (!tradeId || !clientName || !clientName.trim()) return res.status(400).json({ error: 'tradeId and clientName required' });

  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;
  // Tenant isolation: the trade key must belong to the resolved agent
  if (!tradeId.startsWith(`trade:${agentId}:`)) return res.status(403).json({ error: 'Trade does not belong to this agent' });

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const raw = await redis.get(tradeId);
    if (!raw) return res.status(404).json({ error: 'Trade not found' });
    const trade = typeof raw === 'string' ? JSON.parse(raw) : raw;

    const name = clientName.trim();
    const patch = { client_name: name, client_unknown: false, client_connected_at: new Date().toISOString(), client_connected_by: session.agentId };
    if (agentSide) patch.agent_side = agentSide;
    const side = agentSide || trade.agent_side;
    // Keep the party columns consistent with the side the client was on
    if ((side === 'buyer' || side === 'tenant') && !trade.buyer_or_tenant_name) patch.buyer_or_tenant_name = name;
    if ((side === 'seller' || side === 'landlord') && !trade.seller_or_landlord_name) patch.seller_or_landlord_name = name;

    let fubResult = null;
    if (ensureFub) {
      const aRaw = await redis.get(`agent:id:${agentId}`);
      const agent = aRaw ? (typeof aRaw === 'string' ? JSON.parse(aRaw) : aRaw) : null;
      const fubKey = agent && (agent.fubApiKey || agent.fub_api_key);
      if (!fubKey) return res.status(400).json({ error: 'No FUB API key on file for this agent' });
      const headers = { 'Content-Type': 'application/json', 'Authorization': `Basic ${Buffer.from(fubKey + ':').toString('base64')}` };

      const found = await findFubPersonRobust(name, headers);
      if (found.person) {
        fubResult = { id: found.person.id, name: `${found.person.firstName || ''} ${found.person.lastName || ''}`.trim(), created: false };
      } else {
        const normalized = normalizeNameFromTrade(name);
        const parts = normalized.split(/\s+/);
        const createRes = await fubFetch('/people', 'POST', headers, {
          firstName: parts[0],
          lastName: parts.slice(1).join(' ') || '',
          source: 'Trellis Enrich',
          tags: ['Past Client'],
        });
        const newId = createRes.body?.id;
        if (!createRes.ok || !newId) {
          return res.status(200).json({ success: false, error: `FUB person create failed (${createRes.status}): ${JSON.stringify(createRes.body).slice(0, 300)}` });
        }
        // FUB success messages lie — fetch the record back to confirm it exists
        const verify = await fubFetch(`/people/${newId}?fields=id,firstName,lastName,tags`, 'GET', headers);
        if (!verify.ok || !verify.body?.id) {
          return res.status(200).json({ success: false, error: `FUB person #${newId} did not verify after create (${verify.status})` });
        }
        fubResult = { id: verify.body.id, name: `${verify.body.firstName || ''} ${verify.body.lastName || ''}`.trim(), created: true };
      }
      patch.fub_person_id = fubResult.id;
    }

    const updated = { ...trade, ...patch };
    await redis.set(tradeId, JSON.stringify(updated));
    // Read back to confirm the write landed
    const back = await redis.get(tradeId);
    const confirmed = typeof back === 'string' ? JSON.parse(back) : back;
    if (confirmed.client_name !== name) return res.status(500).json({ error: 'Trade update did not persist' });

    return res.status(200).json({ success: true, trade: { ...confirmed, _tradeId: tradeId }, fubPerson: fubResult });
  } catch (e) {
    console.error('connect-client error:', e);
    return res.status(500).json({ error: e.message });
  }
};
