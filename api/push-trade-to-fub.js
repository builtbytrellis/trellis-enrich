const fetch = require('node-fetch');
const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

async function resolveFubKey(session, targetAgentId, sidebarKey) {
  const ownerAgentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;
  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const raw = await redis.get(`agent:id:${ownerAgentId}`);
    if (raw) {
      const agent = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (agent.fubApiKey) return { key: agent.fubApiKey, source: 'stored', ownerAgentId, ownerName: agent.name };
    }
  } catch (e) { console.warn('resolveFubKey: redis lookup failed', e.message); }
  return { key: sidebarKey, source: 'sidebar', ownerAgentId, ownerName: null };
}

async function recordDebug(agentId, payload) {
  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const data = JSON.stringify({ at: new Date().toISOString(), agentId, ...payload });
    await redis.set(`last_push_debug:${agentId}`, data, { ex: 86400 });
    await redis.set('last_push_debug_global', data, { ex: 86400 });
  } catch (e) { console.warn('debug record failed:', e.message); }
}

async function fubFetch(path, method, headers, body) {
  const url = `https://api.followupboss.com/v1${path}`;
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { _raw: t }; }
  return { ok: r.ok, status: r.status, body: j };
}

async function findStageForTrade(headers, trade) {
  const r = await fubFetch('/pipelines', 'GET', headers);
  const debug = { status: r.status, ok: r.ok };
  let pipelines = null;
  if (Array.isArray(r.body)) pipelines = r.body;
  else if (Array.isArray(r.body?.pipelines)) pipelines = r.body.pipelines;
  else if (r.body && typeof r.body === 'object') {
    for (const k of Object.keys(r.body)) { if (Array.isArray(r.body[k])) { pipelines = r.body[k]; break; } }
  }
  if (!pipelines || !pipelines.length) { debug.pipeline_count = 0; return { stage: null, debug }; }
  debug.pipeline_count = pipelines.length;
  debug.pipeline_names = pipelines.map(p => p.name).slice(0, 10);
  const buySide = ['buyer', 'tenant'].includes(trade.agent_side);
  const listSide = ['seller', 'landlord'].includes(trade.agent_side);
  let pipeline = buySide ? (pipelines.find(p => /\bbuyer/i.test(p.name)) || pipelines[0])
    : listSide ? (pipelines.find(p => /\bseller|\blisting/i.test(p.name)) || pipelines[0])
    : pipelines[0];
  debug.picked_pipeline = pipeline?.name;
  const stages = (pipeline.stages || pipeline.dealStages || []).map(s => ({ ...s, pipelineName: pipeline.name, pipelineId: pipeline.id }));
  debug.stage_names = stages.map(s => s.name || s.title || s.label);
  if (!stages.length) return { stage: null, debug };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let closeDate = null;
  if (trade.close_date) { const d = new Date(trade.close_date); if (!isNaN(d.getTime())) closeDate = d; }
  const isPastClose = closeDate && closeDate < today;
  const nameOf = s => (s.name || s.title || s.label || '').toLowerCase();
  let stage = isPastClose
    ? (stages.find(s => /\bwon\b/.test(nameOf(s))) || stages.find(s => /\bclosed\b/.test(nameOf(s)) && !/lost/.test(nameOf(s))) || stages.find(s => /\bsold\b/.test(nameOf(s))) || stages[stages.length - 1])
    : (stages.find(s => /\bpending\b/.test(nameOf(s))) || stages.find(s => /\bunder\s*contract\b/.test(nameOf(s))) || stages.find(s => /\bactive\b/.test(nameOf(s))) || stages[0]);
  debug.picked_stage = stage?.name || null;
  return { stage, debug };
}

