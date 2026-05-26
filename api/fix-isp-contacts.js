const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

// ISP/consumer email providers that should never be treated as employers
const ISP_DOMAINS = [
  'rogers.com', 'bell.ca', 'bellnet.ca', 'sympatico.ca',
  'cogeco.ca', 'cogeco.net', 'videotron.ca', 'shaw.ca',
  'telus.net', 'telus.com', 'eastlink.ca', 'mts.net',
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.ca',
  'hotmail.com', 'hotmail.ca', 'outlook.com', 'live.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'ymail.com', 'msn.com', 'protonmail.com', 'proton.me'
];

const ISP_COMPANIES = [
  'rogers', 'bell canada', 'bell telecom', 'cogeco', 'videotron',
  'shaw', 'telus', 'eastlink', 'mts', 'sympatico'
];

// Check if company name is an ISP
function isISP(company) {
  if (!company) return false;
  const lower = company.toLowerCase().trim();
  return ISP_COMPANIES.some(isp => lower === isp || lower === isp + ' communications' || lower === isp + ' media');
}

// Check if notes contain ISP inference text
function hasISPNote(notes) {
  if (!notes) return false;
  const lower = notes.toLowerCase();
  return ISP_COMPANIES.some(isp => lower.includes(`works at ${isp}`) || lower.includes(`at ${isp} —`) || lower.includes(`at ${isp} (`));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session) return;

  const agentId = (session.role === 'admin' && req.body?.agentId) ? req.body.agentId : session.agentId;
  const dryRun = req.body?.dryRun !== false; // default to dry run for safety

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const ids = await redis.lrange(`agent:${agentId}:contacts`, 0, 999);
    if (!ids?.length) return res.status(200).json({ fixed: [], total: 0 });

    const raws = await Promise.all(ids.map(id => redis.get(id)));
    const fixed = [];

    for (let i = 0; i < ids.length; i++) {
      const raw = raws[i];
      if (!raw) continue;
      const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
      
      const changes = [];
      const updated = { ...c };

      // Clear ISP company
      if (isISP(c.company)) {
        changes.push(`company: "${c.company}" → cleared`);
        updated.company = '';
      }

      // Clear ISP job title if it was inferred (e.g. "Tech/Telecom")
      if (c.job_title && /tech\/telecom|telecom/i.test(c.job_title)) {
        changes.push(`job_title: "${c.job_title}" → cleared`);
        updated.job_title = '';
      }

      // Clear ISP references from notes/background
      if (hasISPNote(c.notes)) {
        const cleaned = (c.notes || '')
          .split('\n')
          .filter(line => !ISP_COMPANIES.some(isp => line.toLowerCase().includes(`works at ${isp}`) || line.toLowerCase().includes(`at ${isp} —`)))
          .join('\n')
          .trim();
        if (cleaned !== c.notes) {
          changes.push(`notes: ISP reference removed`);
          updated.notes = cleaned;
        }
      }

      // Remove bad Profession: Tech tag if company was ISP
      if (changes.length && updated.suggested_tags) {
        const hadTech = updated.suggested_tags.find(t => t.tag === 'Profession: Tech' && t.reason?.toLowerCase().includes('rogers'));
        if (hadTech) {
          updated.suggested_tags = updated.suggested_tags.filter(t => !(t.tag === 'Profession: Tech' && t.reason?.toLowerCase().includes('rogers')));
          updated.approved_tags = (updated.approved_tags || []).filter(t => t !== 'Profession: Tech');
          changes.push(`tag: "Profession: Tech" (Rogers) removed`);
        }
      }

      if (changes.length) {
        fixed.push({ name: c.full_name || c.name, changes });
        if (!dryRun) {
          await redis.set(ids[i], JSON.stringify(updated));
        }
      }
    }

    return res.status(200).json({ 
      success: true, 
      dryRun,
      fixed, 
      count: fixed.length,
      total: ids.length 
    });
  } catch(e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
