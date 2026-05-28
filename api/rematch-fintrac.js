const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

// ── Nickname map ──────────────────────────────────────────────────────
const NICKNAMES = {
  'maddy': ['madison','madeline','madeleine'],
  'madison': ['maddy','madeline'],
  'madeline': ['maddy','madison'],
  'jon': ['jonathan','johnathan'],
  'jonathan': ['jon','johnny'],
  'johnny': ['john','jonathan'],
  'john': ['johnny','jon','jonathan'],
  'mike': ['michael'],
  'michael': ['mike','mikey'],
  'alex': ['alexander','alexandra','alexis'],
  'alexander': ['alex','xander'],
  'alexandra': ['alex','alexa'],
  'sam': ['samuel','samantha','samara'],
  'samuel': ['sam'],
  'samantha': ['sam'],
  'dan': ['daniel','danny'],
  'daniel': ['dan','danny'],
  'danny': ['dan','daniel'],
  'dave': ['david'],
  'david': ['dave'],
  'rob': ['robert','robbie'],
  'robert': ['rob','robbie','bob','bobby'],
  'bob': ['robert','rob'],
  'liz': ['elizabeth','lisa'],
  'elizabeth': ['liz','beth','ellie','lisa','libby'],
  'beth': ['elizabeth'],
  'ben': ['benjamin'],
  'benjamin': ['ben','benny'],
  'andy': ['andrew'],
  'andrew': ['andy','drew'],
  'drew': ['andrew'],
  'chris': ['christopher','christian'],
  'christopher': ['chris'],
  'matt': ['matthew'],
  'matthew': ['matt'],
  'nick': ['nicholas'],
  'nicholas': ['nick','nico'],
  'tom': ['thomas','tommy'],
  'thomas': ['tom','tommy'],
  'will': ['william','willy'],
  'william': ['will','bill','billy'],
  'bill': ['william','will'],
  'kate': ['katherine','kathryn','kathy','katie'],
  'katie': ['kate','katherine'],
  'katherine': ['kate','katie','kathy','kat'],
  'kathy': ['katherine','kate'],
  'kat': ['katherine','katelyn'],
  'jen': ['jennifer','jenny'],
  'jennifer': ['jen','jenny'],
  'jenny': ['jennifer','jen'],
  'jess': ['jessica','jessie'],
  'jessica': ['jess','jessie'],
  'jessie': ['jessica','jess'],
  'amy': ['amelia'],
  'amelia': ['amy','millie'],
  'millie': ['amelia','mildred'],
  'steph': ['stephanie'],
  'stephanie': ['steph'],
  'nat': ['natalie','nathan','nathaniel'],
  'natalie': ['nat'],
  'syd': ['sydney','sydnee'],
  'sydney': ['syd'],
  'max': ['maxine','maxwell','maximilian'],
  'jake': ['jacob'],
  'jacob': ['jake'],
  'josh': ['joshua'],
  'joshua': ['josh'],
  'zach': ['zachary'],
  'zachary': ['zach','zak'],
  'becca': ['rebecca'],
  'rebecca': ['becca','becky'],
  'becky': ['rebecca','becca'],
  'abby': ['abigail'],
  'abigail': ['abby'],
  'ally': ['allison','alyssa'],
  'allison': ['ally','allie'],
  'lexi': ['alexis','alexandra'],
  'dani': ['daniela','danielle'],
  'danielle': ['dani'],
  'jodi': ['jodie','judy','judith'],
  'judy': ['judith','jodi'],
  'pam': ['pamela'],
  'pamela': ['pam'],
  'sue': ['susan','suzanne'],
  'susan': ['sue','suzy'],
  'barb': ['barbara'],
  'barbara': ['barb'],
  'laurel': ['laura','lauren'],
  'lauren': ['laurel','laura'],
};

function normName(n) {
  return (n || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function getFirstLast(name) {
  const parts = normName(name).split(' ').filter(t => t.length >= 2);
  if (!parts.length) return { first: '', last: '' };
  return { first: parts[0], last: parts[parts.length - 1] };
}

function getNicknames(name) {
  return [name, ...(NICKNAMES[name] || [])];
}

// Score how well two names match (0 = no match, 1-3 = match strength)
function scoreNameMatch(nameA, nameB) {
  const a = getFirstLast(nameA);
  const b = getFirstLast(nameB);
  if (!a.first || !b.first || !a.last || !b.last) return 0;

  // Last name must match exactly
  if (a.last !== b.last) return 0;

  // First name exact match
  if (a.first === b.first) return 3;

  // First name nickname match
  const aNicks = getNicknames(a.first);
  const bNicks = getNicknames(b.first);
  if (aNicks.some(n => bNicks.includes(n))) return 2;

  // First name starts with same letters (e.g. "Maddy" vs "Madison" both start with "mad")
  const prefix = Math.min(a.first.length, b.first.length, 3);
  if (prefix >= 3 && a.first.slice(0, prefix) === b.first.slice(0, prefix)) return 1;

  return 0;
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
    if (!ids?.length) return res.status(200).json({ matched: [], total: 0 });

    const raws = await Promise.all(ids.map(id => redis.get(id)));
    const contacts = ids.map((id, i) => {
      let c;
      try { c = typeof raws[i] === 'string' ? JSON.parse(raws[i]) : raws[i]; } catch(e) { return null; }
      if (!c) return null;
      return { id, contact: c };
    }).filter(Boolean);

    // Split into: contacts with FINTRAC data, contacts without
    const withFintrac = contacts.filter(({ contact: c }) => c.fintrac_verified || c.birthday || c.job_title);
    const needsFintrac = contacts.filter(({ contact: c }) => !c.fintrac_verified && !c.birthday && !c.job_title);

    const matched = [];
    const updated = [];

    // For each contact needing FINTRAC, try to find a match in withFintrac
    for (const { id: needsId, contact: needs } of needsFintrac) {
      const needsName = needs.full_name || needs.name || '';
      if (!needsName) continue;

      let bestScore = 0;
      let bestMatch = null;

      for (const { contact: has } of withFintrac) {
        const hasName = has.full_name || has.name || '';
        const score = scoreNameMatch(needsName, hasName);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = has;
        }
      }

      if (bestScore >= 1 && bestMatch) {
        matched.push({
          needs_name: needsName,
          matched_to: bestMatch.full_name || bestMatch.name,
          score: bestScore,
          score_label: bestScore === 3 ? 'exact' : bestScore === 2 ? 'nickname' : 'prefix',
          birthday: bestMatch.birthday || null,
          job_title: bestMatch.job_title || null,
          company: bestMatch.company || null,
          fintrac_verified: bestMatch.fintrac_verified || false
        });

        if (!dryRun && bestScore >= 2) { // Only auto-apply nickname/exact matches
          const updated_contact = {
            ...needs,
            birthday: needs.birthday || bestMatch.birthday,
            job_title: needs.job_title || bestMatch.job_title,
            company: needs.company || bestMatch.company,
            fintrac_verified: needs.fintrac_verified || bestMatch.fintrac_verified || false,
          };
          await redis.set(needsId, JSON.stringify(updated_contact));
          updated.push(needsName);
        }
      }
    }

    return res.status(200).json({
      success: true,
      dryRun: dryRun !== false,
      total_contacts: contacts.length,
      needs_fintrac: needsFintrac.length,
      has_fintrac: withFintrac.length,
      matched: matched.length,
      auto_applied: updated.length,
      details: matched
    });

  } catch(e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