async function findExistingDealForTrade(headers, trade, fubPersonId) {
  const address = (trade.property_address || '').trim();
  if (!address) return { found: null, tried: [] };
  const normalize = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = normalize(address).split(' ').filter(t => t.length >= 3);
  if (!tokens.length) return { found: null, tried: [] };
  const tried = [];
  const matches = deal => { const h = normalize(`${deal.name || ''} ${deal.description || ''}`); return h && tokens.every(t => h.includes(t)); };
  if (fubPersonId) {
    const r = await fubFetch(`/deals?personId=${fubPersonId}&limit=100`, 'GET', headers);
    const deals = r.body?.deals || r.body || [];
    tried.push({ q: `personId=${fubPersonId}`, count: Array.isArray(deals) ? deals.length : 0 });
    if (Array.isArray(deals)) { const m = deals.find(matches); if (m) return { found: m, tried }; }
  }
  const q = encodeURIComponent(tokens.slice(0, 3).join(' '));
  const r2 = await fubFetch(`/deals?q=${q}&limit=30`, 'GET', headers);
  const deals2 = r2.body?.deals || r2.body || [];
  tried.push({ q: `q=${tokens.slice(0, 3).join(' ')}`, count: Array.isArray(deals2) ? deals2.length : 0 });
  if (Array.isArray(deals2)) { const m = deals2.find(matches); if (m) return { found: m, tried }; }
  return { found: null, tried };
}

