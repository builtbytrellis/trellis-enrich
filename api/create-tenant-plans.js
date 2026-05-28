const fetch = require('node-fetch');
const { verifySession } = require('./auth');

async function fubPost(path, body, apiKey) {
  const encoded = Buffer.from(apiKey + ':').toString('base64');
  const res = await fetch(`https://api.followupboss.com/v1${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${encoded}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

function task(position, runAfterDays, taskName) {
  return {
    id: null, action: 'createTask', position, runAfterDays,
    taskName, taskType: 'Follow Up',
    tags: [], collaborators: [], stageId: null,
    assignedUserId: -1, emailTemplateId: null,
    stopActionPlanId: null, noteDesc: null, noteNotifiers: null
  };
}

function buildPlans(stageMap) { return [
  {
    name: 'Tenant - Conditional',
    steps: [
      task(1,  0,   'Send Deposit Email'),
      stageStep(2, 0, 'Conditional Buyer', stageMap),
      task(3,  0,   'Create Trade aka "Deal Summary Sheet"'),
      task(4,  0,   'Change dates of conditions in checklist'),
      task(5,  0,   'Add conditions expiry date(s) into Google Calendars'),
      task(6,  0,   'Get Deposit Receipt & send to client for their records'),
      task(7,  0,   'Delete prospect match'),
      task(8,  0,   'Add client to Facebook Page'),
      task(9,  0,   'Add client to Instagram'),
      task(10, 0,   'Conditions removed? Prepare Notice of Fulfillment (NoF)'),
      task(11, 1,   'NoF Signed? Confirm both parties signed'),
      stageStep(12, 1, 'Firm Buyer', stageMap),
      task(13, 1,   'Send Next Steps Email (Once deposit received + all conditions waived)'),
      task(14, 1,   'Send introduction email for tenant/listing agent to arrange key exchange'),
      task(15, 23,  'Send 1 week to closing email - hydro set up? Key deposit ready?'),
      task(16, 29,  'Send "Here to help" email 1 day before closing'),
      task(17, 30,  'Send text on closing day - good luck!'),
      stageStep(18, 30, 'Closed', stageMap),
      task(19, 30,  'Add tags: Past Client, Tenant, Potential First Time Buyer'),
      task(20, 30,  'Switch to Tenant - Closing action plan'),
      task(21, 31,  '1 day after closing - How did it go?'),
      task(22, 37,  '7 days after closing - how are you settling in? Anything I can do to help?'),
      task(23, 60,  "30 Days - How's it going?"),
      task(24, 120, 'Hows your place? Hows the landlord?'),
      task(25, 210, 'Still liking your place?'),
      task(26, 305, 'Send 90 Day Reminder Email'),
      task(27, 385, 'Send Handwritten Card - Happy 1 Year!'),
      task(28, 395, 'Happy 1 Year Anniversary! - Switch to Yearly Nurture Plan'),
    ]
  },
  {
    name: 'Tenant - Closing',
    steps: [
      task(1,  0,   'Confirm key exchange time/location with listing agent'),
      task(2,  0,   'Confirm key deposit amount delivered'),
      task(3,  0,   'Confirm utilities transferred (hydro, internet, tenant insurance)'),
      task(4,  0,   'Send final moving day checklist to tenant'),
      stageStep(5, 0, 'Closed', stageMap),
      task(6,  0,   'Add tags: Past Client, Tenant, Potential First Time Buyer'),
      task(7,  1,   'Send closing day text - Good luck today!'),
      task(8,  2,   'Check in - How did the move go?'),
      task(9,  7,   "One week in - how are you settling in?"),
      task(10, 30,  '30 day check-in - loving your new place?'),
      task(11, 335, 'Lease renewal coming up - reach out about plans'),
      task(12, 365, '1 year home anniversary - send note + market update. Switch to Yearly Nurture Plan'),
    ]
  },
  {
    name: 'Landlord - Listing',
    steps: [
      task(1,  0,  'Confirm listing details - price, term, inclusions, pet policy'),
      task(2,  0,  'Prep listing paperwork - Listing Agreement'),
      task(3,  0,  'Book photographer (HDR photos + video if applicable)'),
      task(4,  0,  'Draft MLS listing - save as draft'),
      task(5,  0,  'Upload showing instructions to BrokerBay'),
      task(6,  0,  'Install lockbox'),
      task(7,  0,  'Prepare feature sheet'),
      task(8,  0,  'Add property to agent website'),
      task(9,  0,  'Begin Instagram & Facebook campaigns'),
      task(10, 0,  'Go Live on MLS - send landlord MLS link'),
      task(11, 0,  'Set up neighbourhood PM match'),
      task(12, 3,  'Showing feedback update to landlord'),
      task(13, 7,  'Weekly update call/email to landlord'),
      task(14, 14, 'Two-week review - adjust price or strategy if needed'),
    ]
  },
  {
    name: 'Landlord - Conditional',
    steps: [
      task(1,  0,  'Receive deposit cheque from tenant (confirm with tenant agent)'),
      stageStep(2, 0, 'Conditional Listing', stageMap),
      task(3,  0,  'Run credit check on applicant(s)'),
      task(4,  0,  'Verify employment letter and pay stubs'),
      task(5,  0,  'Check references (previous landlord, employer)'),
      task(6,  0,  'Send reference check results to landlord for approval'),
      task(7,  0,  'Conditions removed? Prepare Notice of Fulfillment (NoF)'),
      task(8,  1,  'NoF Signed? Confirm both parties signed'),
      task(9,  1,  'Prepare lease agreement for signing'),
      task(10, 1,  'Collect first and last month - confirm receipt'),
      task(11, 1,  'Send deposit receipt to both parties'),
      stageStep(12, 1, 'Firm Listing', stageMap),
      task(13, 1,  'Create Trade aka "Deal Summary Sheet"'),
      task(14, 1,  'Add conditions expiry date into Google Calendar'),
    ]
  },
  {
    name: 'Landlord - Closing',
    steps: [
      task(1,  0,  'Confirm key exchange time/location with tenant agent'),
      task(2,  0,  'Confirm first and last month received by landlord'),
      task(3,  0,  'Confirm landlord has all signed documents'),
      task(4,  0,  'Arrange pre-closing walkthrough inspection with landlord'),
      task(5,  0,  'Send closing day reminder to landlord'),
      stageStep(6, 0, 'Closed', stageMap),
      task(7,  0,  'Add tags: Past Client, Landlord'),
      task(8,  1,  'Closing day check-in with landlord - how did key exchange go?'),
      task(9,  7,  "One week in - tenant settled ok?"),
      task(10, 30, '30 day landlord check-in - any issues with tenant?'),
      task(11, 335,'Lease renewal coming up - discuss plans with landlord'),
      task(12, 365,'1 year anniversary - touch base + market update. Switch to Yearly Nurture Plan'),
    ]
  }
];

async function getStageMap(apiKey) {
  const encoded = Buffer.from(apiKey + ':').toString('base64');
  const res = await fetch('https://api.followupboss.com/v1/stages?limit=100', {
    headers: { 'Authorization': `Basic ${encoded}` }
  });
  const d = await res.json();
  const map = {};
  for (const s of (d.stages || [])) {
    map[s.name.toLowerCase()] = s.id;
  }
  return map;
}

function stageStep(position, runAfterDays, stageName, stageMap) {
  const stageId = stageMap[stageName.toLowerCase()] || null;
  return {
    id: null, action: 'changeStage', position, runAfterDays,
    stageId, taskName: null, taskType: null,
    tags: [], collaborators: [],
    assignedUserId: -1, emailTemplateId: null,
    stopActionPlanId: null, noteDesc: null, noteNotifiers: null
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session || session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const targetKey = process.env.DAVID_FUB_KEY;
  if (!targetKey) return res.status(500).json({ error: 'Missing env var: DAVID_FUB_KEY' });

  const { dryRun = true } = req.body;
  const stageMap = await getStageMap(targetKey);
  console.log('David stages:', JSON.stringify(stageMap));
  const LEASE_PLANS = buildPlans(stageMap);
  const results = [];

  for (const plan of LEASE_PLANS) {
    if (dryRun) {
      results.push({ name: plan.name, steps: plan.steps.length, status: 'would_create' });
      continue;
    }
    const r = await fubPost('/actionPlans', { name: plan.name, stopOnContacted: false, steps: plan.steps }, targetKey);
    results.push({
      name: plan.name, steps: plan.steps.length,
      status: (r.status === 200 || r.status === 201) ? 'created' : 'failed',
      id: r.body.id || null,
      error: (r.status !== 200 && r.status !== 201) ? JSON.stringify(r.body) : null
    });
    await new Promise(r => setTimeout(r, 200));
  }

  return res.status(200).json({
    success: true, dryRun,
    total: LEASE_PLANS.length,
    created: results.filter(r => r.status === 'created').length,
    failed: results.filter(r => r.status === 'failed').length,
    results
  });
};
