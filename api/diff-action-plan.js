const { verifySession } = require('./auth');
const fetch = require('node-fetch');

async function fubGet(path, apiKey) {
  const encoded = Buffer.from(apiKey + ':').toString('base64');
  const res = await fetch(`https://api.followupboss.com/v1${path}`, {
    headers: { 'Authorization': `Basic ${encoded}`, 'Content-Type': 'application/json' }
  });
  return res.json();
}

function stepLabel(s) {
  const label = String(s.taskName || s.subject || s.templateName || (s.emailTemplateId ? 'Email tmpl '+s.emailTemplateId : '') || '');
  return { day: s.runAfterDays, action: s.action, label: label.trim() };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session || session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const { planName } = req.body || {};
  if (!planName) return res.status(400).json({ error: 'planName required' });

  const davidKey = process.env.DAVID_FUB_KEY;
  const lorryKey = process.env.LORRY_FUB_KEY;

  try {
    const findPlan = async (key) => {
      const list = (await fubGet('/actionPlans?limit=100', key)).actionPlans || [];
      const p = list.find(x => x.name.trim().toLowerCase() === planName.trim().toLowerCase() && !x.sharedActionPlanId);
      if (!p) return null;
      const full = await fubGet(`/actionPlans/${p.id}`, key);
      return (full.steps || []).map(stepLabel).sort((a,b)=> a.day-b.day);
    };

    const david = await findPlan(davidKey);
    const lorry = await findPlan(lorryKey);

    // Build a comparison: match steps by label, show which are in David only / Lorry only / both
    const davidLabels = new Set((david||[]).map(s => s.label.toLowerCase()));
    const lorryLabels = new Set((lorry||[]).map(s => s.label.toLowerCase()));

    const removedFromDavid = (lorry||[]).filter(s => !davidLabels.has(s.label.toLowerCase())); // in Lorry, not David = David removed it
    const addedInDavid = (david||[]).filter(s => !lorryLabels.has(s.label.toLowerCase())); // in David, not Lorry

    return res.status(200).json({
      planName,
      david_steps: david,
      lorry_steps: lorry,
      david_removed_these: removedFromDavid,  // tasks David no longer has (would be removed from Lorry)
      david_added_these: addedInDavid          // tasks David has that Lorry doesn't
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
