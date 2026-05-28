const { verifySession } = require('./auth');
const fetch = require('node-fetch');

// Replicates all action plans from source FUB account to target FUB account
// Keys come from env vars only — never hardcoded

async function fubGet(path, apiKey) {
  const encoded = Buffer.from(apiKey + ':').toString('base64');
  const res = await fetch(`https://api.followupboss.com/v1${path}`, {
    headers: { 'Authorization': `Basic ${encoded}`, 'Content-Type': 'application/json' }
  });
  return res.json();
}

async function fubPost(path, body, apiKey) {
  const encoded = Buffer.from(apiKey + ':').toString('base64');
  const res = await fetch(`https://api.followupboss.com/v1${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${encoded}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session || session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  // Keys from env vars only
  const sourceKey = process.env.LORRY_FUB_KEY;
  const targetKey = process.env.DAVID_FUB_KEY;

  if (!sourceKey || !targetKey) {
    return res.status(500).json({ 
      error: 'Missing env vars: LORRY_FUB_KEY and DAVID_FUB_KEY must be set in Vercel' 
    });
  }

  const { dryRun = true } = req.body;

  try {
    // 1. Get all action plans from source (Lorry)
    const sourcePlans = await fubGet('/actionPlans?limit=100', sourceKey);
    const plans = sourcePlans.actionPlans || [];
    
    // 2. Get each plan's full steps
    const results = [];
    let created = 0, failed = 0, skipped = 0;

    for (const plan of plans) {
      try {
        const full = await fubGet(`/actionPlans/${plan.id}`, sourceKey);
        
        if (!full.steps?.length) { skipped++; continue; }

        // Build clean payload for target account
        const payload = {
          name: full.name,
          status: full.status || 'Active',
          stopOnContacted: full.stopOnContacted || false,
          sendToAll: full.sendToAll || true,
          steps: full.steps.map(step => {
            const s = {
              action: step.action,
              position: step.position,
              runAfterDays: step.runAfterDays || 0,
            };
            if (step.taskName) s.taskName = step.taskName;
            if (step.taskType) s.taskType = step.taskType;
            if (step.noteDesc) s.noteDesc = step.noteDesc;
            if (step.emailTemplateId) s.emailTemplateId = step.emailTemplateId;
            // Don't copy stageId — stages are account-specific
            return s;
          })
        };

        if (dryRun) {
          results.push({ name: plan.name, steps: payload.steps.length, status: 'would_create' });
          created++;
        } else {
          const r = await fubPost('/actionPlans', payload, targetKey);
          if (r.status === 200 || r.status === 201) {
            results.push({ name: plan.name, steps: payload.steps.length, status: 'created', id: r.body.id });
            created++;
          } else {
            results.push({ name: plan.name, status: 'failed', error: JSON.stringify(r.body) });
            failed++;
          }
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 200));
      } catch(e) {
        results.push({ name: plan.name, status: 'error', error: e.message });
        failed++;
      }
    }

    return res.status(200).json({
      success: true,
      dryRun,
      total: plans.length,
      created,
      failed,
      skipped,
      results
    });

  } catch(e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
