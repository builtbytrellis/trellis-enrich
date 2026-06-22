const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');
const fetch = require('node-fetch');

// Name matching (compound/hyphenated surname aware) — mirrors enrich/reconcile
const NICK = {'kate':'katherine','katherine':'kate','katie':'katherine','kathy':'katherine','kat':'katherine',
  'dave':'david','david':'dave','matt':'matthew','matthew':'matt','mike':'michael','michael':'mike',
  'chris':'christopher','christopher':'chris','nick':'nicholas','nicholas':'nick','rob':'robert','robert':'rob',
  'will':'william','william':'will','dan':'daniel','daniel':'dan','tony':'anthony','jen':'jennifer','jenny':'jennifer',
  'liz':'elizabeth','beth':'elizabeth','steph':'stephanie','greg':'gregory','gregory':'greg','andy':'andrew',
  'ben':'benjamin','tom':'thomas','rick':'richard','zach':'zachary','alex':'alexander','abby':'abigail',
  'jacquelyn':'jac','jac':'jacquelyn','jackie':'jacqueline','sam':'samuel','nikki':'nicole','nicole':'nikki'};
function normName(n){return (n||'').toLowerCase().replace(/\s+/g,' ').trim();}
function firstNamesMatch(a,b){
  if(a===b) return true;
  if(NICK[a]===b||NICK[b]===a) return true;
  if(a.length>=3&&b.length>=3&&(a.startsWith(b)||b.startsWith(a))) return true;
  return false;
}
function surnamesMatch(a,b){
  if(a===b) return true;
  const sp=s=>s.split(/[-\s]+/).filter(Boolean);
  const sa=new Set(sp(a));
  for(const part of sp(b)) if(sa.has(part)) return true;
  return false;
}
function nameMatchFuzzy(a,b){
  const ta=normName(a).split(' ').filter(t=>t.length>=2);
  const tb=normName(b).split(' ').filter(t=>t.length>=2);
  if(!ta.length||!tb.length) return false;
  if(!surnamesMatch(ta[ta.length-1],tb[tb.length-1])) return false;
  return firstNamesMatch(ta[0],tb[0]);
}
async function getFubKey(redis, agentId){
  const idRaw = await redis.get(`agent:id:${agentId}`);
  if(!idRaw) return null;
  const a = typeof idRaw==='string'?JSON.parse(idRaw):idRaw;
  return a.fubApiKey || a.fub_api_key || null;
}
async function fubSearch(name, fubKey){
  if(!fubKey) return [];
  try{
    const last = normName(name).split(' ').slice(-1)[0];
    const encoded = Buffer.from(fubKey+':').toString('base64');
    const r = await fetch(`https://api.followupboss.com/v1/people?q=${encodeURIComponent(last)}&limit=25`, { headers:{'Authorization':`Basic ${encoded}`} });
    if(!r.ok) return [];
    const d = await r.json();
    return (d.people||[]).map(p=>({id:p.id, name:p.name||((p.firstName||'')+' '+(p.lastName||'')).trim()}));
  }catch(e){ return []; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const { action, targetAgentId, candidates, decision, contactName, decisions } = req.body || {};
  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;
  const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  const KEY = `agent:${agentId}:missing_contacts_review`;

  // Build a fully-tagged contact record from a candidate that carries deals[]
  function buildRecord(cand) {
    const contactId = `contact:${agentId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const deals = cand.deals && cand.deals.length ? cand.deals : [{ address: cand.address, close_date: cand.close_date || null, side: cand.side || 'tenant', year: cand.year, deal_type: cand.deal_type }];
    const tags = [{ tag: 'Past Client', confidence: 'high', reason: `${deals.length} deal(s) on file` }];
    // Repeat Client tag for 2+ deals
    if (deals.length > 1) {
      tags.push({ tag: 'Repeat Client', confidence: 'high', reason: `${deals.length} deals: ${deals.map(d=>d.year).filter(Boolean).join(', ')}` });
    }
    // Year tags per deal (Buyer 2020 / Seller 2021 / Tenant / Landlord)
    const seenYear = new Set();
    for (const d of deals) {
      if (!d.year && d.close_date) d.year = String(d.close_date).slice(0,4);
      if (!d.year || !d.side) continue;
      const roleCap = d.side.charAt(0).toUpperCase() + d.side.slice(1);
      const yt = `${roleCap} ${d.year}`;
      if (seenYear.has(yt)) continue;
      seenYear.add(yt);
      tags.push({ tag: yt, confidence: 'high', reason: `${roleCap} side of ${d.address} (${d.year})` });
    }
    return {
      contactId, agentId,
      full_name: cand.name, name: cand.name,
      suggested_tags: tags,
      trade_history: deals.map(d => ({ address: d.address, close_date: d.close_date || null, side: d.side || 'tenant', year: d.year, deal_type: d.deal_type })),
      notes: `Past client — ${deals.length} deal(s). Added from trade reconciliation for David's CRM review.`,
      source: 'reconcile_review',
      needs_enrichment: true,
      savedAt: new Date().toISOString()
    };
  }

  try {
    // SAVE a batch of candidates (each may carry deals[])
    if (action === 'save') {
      const existing = await redis.get(KEY);
      const queue = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : [];
      const seen = new Set(queue.map(q => q.name.toLowerCase()));
      let added = 0;
      for (const c of (candidates || [])) {
        if (!seen.has(c.name.toLowerCase())) {
          queue.push({ ...c, status: 'pending', addedAt: new Date().toISOString() });
          seen.add(c.name.toLowerCase());
          added++;
        }
      }
      await redis.set(KEY, JSON.stringify(queue));
      return res.status(200).json({ success: true, queue_size: queue.length, added });
    }

    if (action === 'list') {
      const existing = await redis.get(KEY);
      const queue = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : [];
      return res.status(200).json({ success: true, candidates: queue });
    }

    // DECIDE on one candidate
    if (action === 'decide') {
      const existing = await redis.get(KEY);
      let queue = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : [];
      const cand = queue.find(q => q.name.toLowerCase() === (contactName||'').toLowerCase());
      if (!cand) return res.status(404).json({ error: 'Candidate not found' });
      if (decision === 'create') {
        const record = buildRecord(cand);
        await redis.set(record.contactId, JSON.stringify(record));
        await redis.lpush(`agent:${agentId}:contacts`, record.contactId);
        cand.status = 'created'; cand.contactId = record.contactId;
      } else {
        cand.status = 'skipped';
      }
      await redis.set(KEY, JSON.stringify(queue));
      return res.status(200).json({ success: true, status: cand.status });
    }

    // BULK DECIDE — apply create/skip across many at once (after David deselects)
    if (action === 'bulk_decide') {
      const existing = await redis.get(KEY);
      let queue = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : [];
      let created = 0, skipped = 0;
      // decisions = { "name": "create"|"skip", ... }  OR createAll/skipNames pattern
      const map = decisions || {};
      for (const cand of queue) {
        // Only act on PENDING. Never override 'skipped' (household dupes),
        // 'exists_in_fub' (already in FUB), or 'created'. An explicit per-name
        // decision in `decisions` can still override a pending item.
        const explicit = map[cand.name] || map[cand.name.toLowerCase()];
        if (cand.status !== 'pending' && !explicit) continue;
        const d = explicit || (req.body.default || 'create');
        if (d === 'create') {
          const record = buildRecord(cand);
          await redis.set(record.contactId, JSON.stringify(record));
          await redis.lpush(`agent:${agentId}:contacts`, record.contactId);
          cand.status = 'created'; cand.contactId = record.contactId; created++;
        } else {
          cand.status = 'skipped'; skipped++;
        }
      }
      await redis.set(KEY, JSON.stringify(queue));
      return res.status(200).json({ success: true, created, skipped });
    }

    if (action === 'clear') {
      await redis.del(KEY);
      return res.status(200).json({ success: true });
    }

    // MATCH all pending candidates against the LIVE FUB to prevent duplicate creation
    if (action === 'match_against_fub') {
      const fubKey = await getFubKey(redis, agentId);
      if (!fubKey) return res.status(400).json({ error: 'No FUB key for agent' });
      const existing = await redis.get(KEY);
      let queue = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : [];
      let flagged = 0, checked = 0;
      // cache FUB searches by last name to limit API calls
      const cache = {};
      for (const cand of queue) {
        if (cand.status && cand.status !== 'pending') continue;
        checked++;
        const last = normName(cand.name).split(' ').slice(-1)[0];
        if (!(last in cache)) cache[last] = await fubSearch(cand.name, fubKey);
        const hit = cache[last].find(p => nameMatchFuzzy(cand.name, p.name));
        if (hit) {
          cand.fub_match = { id: hit.id, name: hit.name };
          cand.status = 'exists_in_fub';
          flagged++;
        }
      }
      await redis.set(KEY, JSON.stringify(queue));
      return res.status(200).json({ success: true, checked, already_in_fub: flagged });
    }

    // DELETE a contact by contactId (cleanup for wrongly-created records)
    if (action === 'delete_contact') {
      const { contactId } = req.body;
      if (!contactId) return res.status(400).json({ error: 'contactId required' });
      await redis.lrem(`agent:${agentId}:contacts`, 0, contactId);
      await redis.del(contactId);
      // reset any queue candidate that pointed to it back to pending-or-skip
      const existing = await redis.get(KEY);
      let queue = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : [];
      let reset = 0;
      for (const c of queue) {
        if (c.contactId === contactId) { delete c.contactId; if (c.status==='created') c.status='pending'; reset++; }
      }
      await redis.set(KEY, JSON.stringify(queue));
      return res.status(200).json({ success: true, deleted: contactId, queue_reset: reset });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
