const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await verifySession(req, res);
  if (!session) return;

  const agentId = (session.role === 'admin' && req.body.targetAgentId)
    ? req.body.targetAgentId
    : session.agentId;

  const { rows } = req.body; // [{full_name, date_of_birth, occupation, filename}]
  if (!rows || !rows.length) return res.status(400).json({ error: 'No rows provided' });

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

    // Load all contacts for this agent
    const ids = await redis.lrange(`agent:${agentId}:contacts`, 0, 999);
    if (!ids || !ids.length) return res.status(200).json({ matched: [], unmatched: rows });

    const raws = await Promise.all(ids.map(id => redis.get(id)));
    const contacts = ids.map((id, i) => {
      const raw = raws[i];
      if (!raw) return null;
      const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return { ...c, _contactId: id };
    }).filter(Boolean);

    // Normalize name for matching
    const normName = s => (s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

    const matched = [];
    const unmatched = [];

    for (const row of rows) {
      if (!row.full_name) { unmatched.push(row); continue; }

      const rowNorm = normName(row.full_name);
      const rowTokens = rowNorm.split(' ').filter(t => t.length >= 2);

      // Find best matching contact — require first + last name match
      let bestMatch = null;
      let bestScore = 0;

      for (const c of contacts) {
        const cNorm = normName(c.full_name || c.name || '');
        const cTokens = cNorm.split(' ').filter(t => t.length >= 2);
        const matchCount = rowTokens.filter(t => cTokens.includes(t)).length;
        const score = matchCount / Math.max(rowTokens.length, cTokens.length);
        if (matchCount >= 2 && score > bestScore) {
          bestScore = score;
          bestMatch = c;
        }
      }

      if (bestMatch) {
        // Convert MM/DD/YYYY to YYYY-MM-DD
        let dob = row.date_of_birth || '';
        if (dob && dob.includes('/')) {
          const parts = dob.split('/');
          if (parts.length === 3) dob = `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
        }

        // Update contact in Redis
        // Parse occupation — may include employer after last comma
        // e.g. "VP Technology, Bank of America" → job_title: VP Technology, company: Bank of America
        let jobTitle = row.occupation || '';
        let company = bestMatch.company || '';
        if (row.occupation && row.occupation.includes(',')) {
          const parts = row.occupation.split(',');
          // Last part is likely employer if it looks like a proper noun (capitalized)
          const lastPart = parts[parts.length - 1].trim();
          if (lastPart && /^[A-Z]/.test(lastPart) && parts.length > 1) {
            jobTitle = parts.slice(0, -1).join(',').trim();
            company = lastPart;
          }
        }

        const updated = {
          ...bestMatch,
          birthday: dob || bestMatch.birthday || '',
          job_title: jobTitle || bestMatch.job_title || '',
          company: company || bestMatch.company || '',
          fintrac_verified: true,
          fintrac_source: row.filename || '',
          fintrac_occupation_full: row.occupation || '',
        };
        delete updated._contactId;
        await redis.set(bestMatch._contactId, JSON.stringify(updated));

        matched.push({
          fintrac_name: row.full_name,
          matched_to: bestMatch.full_name || bestMatch.name,
          birthday: dob,
          occupation: row.occupation,
          score: Math.round(bestScore * 100),
          contactId: bestMatch._contactId,
        });
      } else {
        unmatched.push(row);
      }
    }

    return res.status(200).json({ success: true, matched, unmatched, total: rows.length });
  } catch(e) {
    console.error('import-fintrac-csv error:', e);
    return res.status(500).json({ error: e.message });
  }
};
