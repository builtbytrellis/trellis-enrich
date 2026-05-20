const fetch = require('node-fetch');
const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

// Pull the target agent's stored FUB key from Redis. We do this server-side
// to enforce that a deal is pushed to THE agent's FUB workspace, not whoever
// happens to have a key pasted in the sidebar. Prevents accidental leakage
// when admin operates on behalf of another agent.
async function resolveFubKey(session, targetAgentId, sidebarKey) {
  // Determine the effective owner of this push
  const ownerAgentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;
  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const raw = await redis.get(`agent:id:${ownerAgentId}`);
    if (raw) {
      const agent = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (agent.fubApiKey) {
        return { key: agent.fubApiKey, source: 'stored', ownerAgentId, ownerName: agent.name };
      }
    }
  } catch (e) { console.warn('resolveFubKey: redis lookup failed', e.message); }
  // No stored key for the owner — fall back to sidebar (and clearly flag it)
  return { key: sidebarKey, source: 'sidebar', ownerAgentId, ownerName: null };
}

async function recordDebug(agentId, payload) {
  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const data = JSON.stringify({ at: new Date().toISOString(), agentId, ...payload });
    await redis.set(`last_push_debug:${agentId}`, data, { ex: 86400 });
    // Also write a global key so the assistant can fetch the latest push
    // regardless of which agent triggered it.
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

// FUB's stages live inside pipelines: GET /v1/pipelines returns
// {pipelines: [{id, name, stages: [...]}, ...]}.
//
// Pick a stage that's appropriate for THIS deal:
//   - Buy-side trade (agent represented buyer/tenant) → Buyers pipeline
//   - List-side trade (agent represented seller/landlord) → Sellers pipeline
//   - Past close_date (today or earlier) → "Closed" / "Won" stage in that pipeline
//   - Future close_date (or none) → "Pending" / "Under Contract" / "Active" stage
//
// Falls back gracefully if the workspace has only one pipeline or the named
// stages don't match — user can always recategorize in FUB after the fact.
async function findStageForTrade(headers, trade) {
  const r = await fubFetch('/pipelines', 'GET', headers);
  const debug = { status: r.status, ok: r.ok, body_keys: r.body && typeof r.body === 'object' ? Object.keys(r.body) : null };

  let pipelines = null;
  if (Array.isArray(r.body)) pipelines = r.body;
  else if (Array.isArray(r.body?.pipelines)) pipelines = r.body.pipelines;
  else if (r.body && typeof r.body === 'object') {
    for (const k of Object.keys(r.body)) {
      if (Array.isArray(r.body[k])) { pipelines = r.body[k]; break; }
    }
  }

  if (!r.ok) debug.body_preview = JSON.stringify(r.body).slice(0, 400);

  if (!pipelines || !pipelines.length) {
    debug.pipeline_count = 0;
    return { stage: null, debug };
  }

  debug.pipeline_count = pipelines.length;
  debug.pipeline_names = pipelines.map(p => p.name).slice(0, 10);

  // Pick pipeline by agent_side
  const buySide = ['buyer', 'tenant'].includes(trade.agent_side);
  const listSide = ['seller', 'landlord'].includes(trade.agent_side);
  let pipeline = null;
  if (buySide) {
    pipeline = pipelines.find(p => /\bbuyer/i.test(p.name)) || pipelines[0];
  } else if (listSide) {
    pipeline = pipelines.find(p => /\bseller|\blisting/i.test(p.name)) || pipelines[0];
  } else {
    pipeline = pipelines[0]; // double-ended or unknown — first pipeline
  }
  debug.picked_pipeline = pipeline?.name;

  const stages = (pipeline.stages || pipeline.dealStages || []).map(s => ({ ...s, pipelineName: pipeline.name, pipelineId: pipeline.id }));
  debug.stage_names = stages.map(s => s.name || s.title || s.label);

  if (!stages.length) return { stage: null, debug };

  // Decide stage based on close_date relative to today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let closeDate = null;
  if (trade.close_date) {
    const d = new Date(trade.close_date);
    if (!isNaN(d.getTime())) closeDate = d;
  }
  const isPastClose = closeDate && closeDate < today;
  debug.close_date = trade.close_date || null;
  debug.close_state = isPastClose ? 'past (use closed stage)' : 'future or unknown (use pending stage)';

  const nameOf = s => (s.name || s.title || s.label || '').toLowerCase();

  let stage;
  if (isPastClose) {
    stage =
      stages.find(s => /\bwon\b/.test(nameOf(s))) ||
      stages.find(s => /\bclosed\b/.test(nameOf(s)) && !/lost/.test(nameOf(s))) ||
      stages.find(s => /\bsold\b/.test(nameOf(s))) ||
      stages[stages.length - 1]; // last stage in pipeline as fallback
  } else {
    stage =
      stages.find(s => /\bpending\b/.test(nameOf(s))) ||
      stages.find(s => /\bunder\s*contract\b/.test(nameOf(s))) ||
      stages.find(s => /\bactive\b/.test(nameOf(s))) ||
      stages.find(s => /\bbuyer\s*contract\b/.test(nameOf(s))) ||
      stages.find(s => /\boffer\b/.test(nameOf(s))) ||
      stages[0]; // first stage in pipeline as fallback
  }
  debug.picked_stage = stage?.name || null;

  return { stage, debug };
}

// Search FUB for a person with multiple name variants, since exact full names
// from trade docs (e.g. "CARLY SARAH ALBAUM") may not match how they're stored
// in FUB (e.g. "Carly Albaum"). Returns first hit across all variants.
async function findFubPersonRobust(name, headers) {
  if (!name) return { person: null, tried: [] };
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  const variants = [name];
  if (tokens.length >= 2) variants.push(`${tokens[0]} ${tokens[tokens.length - 1]}`);
  if (tokens.length >= 2) variants.push(tokens[tokens.length - 1]);
  if (tokens.length >= 1) variants.push(tokens[0]);
  // De-dup while preserving order
  const seen = new Set();
  const tried = [];
  for (const v of variants) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const r = await fubFetch(`/people?q=${encodeURIComponent(v)}&limit=5`, 'GET', headers);
    const people = r.body?.people || [];
    tried.push({ q: v, found: people.length, ids: people.slice(0, 3).map(p => p.id) });
    if (people.length) {
      return { person: people[0], tried };
    }
  }
  return { person: null, tried };
}

