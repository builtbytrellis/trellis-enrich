const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');
const fetch = require('node-fetch');

async function ensureTagExists(tagName, headers) {
  try {
    await fetch('https://api.followupboss.com/v1/tags', {
      method: 'POST', headers, body: JSON.stringify({ name: tagName })
    });
  } catch(e) {}
}

async function addTagToFubContact(fubId, newTag, existingTags, headers) {
  const existing = existingTags.map(t => typeof t === 'string' ? t : (t.name || ''));
  if (existing.includes(newTag)) return 'already_tagged';
  const merged = [...existing, newTag];
  const res = await fetch(`https://api.followupboss.com/v1/people/${fubId}`, {
    method: 'PUT', headers, body: JSON.stringify({ tags: merged })
  });
  return res.ok ? 'tagged' : 'failed';
}

const REALTOR_PATTERNS = /real estate agent|realtor|\bbroker\b|property manager|re\/max|royal lepage|century 21|keller williams|sotheby|chestnut park|forest hill real estate|harvey kalles|bosley|sage real estate|listing agent|buyers agent|real estate salesperson/i;

const ONLINE_LEAD_SOURCES = /zillow|realtor\.ca|zoocasa|housesigma|point2|commonflooor|online lead|web lead|website|landing page|facebook lead|google lead|instagram lead/i;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const { fubApiKey, agentId: targetAgentId, dryRun, operations } = req.body;
  // operations: array of 'realtors' | 'online_leads' | 'not_enriched'
  const ops = operations || ['realtors', 'online_leads', 'not_enriched'];
  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;

  if (!fubApiKey) return res.status(400).json({ error: 'FUB API key required' });

  const encoded = Buffer.from(fubApiKey + ':').toString('base64');
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Basic ${encoded}` };

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const ids = await redis.lrange(`agent:${agentId}:contacts`, 0, 999);
    if (!ids?.length) return res.status(200).json({ results: [], total: 0 });

    const raws = await Promise.all(ids.map(id => redis.get(id)));
    const contacts = ids.map((id, i) => {
      const raw = raws[i]; if (!raw) return null;
      let c;
      try { c = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch(e) { return null; }
      if (!c) return null;
      return { id, contact: c };
    }).filter(Boolean);

    // Pre-create tags in FUB
    if (!dryRun) {
      if (ops.includes('realtors')) await ensureTagExists('Profession: Real Estate Agent', headers);
      if (ops.includes('online_leads')) await ensureTagExists('Source: Online Lead', headers);
      if (ops.includes('not_enriched')) await ensureTagExists('Not Enriched', headers);
    }

    const results = { realtors: [], online_leads: [], not_enriched: [] };

    for (const { id, contact: c } of contacts) {
      const name = c.full_name || c.name || '';
      const jobTitle = (c.job_title || '').toLowerCase();
      const company = (c.company || '').toLowerCase();
      const source = (c.fub_data?.source || c.source || '').toLowerCase();
      const notes = (c.notes || '').toLowerCase();
      const existingTags = (c.approved_tags || c.suggested_tags?.map(t=>t.tag) || []);
      const fubId = c.fub_data?.fub_id;
      // If no stored fub_id, search FUB by name
      let resolvedFubId = fubId;
      if (!resolvedFubId && name && !dryRun) {
        try {
          const sr = await fetch(`https://api.followupboss.com/v1/people?q=${encodeURIComponent(name)}&limit=1`, { headers });
          if (sr.ok) {
            const sd = await sr.json();
            if (sd.people?.[0]) resolvedFubId = sd.people[0].id;
          }
        } catch(e) {}
      }

      // ── Realtors ──
      if (ops.includes('realtors')) {
        const isRealtor = REALTOR_PATTERNS.test(jobTitle) || REALTOR_PATTERNS.test(company) ||
          REALTOR_PATTERNS.test(notes) || existingTags.includes('Profession: Real Estate Agent');
        if (isRealtor) {
          results.realtors.push({ name, fubId });
          if (!dryRun) {
            // Update Redis
            const updatedTags = [...new Set([...existingTags, 'Profession: Real Estate Agent'])];
            await redis.set(id, JSON.stringify({ ...c, approved_tags: updatedTags }));
            // Update FUB
            if (resolvedFubId) await addTagToFubContact(resolvedFubId, 'Profession: Real Estate Agent', c.fub_data?.existing_tags || [], headers);
          }
        }
      }

      // ── Online Leads ──
      if (ops.includes('online_leads')) {
        const isOnlineLead = ONLINE_LEAD_SOURCES.test(source) || ONLINE_LEAD_SOURCES.test(notes) ||
          existingTags.some(t => /online|web lead|zillow|zoocasa/i.test(t));
        if (isOnlineLead) {
          results.online_leads.push({ name, fubId });
          if (!dryRun) {
            const updatedTags = [...new Set([...existingTags, 'Source: Online Lead'])];
            await redis.set(id, JSON.stringify({ ...c, approved_tags: updatedTags }));
            if (resolvedFubId) await addTagToFubContact(resolvedFubId, 'Source: Online Lead', c.fub_data?.existing_tags || [], headers);
          }
        }
      }

      // ── Not Enriched ──
      if (ops.includes('not_enriched')) {
        const hasEnrichment = (c.job_title && c.job_title !== 'unknown') ||
          (c.company && c.company !== 'unknown') ||
          c.birthday || c.fintrac_verified ||
          (existingTags.length > 0 && !existingTags.every(t => t === 'Not Enriched')) ||
          (c.notes && c.notes.length > 20 && c.notes !== 'unknown');
        if (!hasEnrichment) {
          results.not_enriched.push({ name, fubId });
          if (!dryRun) {
            const updatedTags = [...new Set([...existingTags, 'Not Enriched'])];
            await redis.set(id, JSON.stringify({ ...c, approved_tags: updatedTags }));
            if (resolvedFubId) await addTagToFubContact(resolvedFubId, 'Not Enriched', c.fub_data?.existing_tags || [], headers);
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      dryRun: dryRun || false,
      realtors: results.realtors.length,
      online_leads: results.online_leads.length,
      not_enriched: results.not_enriched.length,
      details: results
    });
  } catch(e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
