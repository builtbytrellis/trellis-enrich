const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

// One-time manual corrections for known data errors
const CORRECTIONS = [
  {
    name: 'Matt Freiberg',
    clear: ['birthday', 'job_title', 'fintrac_verified'],
    reason: 'FINTRAC data was wrongly applied from Seth Frieberg'
  },
  {
    name: 'Matt Prager',
    set: { birthday: '1990-11-26', job_title: 'Lawyer', fintrac_verified: true },
    reason: 'Correct FINTRAC data from Matthew William Prager'
  }
];

function normName(s) {
  return (s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

function namesMatch(a, b) {
  const na = normName(a).split(' ').filter(t => t.length >= 2);
  const nb = normName(b).split(' ').filter(t => t.length >= 2);
  if (!na.length || !nb.length) return false;
  return na[0] === nb[0] && na[na.length-1] === nb[nb.length-1];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const { agentId: targetAgentId, dryRun } = req.body;
  const agentId = (session.role === 'admin' && targetAgentId) ? targetAgentId : session.agentId;

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const ids = await redis.lrange(`agent:${agentId}:contacts`, 0, 999);
    const raws = await Promise.all(ids.map(id => redis.get(id)));

    const contacts = ids.map((id, i) => {
      let c; try { c = typeof raws[i] === 'string' ? JSON.parse(raws[i]) : raws[i]; } catch(e) { return null; }
      if (!c) return null;
      return { id, contact: c };
    }).filter(Boolean);

    const results = [];

    for (const correction of CORRECTIONS) {
      const match = contacts.find(({ contact: c }) =>
        namesMatch(correction.name, c.full_name || c.name || '')
      );

      if (!match) {
        results.push({ name: correction.name, status: 'not_found' });
        continue;
      }

      const updated = { ...match.contact };

      if (correction.clear) {
        for (const field of correction.clear) {
          delete updated[field];
          if (field === 'fintrac_verified') updated.fintrac_verified = false;
        }
      }

      if (correction.set) {
        Object.assign(updated, correction.set);
      }

      if (!dryRun) {
        await redis.set(match.id, JSON.stringify(updated));
      }

      results.push({
        name: correction.name,
        matched_to: match.contact.full_name || match.contact.name,
        status: dryRun ? 'would_fix' : 'fixed',
        reason: correction.reason,
        changes: correction.clear ? `cleared: ${correction.clear.join(', ')}` : `set: ${JSON.stringify(correction.set)}`
      });
    }

    return res.status(200).json({ success: true, dryRun: dryRun || false, results });
  } catch(e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
