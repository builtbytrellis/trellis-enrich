const { verifySession } = require('./auth');
const fetch = require('node-fetch');

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
  let parsed = null; try { parsed = await res.json(); } catch(e){}
  return { status: res.status, body: parsed };
}

// PROVEN step-creation payload (matches working replicate-action-plans.js)
function buildPayload(full) {
  return {
    name: full.name,
    stopOnContacted: full.stopOnContacted || false,
    sendToAll: full.sendToAll || true,
    steps: (full.steps || []).map(step => ({
      id: null,
      action: step.action,
      position: step.position,
      runAfterDays: step.runAfterDays || 0,
      taskName: step.taskName || null,
      taskType: step.taskType || 'Follow Up',
      tags: [],
      collaborators: [],
      stageId: null,
      assignedUserId: -1,
      emailTemplateId: step.emailTemplateId || null,
      stopActionPlanId: step.stopActionPlanId || null,
      noteDesc: step.noteDesc || null,
      noteNotifiers: step.noteNotifiers || null,
    }))
  };
}

// David's "My Action Plans" = user-created originals, not system/shared/default/test
function myPlansOnly(list) {
  return (list || []).filter(p =>
    p.createdById > 0 &&
    !p.sharedActionPlanId &&
    !p.isDefaultBuyerPlan &&
    !p.isDefaultSellerPlan &&
    !/test|delete/i.test(p.name)
  );
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session || session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const { dryRun = true, singlePlan = null, skipExisting = true, updateExisting = false } = req.body || {};
  const davidKey = process.env.DAVID_FUB_KEY;
  const lorryKey = process.env.LORRY_FUB_KEY;
  if (!davidKey || !lorryKey) return res.status(500).json({ error: 'Missing DAVID_FUB_KEY or LORRY_FUB_KEY' });

  try {
    let srcPlans = myPlansOnly((await fubGet('/actionPlans?limit=100', davidKey)).actionPlans);

    // Optionally restrict to a single plan by name (for the test-one-first step)
    if (singlePlan) {
      srcPlans = srcPlans.filter(p => p.name.trim().toLowerCase() === singlePlan.trim().toLowerCase());
    }

    // Current Lorry plan names (to skip existing if requested)
    const lorryPlans = (await fubGet('/actionPlans?limit=100', lorryKey)).actionPlans || [];
    const lorryNames = new Set(lorryPlans.map(p => p.name.trim().toLowerCase()));

    const results = [];
    let created = 0, failed = 0, skipped = 0;

    for (const plan of srcPlans) {
      const full = await fubGet(`/actionPlans/${plan.id}`, davidKey);
      if (!full.steps?.length) { skipped++; results.push({name:plan.name, status:'skipped_empty_source'}); continue; }

      const existingPlan = lorryPlans.find(p => p.name.trim().toLowerCase() === plan.name.trim().toLowerCase());

      // UPDATE-IN-PLACE mode: PUT David's steps onto Lorry's existing plan (no delete, no duplicate)
      if (updateExisting && existingPlan) {
        if (dryRun) { results.push({name:plan.name, status:'would_update', steps:full.steps.length}); created++; continue; }
        const payload = buildPayload(full);
        const enc2 = Buffer.from(lorryKey + ':').toString('base64');
        const ur = await fetch(`https://api.followupboss.com/v1/actionPlans/${existingPlan.id}`, {
          method: 'PUT',
          headers: { 'Authorization': `Basic ${enc2}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        let ub = null; try { ub = await ur.json(); } catch(e){}
        // verify
        const verify = await fubGet(`/actionPlans/${existingPlan.id}`, lorryKey);
        const landed = (verify.steps||[]).length;
        const ok = ur.status<400 && Math.abs(landed - full.steps.length) <= 1 && landed > 0;
        results.push({ name: plan.name, status: ok ? 'updated_verified' : 'update_FAILED', http: ur.status, expected: full.steps.length, landed, id: existingPlan.id });
        if (ok) created++; else failed++;
        await new Promise(r => setTimeout(r, 250));
        continue;
      }

      if (skipExisting && lorryNames.has(plan.name.trim().toLowerCase())) {
        skipped++; results.push({name:plan.name, status:'skipped_exists'}); continue;
      }

      if (dryRun) {
        results.push({ name: plan.name, steps: full.steps.length, status: 'would_create' });
        created++;
      } else {
        const payload = buildPayload(full);
        const r = await fubPost('/actionPlans', payload, lorryKey);
        if (r.status === 200 || r.status === 201) {
          // VERIFY the steps actually landed
          const verify = await fubGet(`/actionPlans/${r.body.id}`, lorryKey);
          const landed = (verify.steps || []).length;
          results.push({ name: plan.name, status: landed === full.steps.length ? 'created_verified' : 'created_STEP_MISMATCH', expected: full.steps.length, landed, id: r.body.id });
          created++;
        } else {
          results.push({ name: plan.name, status: 'failed', error: JSON.stringify(r.body).slice(0,150) });
          failed++;
        }
        await new Promise(r => setTimeout(r, 250));
      }
    }

    return res.status(200).json({ success: true, dryRun, total: srcPlans.length, created, failed, skipped, results });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