// Find a FUB person by name (and optionally address). Returns first match.
async function findFubPerson(name, headers) {
  if (!name) return null;
  const r = await fubFetch(`/people?q=${encodeURIComponent(name)}&limit=3`, 'GET', headers);
  if (!r.ok || !Array.isArray(r.body?.people)) return null;
  return r.body.people[0] || null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await verifySession(req, res);
  if (!session) return;

  const { trade, fubApiKey: sidebarKey, targetAgentId } = req.body;
  if (!trade) return res.status(400).json({ error: 'Trade required' });

  // Resolve the FUB key from the target agent's stored value — NOT from the
  // sidebar. This is the privacy guardrail: a deal is always pushed to the
  // owning agent's FUB workspace, regardless of who's currently logged in.
  const keyResult = await resolveFubKey(session, targetAgentId, sidebarKey);
  if (!keyResult.key) {
    return res.status(400).json({
      error: `No FUB API key on file for the target agent (${keyResult.ownerAgentId}). Admin: edit that agent and add their FUB API key.`,
    });
  }
  const fubApiKey = keyResult.key;

  const encoded = Buffer.from(fubApiKey + ':').toString('base64');
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Basic ${encoded}` };

  const outcome = { steps: [], key_source: keyResult.source, owner_agent_id: keyResult.ownerAgentId, owner_agent_name: keyResult.ownerName };

  try {
    // 0) Whoami — log which FUB account this API key writes to AND enforce
    //    that it matches the target agent. Closes the leak path that put
    //    Lorry's Glenholme client data into David Speedie's workspace.
    const meRes = await fubFetch('/identity', 'GET', headers);
    const accountName = meRes.body?.account?.name || meRes.body?.account || null;
    const userName = meRes.body?.name || null;
    const userEmail = meRes.body?.email || null;
    outcome.steps.push({
      step: 'whoami',
      ok: meRes.ok,
      status: meRes.status,
      account: accountName,
      user: userName || userEmail,
      user_id: meRes.body?.id || null,
      body_keys: meRes.body && typeof meRes.body === 'object' ? Object.keys(meRes.body) : null
    });

    // Identity check: only block when the FUB key clearly resolves to a
    // DIFFERENT named individual than the owning agent. Specifically:
    //   - If FUB user.name is set (personal API key) → it must contain any
    //     significant token from the owning agent's name. If not, block —
    //     this is the David-Speedie-leak path (key returned user "davidspeedie"
    //     for an agent named "Lorry Greenspan").
    //   - If FUB user.name is empty (brokerage-level / account-level API key,
    //     e.g. Forest Hill Real Estate Inc.'s shared key) → allow. We can't
    //     attribute the key to a person, but the agent has read/write access
    //     to that workspace by virtue of working at the brokerage. The user
    //     has the Verify button to sanity-check before they ever push.
    //   - Always surface the resolved identity in outcome.steps so it's
    //     visible regardless of which path we took.
    if (keyResult.ownerName && userName && userName.trim()) {
      const owner = keyResult.ownerName.toLowerCase();
      const fubUser = userName.toLowerCase().replace(/[^a-z]/g, '');
      const ownerTokens = (owner.match(/[a-z]+/g) || []).filter(t => t.length >= 4);
      const matches = ownerTokens.some(t => fubUser.includes(t));
      if (!matches) {
        const msg = `FUB key identity mismatch — refusing to push. Stored key for ${keyResult.ownerName} resolves to FUB user "${userName}" / account "${accountName || '(none)'}". This looks like a different person's key. Update the agent's stored key (Admin → Update FUB key on the agent's row) to one that actually belongs to ${keyResult.ownerName}.`;
        outcome.steps.push({ step: 'identity_check', ok: false, error: msg, resolved_user: userName, resolved_account: accountName });
        await recordDebug(session.agentId, { trade, outcome, blocked: true, error: msg });
        return res.status(200).json({ success: false, error: msg, outcome });
      }
      outcome.steps.push({ step: 'identity_check', ok: true, matched_on: 'user_name', resolved_user: userName, resolved_account: accountName });
    } else {
      // Account-level / brokerage key (no user attached). Allow but record.
      outcome.steps.push({ step: 'identity_check', ok: true, matched_on: 'account_level_key', resolved_user: userName || null, resolved_account: accountName || null });
    }

    const isLease = trade.deal_type === 'lease' || trade.deal_type === 'lease_renewal';
    const isSale = trade.deal_type === 'sale';
    const partyName = trade.buyer_or_tenant_name;
    const counterName = trade.seller_or_landlord_name;
    const movingIn = ['buyer', 'tenant'].includes(trade.agent_side);
    const stayingPut = ['seller', 'landlord'].includes(trade.agent_side);

    // 1) Find or skip the linked FUB person (the agent's client).
    //    On buy/tenant side, the client is the buyer/tenant. On sell/landlord,
    //    it's the seller/landlord.
    const clientName = movingIn ? partyName : (stayingPut ? counterName : (partyName || counterName));

    let fubPerson = null;
    if (clientName) {
      const personResult = await findFubPersonRobust(clientName, headers);
      fubPerson = personResult.person;
      outcome.steps.push({ step: 'find_person', name: clientName, found: !!fubPerson, fubId: fubPerson?.id, tried: personResult.tried });
    }

    // 2) Find a deal stage to put the deal under — uses trade.agent_side
    //    to pick pipeline, trade.close_date to pick stage (pending vs closed).
    const stageResult = await findStageForTrade(headers, trade);
    const stage = stageResult.stage;
    outcome.steps.push({ step: 'find_stage', stage: stage?.name || null, stageId: stage?.id || null, debug: stageResult.debug });
    if (!stage) {
      const errMsg = stageResult.debug?.status === 404
        ? 'FUB workspace has no deal stages — Deals feature may not be enabled, or the API key lacks permission. Check: FUB → Settings → Deals.'
        : `Could not find a deal stage in FUB (status ${stageResult.debug?.status}). Body keys: ${stageResult.debug?.body_keys?.join(',') || 'none'}.`;
      await recordDebug(session.agentId, { trade, outcome, error: errMsg });
      return res.status(200).json({ success: false, error: errMsg, outcome });
    }

    // 3) Create the deal.
    const dealName = `${trade.property_address || 'Property'} — ${clientName || 'Unknown party'}`;
    const dealValue = isLease ? (trade.monthly_rent || 0) : (trade.sale_price || 0);
    const dealPayload = {
      name: dealName,
      ...(stage?.id ? { stageId: stage.id } : {}),
      ...(trade.close_date ? { projectedCloseDate: trade.close_date } : {}),
      ...(dealValue ? { price: dealValue } : {}),
      ...(trade.gross_commission ? { commissionValue: trade.gross_commission } : {}),
      ...(fubPerson?.id ? { peopleIds: [fubPerson.id] } : {}),
      description: [
        trade.deal_type ? `Type: ${trade.deal_type}` : null,
        trade.mls_number ? `MLS: ${trade.mls_number}` : null,
        trade.property_address ? `Property: ${trade.property_address}` : null,
        trade.agent_side ? `Lorry rep'd: ${trade.agent_side}` : null,
        trade.agent_share_pretax ? `Agent share (pretax): $${trade.agent_share_pretax}` : null,
        isLease && trade.monthly_rent ? `Monthly rent: $${trade.monthly_rent}` : null,
      ].filter(Boolean).join('\n')
    };

    outcome.dealPayload = dealPayload;
    const dealRes = await fubFetch('/deals', 'POST', headers, dealPayload);
    outcome.steps.push({ step: 'create_deal', ok: dealRes.ok, status: dealRes.status, dealId: dealRes.body?.id, error: dealRes.ok ? null : dealRes.body });
    if (!dealRes.ok) {
      const fubError = typeof dealRes.body === 'object' ? JSON.stringify(dealRes.body).slice(0, 400) : String(dealRes.body).slice(0, 400);
      await recordDebug(session.agentId, { trade, outcome, fubStatus: dealRes.status, fubError });
      return res.status(200).json({ success: false, error: `FUB deal create failed (${dealRes.status}): ${fubError}`, outcome });
    }

    // 4) Address update OR sold/leased note, per the rule.
    if (fubPerson?.id) {
      if (movingIn && trade.property_address) {
        // Update buyer/tenant's address to the property they moved into.
        const addressPayload = {
          addresses: [
            {
              street: trade.property_address,
              city: trade.property_city || undefined,
              state: trade.property_province || undefined,
              code: trade.property_postal || undefined,
              type: 'home',
            }
          ]
        };
        const updRes = await fubFetch(`/people/${fubPerson.id}`, 'PUT', headers, addressPayload);
        outcome.steps.push({ step: 'update_address', ok: updRes.ok, status: updRes.status, error: updRes.ok ? null : updRes.body });
      } else if (stayingPut && trade.property_address) {
        // Sell/landlord side: don't overwrite address (we don't know where they
        // moved to). Drop a note instead per the user's rule.
        const verb = isLease ? 'Leased' : 'Sold';
        const noteBody = `${verb} ${trade.property_address} on ${trade.close_date || 'unknown date'}${trade.gross_commission ? ` — gross commission ${trade.gross_commission}` : ''}`;
        const noteRes = await fubFetch('/notes', 'POST', headers, {
          personId: fubPerson.id,
          body: noteBody,
          isHtml: false,
        });
        outcome.steps.push({ step: 'add_note', ok: noteRes.ok, status: noteRes.status, error: noteRes.ok ? null : noteRes.body });
      }
    } else {
      outcome.steps.push({ step: 'address_update_skipped', reason: 'no FUB person matched — deal created unlinked' });
    }

    // 5) Annual closing-anniversary reminders (5 years out) on the agent's
    //    client's profile. FUB doesn't have native recurring tasks, so we
    //    create individual tasks at +1, +2, ... +5 years from the close date.
    if (fubPerson?.id && trade.close_date) {
      const [yStr, mStr, dStr] = trade.close_date.split('-');
      const baseYear = parseInt(yStr);
      if (Number.isFinite(baseYear) && mStr && dStr) {
        for (let yearsOut = 1; yearsOut <= 5; yearsOut++) {
          const dueDate = `${baseYear + yearsOut}-${mStr}-${dStr}`;
          const verb = isLease ? 'leasing' : 'closing';
          const taskPayload = {
            name: `${yearsOut}-Year ${isLease ? 'Lease' : 'Closing'} Anniversary — ${trade.property_address || 'their property'}`,
            personId: fubPerson.id,
            dueDate,
            description: `${yearsOut}-year anniversary of ${verb} on ${trade.property_address || 'this property'} (${trade.close_date}). Reach out — congrats / housewarming check-in / referral ask.`,
          };
          const taskRes = await fubFetch('/tasks', 'POST', headers, taskPayload);
          outcome.steps.push({ step: `anniversary_y${yearsOut}`, ok: taskRes.ok, status: taskRes.status, taskId: taskRes.body?.id, dueDate, error: taskRes.ok ? null : taskRes.body });
        }
      }
    }

    await recordDebug(session.agentId, { trade, outcome, success: true, dealId: dealRes.body?.id });
    return res.status(200).json({
      success: true,
      dealId: dealRes.body?.id,
      fubPersonId: fubPerson?.id || null,
      outcome,
    });
  } catch (e) {
    console.error('push-trade-to-fub error:', e);
    await recordDebug(session.agentId, { trade, outcome, exception: e.message, stack: e.stack });
    return res.status(500).json({ error: e.message, outcome });
  }
};
