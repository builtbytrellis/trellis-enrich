const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

function normalizeName(name) {
  return (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function namesMatch(a, b) {
  const na = normalizeName(a).split(' ').filter(t => t.length >= 2);
  const nb = normalizeName(b).split(' ').filter(t => t.length >= 2);
  return na.length >= 2 && nb.length >= 2 && na[0] === nb[0] && na[na.length-1] === nb[nb.length-1];
}

function mergeContacts(contacts) {
  // Keep the one with most data, merge missing fields from others
  const base = contacts.reduce((best, c) => {
    const score = Object.values(c).filter(v => v && v !== 'unknown').length;
    const bestScore = Object.values(best).filter(v => v && v !== 'unknown').length;
    return score > bestScore ? c : best;
  });
  
  const merged = { ...base };
  for (const c of contacts) {
    if (c === base) continue;
    const fields = ['email','phone','location','job_title','company','birthday','spouse_name','stage','fintrac_verified','fub_data'];
    for (const f of fields) {
      if ((!merged[f] || merged[f] === 'unknown') && c[f] && c[f] !== 'unknown') merged[f] = c[f];
    }
    // Merge tags
    const tagMap = new Map((merged.suggested_tags||[]).map(t=>[t.tag,t]));
    (c.suggested_tags||[]).forEach(t => { if (!tagMap.has(t.tag)) tagMap.set(t.tag, t); });
    merged.suggested_tags = Array.from(tagMap.values());
    const approvedSet = new Set(merged.approved_tags||[]);
    (c.approved_tags||[]).forEach(t => approvedSet.add(t));
    merged.approved_tags = Array.from(approvedSet);
  }
  return merged;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const agentId = (session.role === 'admin' && req.body?.agentId) ? req.body.agentId : session.agentId;

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const ids = await redis.lrange(`agent:${agentId}:contacts`, 0, 999);
    if (!ids?.length) return res.status(200).json({ deduped: 0, removed: 0 });

    const raws = await Promise.all(ids.map(id => redis.get(id)));
    const contacts = ids.map((id, i) => {
      const raw = raws[i];
      if (!raw) return null;
      let c;
      try { c = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch(e) { return null; }
      if (!c) return null;
      return { id, contact: c, name: c.full_name || c.name || '' };
    }).filter(Boolean);

    // Group by name
    const groups = new Map();
    for (const item of contacts) {
      if (!item.name) continue;
      let found = false;
      for (const [key, group] of groups) {
        if (namesMatch(item.name, key)) {
          group.push(item);
          found = true;
          break;
        }
      }
      if (!found) groups.set(item.name, [item]);
    }

    let deduped = 0, removed = 0;
    for (const [, group] of groups) {
      if (group.length <= 1) continue;
      // Merge all into one
      const merged = mergeContacts(group.map(g => g.contact));
      const keepId = group[0].id;
      await redis.set(keepId, JSON.stringify(merged));
      // Delete the duplicates
      for (let i = 1; i < group.length; i++) {
        await redis.del(group[i].id);
        await redis.lrem(`agent:${agentId}:contacts`, 0, group[i].id);
        removed++;
      }
      deduped++;
    }

    return res.status(200).json({ success: true, deduped, removed, total: contacts.length });
  } catch(e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
