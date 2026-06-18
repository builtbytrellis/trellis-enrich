const { verifySession } = require('./auth');
const fetch = require('node-fetch');

async function fubGet(path, apiKey) {
  const encoded = Buffer.from(apiKey + ':').toString('base64');
  const res = await fetch(`https://api.followupboss.com/v1${path}`, {
    headers: { 'Authorization': `Basic ${encoded}`, 'Content-Type': 'application/json' }
  });
  return res.json();
}
async function fubReq(method, path, body, apiKey) {
  const encoded = Buffer.from(apiKey + ':').toString('base64');
  const res = await fetch(`https://api.followupboss.com/v1${path}`, {
    method,
    headers: { 'Authorization': `Basic ${encoded}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  let parsed = null; try { parsed = await res.json(); } catch(e){}
  return { status: res.status, body: parsed };
}

function myPlansOnly(list) {
  return (list || []).filter(p =>
    !p.sharedActionPlanId && !p.isDefaultBuyerPlan && !p.isDefaultSellerPlan && !/test|delete/i.test(p.name)
  );
}

function stepSignature(steps) {
  return (steps || []).slice().sort((a,b)=>(a.position||0)-(b.position||0))
    .map(s => {
      const label = String(s.taskName || s.subject || s.templateName || s.emailTemplateId || '');
      return `${s.action}|${s.runAfterDays}|${label.trim().slice(0,60)}`;
    }).join(' >> ');
}

// Build a clean create-payload from a source plan's full detail
function buildPayload(full) {
  const steps = (full.steps || []).map(s => {
    const step = {
      id: null,
      action: s.action,
      position: s.position,
      runAfterDays: s.runAfterDays,
      tags: s.tags || [],
      collaborators: s.collaborators || []
    };
    if (s.taskName) step.taskName = s.taskName;
    if (s.taskType) step.taskType = s.taskType;
    if (s.subject) step.subject = s.subject;
    if (s.body) step.body = s.body;
    if (s.emailTemplateId) step.emailTemplateId = s.emailTemplateId;
    if (s.assignedTo) step.assignedTo = s.assignedTo;
    if (s.stageId) step.stageId = s.stageId;
    if (s.note) step.note = s.note;
    return step;
  });
  return {
    name: full.name,
    status: undefined, // never send status on create
    stopOnContacted: full.stopOnContacted,
    delaySmsMinutes: full.delaySmsMinutes,
    initialTextMessageEnabled: full.initialTextMessageEnabled,
    initialTextMessage: full.initialTextMessage,
    steps
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session || session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const { dryRun = true, targetKey: targetKeyName } = req.body || {};
  const davidKey = process.env.DAVID_FUB_KEY;
  // Default target = Lorry, but allow other agents later by env name
  const targetKey = targetKeyName ? process.env[targetKeyName] : process.env.LORRY_FUB_KEY;
  if (!davidKey || !targetKey) return res.status(500).json({ error: 'Missing DAVID_FUB_KEY or target key' });

  try {
    const srcPlans = myPlansOnly((await fubGet('/actionPlans?limit=100', davidKey)).actionPlans);
    const tgtPlans = (await fubGet('/actionPlans?limit=100', targetKey)).actionPlans || [];
    const tgtByName = {};
    for (const p of tgtPlans) tgtByName[p.name.trim().toLowerCase()] = p;

    const actions = [];
    for (const src of srcPlans) {
      const full = await fubGet(`/actionPlans/${src.id}`, davidKey);
      if (!full.steps || !full.steps.length) continue; // never sync empty

      const existing = tgtByName[src.name.trim().toLowerCase()];
      let inUse = false;
      if (existing) {
        const tgtFull = await fubGet(`/actionPlans/${existing.id}`, targetKey);
        inUse = !!tgtFull.isUsed || (tgtFull.contactsRunningCount||0) > 0;
        // Skip if identical — no need to churn unchanged plans
        if (stepSignature(tgtFull.steps) === stepSignature(full.steps)) {
          continue;
        }
      }

      const plan = { name: src.name, steps: full.steps.length, action: existing ? 'replace' : 'create', inUse };
      actions.push(plan);

      if (!dryRun) {
        // SAFETY: never delete a plan that's actively running on contacts
        if (existing && !inUse) {
          await fubReq('DELETE', `/actionPlans/${existing.id}`, null, targetKey);
        } else if (existing && inUse) {
          plan.action = 'skipped_in_use';
          continue;
        }
        const payload = buildPayload(full);
        const r = await fubReq('POST', '/actionPlans', payload, targetKey);
        plan.result = r.status;
        if (r.status >= 400) plan.error = JSON.stringify(r.body).slice(0,150);
      }
    }

    return res.status(200).json({
      success: true,
      dryRun,
      total: actions.length,
      to_replace: actions.filter(a=>a.action==='replace').length,
      to_create: actions.filter(a=>a.action==='create').length,
      skipped_in_use: actions.filter(a=>a.action==='skipped_in_use').length,
      actions
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
