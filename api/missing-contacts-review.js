const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const { action, targetAgentId, candidates, decision, contactName } = req.body || {};
  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;
  const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  const KEY = `agent:${agentId}:missing_contacts_review`;

  try {
    // SAVE a batch of candidates to the review queue
    if (action === 'save') {
      const existing = await redis.get(KEY);
      const queue = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : [];
      const seen = new Set(queue.map(q => q.name.toLowerCase()));
      for (const c of (candidates || [])) {
        if (!seen.has(c.name.toLowerCase())) {
          queue.push({ ...c, status: 'pending', addedAt: new Date().toISOString() });
          seen.add(c.name.toLowerCase());
        }
      }
      await redis.set(KEY, JSON.stringify(queue));
      return res.status(200).json({ success: true, queue_size: queue.length });
    }

    // LIST the review queue
    if (action === 'list') {
      const existing = await redis.get(KEY);
      const queue = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : [];
      return res.status(200).json({ success: true, candidates: queue });
    }

    // DECIDE on one candidate (create or skip)
    if (action === 'decide') {
      const existing = await redis.get(KEY);
      let queue = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : [];
      const cand = queue.find(q => q.name.toLowerCase() === (contactName||'').toLowerCase());
      if (!cand) return res.status(404).json({ error: 'Candidate not found' });

      if (decision === 'create') {
        // Create the contact in Redis with trade history + Past Client tag
        const contactId = `contact:${agentId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        const record = {
          contactId, agentId,
          full_name: cand.name,
          name: cand.name,
          suggested_tags: [
            { tag: 'Past Client', confidence: 'high', reason: `Closed ${cand.address} (${cand.year})` }
          ],
          trade_history: [{ address: cand.address, close_date: cand.close_date || null, side: cand.side || 'tenant', year: cand.year }],
          notes: `Past ${cand.deal_type||'deal'} client — ${cand.address} (${cand.year}). Added from trade reconciliation.`,
          source: 'reconcile_review',
          needs_enrichment: true,
          savedAt: new Date().toISOString()
        };
        await redis.set(contactId, JSON.stringify(record));
        await redis.lpush(`agent:${agentId}:contacts`, contactId);
        cand.status = 'created';
        cand.contactId = contactId;
      } else {
        cand.status = 'skipped';
      }
      await redis.set(KEY, JSON.stringify(queue));
      return res.status(200).json({ success: true, status: cand.status });
    }

    // CLEAR the queue
    if (action === 'clear') {
      await redis.del(KEY);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
