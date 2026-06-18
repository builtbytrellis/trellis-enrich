const { verifySession } = require('./auth');
const fetch = require('node-fetch');

async function fubGet(path, apiKey) {
  const encoded = Buffer.from(apiKey + ':').toString('base64');
  const res = await fetch(`https://api.followupboss.com/v1${path}`, {
    headers: { 'Authorization': `Basic ${encoded}`, 'Content-Type': 'application/json' }
  });
  return res.json();
}

// Normalize a plan's steps into a comparable signature: action|runAfterDays|taskName/subject
function stepSignature(steps) {
  return (steps || [])
    .slice()
    .sort((a,b) => (a.position||0) - (b.position||0))
    .map(s => {
      const label = String(s.taskName || s.subject || s.templateName || s.emailTemplateId || '');
      return `${s.action}|${s.runAfterDays}|${label.trim().slice(0,60)}`;
    })
    .join(' >> ');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session || session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  // SOURCE = David (the edited plans), TARGET = Lorry (where edits should go)
  const sourceKey = process.env.DAVID_FUB_KEY;
  const targetKey = process.env.LORRY_FUB_KEY;
  if (!sourceKey || !targetKey) return res.status(500).json({ error: 'Missing DAVID_FUB_KEY or LORRY_FUB_KEY' });

  try {
    // "My Action Plans" in FUB = user-created originals, not shared-template copies or system defaults.
    function myPlansOnly(list) {
      return (list || []).filter(p =>
        !p.sharedActionPlanId &&            // not a copy of a shared template
        !p.isDefaultBuyerPlan &&
        !p.isDefaultSellerPlan &&
        !/test|delete/i.test(p.name)        // exclude test junk
      );
    }
    const srcList = myPlansOnly((await fubGet('/actionPlans?limit=100', sourceKey)).actionPlans);
    const tgtList = myPlansOnly((await fubGet('/actionPlans?limit=100', targetKey)).actionPlans);

    const tgtByName = {};
    for (const p of tgtList) tgtByName[p.name.trim().toLowerCase()] = p;

    const report = [];
    for (const src of srcList) {
      // Skip obvious test/junk plans
      if (/test|delete/i.test(src.name)) continue;

      const tgt = tgtByName[src.name.trim().toLowerCase()];
      // Fetch full step detail for both
      const srcFull = await fubGet(`/actionPlans/${src.id}`, sourceKey);
      if (!srcFull.steps || srcFull.steps.length === 0) continue; // skip empty
      const srcSig = stepSignature(srcFull.steps);

      if (!tgt) {
        report.push({
          name: src.name,
          status: 'MISSING_IN_LORRY',
          david_steps: (srcFull.steps||[]).length,
          lorry_steps: 0,
          lorry_in_use: false
        });
        continue;
      }

      const tgtFull = await fubGet(`/actionPlans/${tgt.id}`, targetKey);
      const tgtSig = stepSignature(tgtFull.steps);

      const differs = srcSig !== tgtSig;
      report.push({
        name: src.name,
        status: differs ? 'DIFFERS' : 'IDENTICAL',
        david_steps: (srcFull.steps||[]).length,
        lorry_steps: (tgtFull.steps||[]).length,
        lorry_plan_id: tgt.id,
        lorry_in_use: !!tgtFull.isUsed || (tgtFull.contactsRunningCount||0) > 0,
        lorry_contacts_running: tgtFull.contactsRunningCount || 0
      });
    }

    const differs = report.filter(r => r.status === 'DIFFERS');
    const missing = report.filter(r => r.status === 'MISSING_IN_LORRY');
    const identical = report.filter(r => r.status === 'IDENTICAL');

    return res.status(200).json({
      success: true,
      summary: {
        total_david_plans: report.length,
        differs: differs.length,
        missing_in_lorry: missing.length,
        identical: identical.length,
        in_use_that_differ: differs.filter(r => r.lorry_in_use).length
      },
      differs,
      missing,
      identical: identical.map(r => r.name)
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
