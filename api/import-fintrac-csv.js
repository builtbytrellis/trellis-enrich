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

    const normName = s => (s || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

    // Nickname map for fuzzy first-name matching
    const NICKNAMES = {
      'maddy':['madison','madeline'],'madison':['maddy','madeline'],'jon':['jonathan','johnathan'],
      'jonathan':['jon','johnny'],'mike':['michael'],'michael':['mike'],
      'alex':['alexander','alexandra','alexis'],'alexander':['alex'],
      'sam':['samuel','samantha'],'samuel':['sam'],'samantha':['sam'],
      'dan':['daniel','danny'],'daniel':['dan','danny'],'danny':['dan','daniel'],
      'dave':['david'],'david':['dave'],'rob':['robert'],'robert':['rob','bob'],
      'bob':['robert'],'liz':['elizabeth'],'elizabeth':['liz','beth','ellie'],
      'ben':['benjamin'],'benjamin':['ben'],'andy':['andrew'],'andrew':['andy','drew'],
      'chris':['christopher'],'christopher':['chris'],'matt':['matthew'],'matthew':['matt'],
      'nick':['nicholas'],'nicholas':['nick'],'tom':['thomas'],'thomas':['tom'],
      'will':['william'],'william':['will','bill'],'bill':['william'],
      'kate':['katherine','kathryn','kathy','katie'],'katherine':['kate','katie','kathy'],
      'jen':['jennifer'],'jennifer':['jen','jenny'],'jenny':['jennifer'],
      'jess':['jessica'],'jessica':['jess'],'steph':['stephanie'],'stephanie':['steph'],
      'syd':['sydney'],'sydney':['syd'],'jake':['jacob'],'jacob':['jake'],
      'josh':['joshua'],'joshua':['josh'],'zach':['zachary'],'zachary':['zach'],
      'becca':['rebecca'],'rebecca':['becca','becky'],'abby':['abigail'],'abigail':['abby'],
      'dani':['danielle','daniela'],'danielle':['dani'],'nat':['natalie'],'natalie':['nat'],
      'jodi':['jodie','judy'],'judy':['judith','jodi'],'pam':['pamela'],'pamela':['pam'],
      'sue':['susan'],'susan':['sue'],'barb':['barbara'],'barbara':['barb'],
      'lauren':['laurel','laura'],'laurel':['lauren'],
      'lexi':['alexis','alexandra'],'ally':['allison'],'allison':['ally'],
    };

    function getNicks(name) { return [name, ...(NICKNAMES[name] || [])]; }

    function scoreNames(rowName, contactName) {
      const rTokens = normName(rowName).split(' ').filter(t => t.length >= 2);
      const cTokens = normName(contactName).split(' ').filter(t => t.length >= 2);
      if (!rTokens.length || !cTokens.length) return 0;
      const rFirst = rTokens[0], rLast = rTokens[rTokens.length - 1];
      const cFirst = cTokens[0], cLast = cTokens[cTokens.length - 1];
      // Last name must match
      if (rLast !== cLast) return 0;
      // First name exact
      if (rFirst === cFirst) return 3;
      // First name nickname
      if (getNicks(rFirst).includes(cFirst) || getNicks(cFirst).includes(rFirst)) return 2;
      // First name prefix (min 3 chars)
      const pre = Math.min(rFirst.length, cFirst.length, 3);
      if (pre >= 3 && rFirst.slice(0,pre) === cFirst.slice(0,pre)) return 1;
      return 0;
    }

    const matched = [];
    const unmatched = [];

    for (const row of rows) {
      if (!row.full_name) { unmatched.push(row); continue; }

      let bestMatch = null;
      let bestScore = 0;

      for (const c of contacts) {
        const score = scoreNames(row.full_name, c.full_name || c.name || '');
        if (score > bestScore) {
          bestScore = score;
          bestMatch = c;
        }
      }

      // Only auto-apply score 2+ (nickname or exact match)
      // Score 1 (prefix) is too risky — shown as unmatched for human review
      if (bestMatch && bestScore >= 2) {
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
        // Score 1 = possible match but too risky to auto-apply
        if (bestScore === 1 && bestMatch) {
          row._possible_match = bestMatch.full_name || bestMatch.name;
          row._possible_score = 'prefix-only — needs human review';
        }
        unmatched.push(row);
      }
    }

    return res.status(200).json({ success: true, matched, unmatched, total: rows.length });
  } catch(e) {
    console.error('import-fintrac-csv error:', e);
    return res.status(500).json({ error: e.message });
  }
};
