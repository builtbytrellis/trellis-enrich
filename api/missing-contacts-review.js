const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

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
        if (cand.status === 'created') continue;
        const d = map[cand.name] || map[cand.name.toLowerCase()] || (req.body.default || 'create');
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

    return res.status(400).json({ error: 'Unknown action' });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
