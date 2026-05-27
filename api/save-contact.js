const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

// Normalize name for matching — lowercase, trim, collapse spaces
function normalizeName(name) {
  return (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Check if two names are the same person
// Requires both first and last token to match
function namesMatch(a, b) {
  const na = normalizeName(a).split(' ').filter(t => t.length >= 2);
  const nb = normalizeName(b).split(' ').filter(t => t.length >= 2);
  if (!na.length || !nb.length) return false;
  // Both first and last token must match
  return na[0] === nb[0] && na[na.length - 1] === nb[nb.length - 1];
}

// Deep merge — new values only fill in if existing value is empty/null
function mergeContact(existing, incoming) {
  const merged = { ...existing };
  const fields = [
    'email', 'phone', 'location', 'job_title', 'company',
    'birthday', 'spouse_name', 'stage',
    'likely_age_range', 'confidence_overall', 'fub_data',
    'fintrac_verified', 'interests'
  ];
  for (const f of fields) {
    if (!merged[f] && incoming[f]) merged[f] = incoming[f];
  }
  // Notes: append incoming (voice memos are additive)
  if (incoming.notes && incoming.notes !== merged.notes) {
    merged.notes = merged.notes ? merged.notes + '\n\n' + incoming.notes : incoming.notes;
  }
  // Clear needs_review when a voice memo is merged in
  if (incoming.has_voice_memo) merged.needs_review = false;
  // Merge suggested_tags — deduplicate by tag name
  const existingTags = existing.suggested_tags || [];
  const incomingTags = incoming.suggested_tags || [];
  const tagMap = new Map();
  [...existingTags, ...incomingTags].forEach(t => {
    if (!tagMap.has(t.tag)) tagMap.set(t.tag, t);
  });
  merged.suggested_tags = Array.from(tagMap.values());

  // Merge approved_tags
  const existingApproved = new Set(existing.approved_tags || []);
  (incoming.approved_tags || []).forEach(t => existingApproved.add(t));
  merged.approved_tags = Array.from(existingApproved);

  // Always update enrichment metadata if incoming has better confidence
  if (incoming.full_name && !existing.full_name) merged.full_name = incoming.full_name;
  if (incoming.initials) merged.initials = incoming.initials;

  // Keep the most recent enrichment data but preserve FINTRAC/trade data
  merged.lastEnrichedAt = new Date().toISOString();
  merged.pushed = existing.pushed || false;

  return merged;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await verifySession(req, res);
  if (!session) return;

  const { contact, targetAgentId } = req.body;
  if (!contact) return res.status(400).json({ error: 'Contact required' });

  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

    const incomingName = contact.full_name || contact.name || '';

    const { targetContactId } = req.body;

    // ── Exact-bind path: targetContactId bypasses fuzzy matching ──
    let existingId = null;
    let existingContact = null;

    if (targetContactId) {
      try {
        const raw = await redis.get(targetContactId);
        if (raw) {
          const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
          // Ownership check
          if (c.agentId === agentId || session.role === 'admin') {
            existingId = targetContactId;
            existingContact = c;
          }
        }
      } catch(e) { console.warn('targetContactId lookup failed:', e.message); }
    }

    // ── Fuzzy name match (fallback when no targetContactId) ──
    if (!existingId) {
      const ids = await redis.lrange(`agent:${agentId}:contacts`, 0, 999);
      if (ids && ids.length && incomingName) {
        const raws = await Promise.all(ids.map(id => redis.get(id)));
        for (let i = 0; i < ids.length; i++) {
          const raw = raws[i];
          if (!raw) continue;
          let c;
          try { c = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch(e) { continue; }
          if (!c) continue;
          const cName = c.full_name || c.name || '';
          if (namesMatch(incomingName, cName)) {
            existingId = ids[i];
            existingContact = c;
            break;
          }
        }
      }
    }

    if (existingContact && existingId) {
      // ── MERGE into existing record ──
      const merged = mergeContact(existingContact, contact);
      merged.savedAt = existingContact.savedAt; // keep original date
      merged.agentId = agentId;
      await redis.set(existingId, JSON.stringify(merged));
      return res.status(200).json({ success: true, contactId: existingId, action: 'merged' });
    } else {
      // ── CREATE new record ──
      const contactId = `contact:${agentId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const contactData = { ...contact, savedAt: new Date().toISOString(), agentId };
      await redis.set(contactId, JSON.stringify(contactData));
      await redis.lpush(`agent:${agentId}:contacts`, contactId);
      await redis.ltrim(`agent:${agentId}:contacts`, 0, 999);
      return res.status(200).json({ success: true, contactId, action: 'created' });
    }
  } catch(e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