// FIXED: Never match on first name alone. Require full name match (first+last minimum).
// Better unlinked than wrong-linked.
async function findFubPersonRobust(name, headers, email, phone) {
  if (!name) return { person: null, tried: [] };
  const normalize = s => (s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  const tried = [];

  const isConfidentMatch = (person, query) => {
    const fubFull = normalize(`${person.firstName || ''} ${person.lastName || ''}`);
    const queryNorm = normalize(query);
    if (!fubFull || !queryNorm) return false;
    const qt = queryNorm.split(' ').filter(t => t.length >= 2);
    // Must match at least 2 tokens (first + last) — never match on one token alone
    return qt.filter(t => fubFull.includes(t)).length >= 2;
  };

  // 1. Full name exact search
  const r1 = await fubFetch(`/people?q=${encodeURIComponent(name)}&limit=5`, 'GET', headers);
  const people1 = r1.body?.people || [];
  tried.push({ q: name, found: people1.length });
  const exact = people1.find(p => isConfidentMatch(p, name));
  if (exact) return { person: exact, tried };

  // 2. First + last only (skip middle names)
  if (tokens.length >= 3) {
    const fl = `${tokens[0]} ${tokens[tokens.length - 1]}`;
    const r2 = await fubFetch(`/people?q=${encodeURIComponent(fl)}&limit=5`, 'GET', headers);
    const people2 = r2.body?.people || [];
    tried.push({ q: fl, found: people2.length });
    const flMatch = people2.find(p => isConfidentMatch(p, fl));
    if (flMatch) return { person: flMatch, tried };
  }

  // 3. Email match
  if (email) {
    const r3 = await fubFetch(`/people?q=${encodeURIComponent(email)}&limit=3`, 'GET', headers);
    const people3 = r3.body?.people || [];
    tried.push({ q: email, found: people3.length });
    if (people3.length === 1) return { person: people3[0], tried };
  }

  // 4. Phone match
  if (phone) {
    const clean = phone.replace(/\D/g, '');
    const r4 = await fubFetch(`/people?q=${encodeURIComponent(clean)}&limit=3`, 'GET', headers);
    const people4 = r4.body?.people || [];
    tried.push({ q: clean, found: people4.length });
    if (people4.length === 1) return { person: people4[0], tried };
  }

  // No confident match — return null. Deal will be unlinked.
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

  const { trade, fubApiKey: sidebarKey, targetAgentId, tradeId } = req.body;
  if (!trade) return res.status(400).json({ error: 'Trade required' });

  const updateTradeRecord = async (patch) => {
    if (!tradeId) return;
    try {
      const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
      const raw = await redis.get(tradeId);
      if (!raw) return;
      const existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
      await redis.set(tradeId, JSON.stringify({ ...existing, ...patch, _lastPushAttemptAt: new Date().toISOString() }));
    } catch (e) { console.warn('updateTradeRecord failed:', e.message); }
  };

  const keyResult = await resolveFubKey(session, targetAgentId, sidebarKey);
  if (!keyResult.key) return res.status(400).json({ error: `No FUB API key on file for agent ${keyResult.ownerAgentId}.` });

  const encoded = Buffer.from(keyResult.key + ':').toString('base64');
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Basic ${encoded}` };
  const outcome = { steps: [], key_source: keyResult.source, owner_agent_id: keyResult.ownerAgentId, owner_agent_name: keyResult.ownerName };

  try {
    // 0) Whoami check
    const meRes = await fubFetch('/identity', 'GET', headers);
    const accountName = meRes.body?.account?.name || meRes.body?.account || null;
    const userName = meRes.body?.name || null;
    outcome.steps.push({ step: 'whoami', ok: meRes.ok, account: accountName, user: userName || meRes.body?.email });

    if (keyResult.ownerName && userName && userName.trim()) {
      const ownerTokens = (keyResult.ownerName.toLowerCase().match(/[a-z]+/g) || []).filter(t => t.length >= 4);
      const fubUser = userName.toLowerCase().replace(/[^a-z]/g, '');
      if (!ownerTokens.some(t => fubUser.includes(t))) {
        const msg = `FUB key identity mismatch. Key for "${keyResult.ownerName}" resolves to FUB user "${userName}". Update the agent's stored FUB key.`;
        outcome.steps.push({ step: 'identity_check', ok: false, error: msg });
        await recordDebug(session.agentId, { trade, outcome, blocked: true, error: msg });
        return res.status(200).json({ success: false, error: msg, outcome });
      }
    }
    outcome.steps.push({ step: 'identity_check', ok: true, resolved_user: userName, resolved_account: accountName });

    const isLease = ['lease', 'lease_renewal'].includes(trade.deal_type);
    const movingIn = ['buyer', 'tenant'].includes(trade.agent_side);
    const stayingPut = ['seller', 'landlord'].includes(trade.agent_side);
    const clientName = movingIn ? trade.buyer_or_tenant_name : (stayingPut ? trade.seller_or_landlord_name : (trade.buyer_or_tenant_name || trade.seller_or_landlord_name));

    // 1) Find FUB person — full name match required
    let fubPerson = null;
    if (clientName) {
      const pr = await findFubPersonRobust(clientName, headers, trade.buyer_email || trade.seller_email, trade.buyer_phone || trade.seller_phone);
      fubPerson = pr.person;
      outcome.steps.push({ step: 'find_person', name: clientName, found: !!fubPerson, fubId: fubPerson?.id, tried: pr.tried });
    }

    // 2) Find stage
    const stageResult = await findStageForTrade(headers, trade);
    const stage = stageResult.stage;
    outcome.steps.push({ step: 'find_stage', stage: stage?.name || null, stageId: stage?.id || null, debug: stageResult.debug });
    if (!stage) {
      const errMsg = 'Could not find a deal stage in FUB. Check FUB → Settings → Deals.';
      await recordDebug(session.agentId, { trade, outcome, error: errMsg });
      return res.status(200).json({ success: false, error: errMsg, outcome });
    }

    // 3) Duplicate check
    const dupCheck = await findExistingDealForTrade(headers, trade, fubPerson?.id);
    if (dupCheck.found) {
      outcome.steps.push({ step: 'duplicate_check', found: true, existing_deal_id: dupCheck.found.id });
      await updateTradeRecord({ _pushStatus: 'duplicate', _fubDealId: dupCheck.found.id });
      return res.status(200).json({ success: true, duplicate: true, dealId: dupCheck.found.id, message: `Deal already exists (#${dupCheck.found.id}). Skipped.`, outcome });
    }
    outcome.steps.push({ step: 'duplicate_check', found: false });

    // 4) Create deal
    const dealName = `${trade.property_address || 'Property'} — ${clientName || 'Unknown'}`;
    const dealPayload = {
      name: dealName,
      ...(stage?.id ? { stageId: stage.id } : {}),
      ...(trade.close_date ? { projectedCloseDate: trade.close_date } : {}),
      ...((isLease ? trade.monthly_rent : trade.sale_price) ? { price: isLease ? trade.monthly_rent : trade.sale_price } : {}),
      ...(trade.gross_commission ? { commissionValue: trade.gross_commission } : {}),
      ...(fubPerson?.id ? { peopleIds: [fubPerson.id] } : {}),
      description: [
        trade.deal_type ? `Type: ${trade.deal_type}` : null,
        trade.mls_number ? `MLS: ${trade.mls_number}` : null,
        trade.property_address ? `Property: ${trade.property_address}` : null,
        trade.agent_side ? `Agent rep'd: ${trade.agent_side}` : null,
        trade.agent_share_pretax ? `Agent share (pretax): $${trade.agent_share_pretax}` : null,
      ].filter(Boolean).join('\n')
    };

    const dealRes = await fubFetch('/deals', 'POST', headers, dealPayload);
    outcome.steps.push({ step: 'create_deal', ok: dealRes.ok, status: dealRes.status, dealId: dealRes.body?.id });
    if (!dealRes.ok) {
      const err = JSON.stringify(dealRes.body).slice(0, 400);
      await updateTradeRecord({ _pushStatus: 'failed', _lastPushError: err });
      return res.status(200).json({ success: false, error: `FUB deal create failed (${dealRes.status}): ${err}`, outcome });
    }

    // 5) Address update or note
    if (fubPerson?.id) {
      if (movingIn && trade.property_address) {
        const updRes = await fubFetch(`/people/${fubPerson.id}`, 'PUT', headers, { addresses: [{ street: trade.property_address, city: trade.property_city, state: trade.property_province, code: trade.property_postal, type: 'home' }] });
        outcome.steps.push({ step: 'update_address', ok: updRes.ok });
      } else if (stayingPut && trade.property_address) {
        const noteRes = await fubFetch('/notes', 'POST', headers, { personId: fubPerson.id, body: `${isLease ? 'Leased' : 'Sold'} ${trade.property_address} on ${trade.close_date || 'unknown date'}`, isHtml: false });
        outcome.steps.push({ step: 'add_note', ok: noteRes.ok });
      }
    } else {
      outcome.steps.push({ step: 'person_not_matched', note: 'Deal created unlinked — manually link to correct contact in FUB.' });
    }

    // 6) Home anniversary reminders — 10 years
    if (fubPerson?.id && trade.close_date) {
      const [yStr, mStr, dStr] = trade.close_date.split('-');
      const baseYear = parseInt(yStr);
      if (Number.isFinite(baseYear) && mStr && dStr) {
        for (let y = 1; y <= 10; y++) {
          const taskRes = await fubFetch('/tasks', 'POST', headers, {
            name: `${y}-Year Home Anniversary — ${trade.property_address || 'their property'}`,
            personId: fubPerson.id,
            dueDate: `${baseYear + y}-${mStr}-${dStr}`,
            description: `${y}-year anniversary of closing on ${trade.property_address} (${trade.close_date}). Reach out — congrats, check-in, referral ask.`,
          });
          outcome.steps.push({ step: `anniversary_y${y}`, ok: taskRes.ok, dueDate: `${baseYear + y}-${mStr}-${dStr}` });
        }
      }
    }

    await updateTradeRecord({ _pushStatus: 'pushed', _fubDealId: dealRes.body?.id, _fubPersonId: fubPerson?.id || null, _lastPushError: null });
    await recordDebug(session.agentId, { trade, outcome, success: true, dealId: dealRes.body?.id });
    return res.status(200).json({ success: true, dealId: dealRes.body?.id, fubPersonId: fubPerson?.id || null, outcome });

  } catch (e) {
    console.error('push-trade-to-fub error:', e);
    await updateTradeRecord({ _pushStatus: 'failed', _lastPushError: e.message });
    await recordDebug(session.agentId, { trade, outcome, exception: e.message });
    return res.status(500).json({ error: e.message, outcome });
  }
};
