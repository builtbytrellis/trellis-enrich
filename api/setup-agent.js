const fetch = require('node-fetch');
const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

// ── FUB helpers ──────────────────────────────────────────────────────
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

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Stage lookup ──────────────────────────────────────────────────────
async function getStageMap(apiKey) {
  const d = await fubGet('/stages?limit=100', apiKey);
  const map = {};
  for (const s of (d.stages || [])) map[s.name.toLowerCase()] = s.id;
  return map;
}

// ── Step builders ─────────────────────────────────────────────────────
function task(position, runAfterDays, taskName) {
  return { id: null, action: 'createTask', position, runAfterDays, taskName, taskType: 'Follow Up', tags: [], collaborators: [], stageId: null, assignedUserId: -1, emailTemplateId: null, stopActionPlanId: null, noteDesc: null, noteNotifiers: null };
}
function stage(position, runAfterDays, stageName, stageMap) {
  return { id: null, action: 'changeStage', position, runAfterDays, stageId: stageMap[stageName.toLowerCase()] || null, taskName: null, taskType: null, tags: [], collaborators: [], assignedUserId: -1, emailTemplateId: null, stopActionPlanId: null, noteDesc: null, noteNotifiers: null };
}

// ── PART 1: Replicate action plans from source agent ──────────────────
async function replicateActionPlans(sourceKey, targetKey) {
  const sourcePlans = await fubGet('/actionPlans?limit=100', sourceKey);
  const plans = (sourcePlans.actionPlans || []).filter(p => p.createdById > 0);
  const results = [];
  for (const plan of plans) {
    const full = await fubGet(`/actionPlans/${plan.id}`, sourceKey);
    if (!full.steps?.length) continue;
    const payload = {
      name: full.name,
      stopOnContacted: full.stopOnContacted || false,
      steps: full.steps.map(s => ({
        id: null, action: s.action, position: s.position, runAfterDays: s.runAfterDays || 0,
        taskName: s.taskName || null, taskType: s.taskType || 'Follow Up',
        tags: [], collaborators: [], stageId: null,
        assignedUserId: -1, emailTemplateId: s.emailTemplateId || null,
        stopActionPlanId: s.stopActionPlanId || null, noteDesc: s.noteDesc || null, noteNotifiers: s.noteNotifiers || null,
      }))
    };
    const r = await fubPost('/actionPlans', payload, targetKey);
    results.push({ name: plan.name, status: r.status === 200 || r.status === 201 ? 'created' : 'failed', error: r.body?.errorMessage || null });
    await delay(200);
  }
  return results;
}

// ── PART 2: Create lease plans ────────────────────────────────────────
async function createLeasePlans(targetKey) {
  const stageMap = await getStageMap(targetKey);
  const plans = [
    {
      name: 'Tenant - Conditional',
      steps: [
        task(1,0,'Send Deposit Email'), stage(2,0,'Conditional Buyer',stageMap),
        task(3,0,'Create Trade aka "Deal Summary Sheet"'),
        task(4,0,'Change dates of conditions in checklist'),
        task(5,0,'Add conditions expiry date(s) into Google Calendars'),
        task(6,0,'Get Deposit Receipt & send to client for their records'),
        task(7,0,'Delete prospect match'), task(8,0,'Add client to Facebook Page'),
        task(9,0,'Add client to Instagram'),
        task(10,0,'Conditions removed? Prepare Notice of Fulfillment (NoF)'),
        task(11,1,'NoF Signed? Confirm both parties signed'),
        stage(12,1,'Firm Buyer',stageMap),
        task(13,1,'Send Next Steps Email (Once deposit received + all conditions waived)'),
        task(14,1,'Send introduction email for tenant/listing agent to arrange key exchange'),
        task(15,23,'Send 1 week to closing email - hydro set up? Key deposit ready?'),
        task(16,29,'Send "Here to help" email 1 day before closing'),
        task(17,30,'Send text on closing day - good luck!'),
        stage(18,30,'Closed',stageMap),
        task(19,30,'Add tags: Past Client, Tenant, Potential First Time Buyer'),
        task(20,30,'Switch to Tenant - Closing action plan'),
        task(21,31,'1 day after closing - How did it go?'),
        task(22,37,'7 days after closing - how are you settling in?'),
        task(23,60,"30 Days - How's it going?"),
        task(24,120,'Hows your place? Hows the landlord?'),
        task(25,210,'Still liking your place?'),
        task(26,305,'Send 90 Day Reminder Email'),
        task(27,385,'Send Handwritten Card - Happy 1 Year!'),
        task(28,395,'Happy 1 Year Anniversary! - Switch to Yearly Nurture Plan'),
      ]
    },
    {
      name: 'Tenant - Closing',
      steps: [
        task(1,0,'Confirm key exchange time/location with listing agent'),
        task(2,0,'Confirm key deposit amount delivered'),
        task(3,0,'Confirm utilities transferred (hydro, internet, tenant insurance)'),
        task(4,0,'Send final moving day checklist to tenant'),
        stage(5,0,'Closed',stageMap),
        task(6,0,'Add tags: Past Client, Tenant, Potential First Time Buyer'),
        task(7,1,'Send closing day text - Good luck today!'),
        task(8,2,'Check in - How did the move go?'),
        task(9,7,"One week in - how are you settling in?"),
        task(10,30,"30 day check-in - loving your new place?"),
        task(11,335,'Lease renewal coming up - reach out about plans'),
        task(12,365,'1 year home anniversary - send note + market update. Switch to Yearly Nurture Plan'),
      ]
    },
    {
      name: 'Landlord - Listing',
      steps: [
        task(1,0,'Confirm listing details - price, term, inclusions, pet policy'),
        task(2,0,'Prep listing paperwork - Listing Agreement'),
        task(3,0,'Book photographer (HDR photos + video if applicable)'),
        task(4,0,'Draft MLS listing - save as draft'),
        task(5,0,'Upload showing instructions to BrokerBay'),
        task(6,0,'Install lockbox'), task(7,0,'Prepare feature sheet'),
        task(8,0,'Add property to agent website'),
        task(9,0,'Begin Instagram & Facebook campaigns'),
        task(10,0,'Go Live on MLS - send landlord MLS link'),
        task(11,0,'Set up neighbourhood PM match'),
        task(12,3,'Showing feedback update to landlord'),
        task(13,7,'Weekly update call/email to landlord'),
        task(14,14,'Two-week review - adjust price or strategy if needed'),
      ]
    },
    {
      name: 'Landlord - Conditional',
      steps: [
        task(1,0,'Receive deposit cheque from tenant (confirm with tenant agent)'),
        stage(2,0,'Conditional Listing',stageMap),
        task(3,0,'Run credit check on applicant(s)'),
        task(4,0,'Verify employment letter and pay stubs'),
        task(5,0,'Check references (previous landlord, employer)'),
        task(6,0,'Send reference check results to landlord for approval'),
        task(7,0,'Conditions removed? Prepare Notice of Fulfillment (NoF)'),
        task(8,1,'NoF Signed? Confirm both parties signed'),
        task(9,1,'Prepare lease agreement for signing'),
        task(10,1,'Collect first and last month - confirm receipt'),
        task(11,1,'Send deposit receipt to both parties'),
        stage(12,1,'Firm Listing',stageMap),
        task(13,1,'Create Trade aka "Deal Summary Sheet"'),
        task(14,1,'Add conditions expiry date into Google Calendar'),
      ]
    },
    {
      name: 'Landlord - Closing',
      steps: [
        task(1,0,'Confirm key exchange time/location with tenant agent'),
        task(2,0,'Confirm first and last month received by landlord'),
        task(3,0,'Confirm landlord has all signed documents'),
        task(4,0,'Arrange pre-closing walkthrough inspection with landlord'),
        task(5,0,'Send closing day reminder to landlord'),
        stage(6,0,'Closed',stageMap),
        task(7,0,'Add tags: Past Client, Landlord'),
        task(8,1,'Closing day check-in with landlord - how did key exchange go?'),
        task(9,7,"One week in - tenant settled ok?"),
        task(10,30,'30 day landlord check-in - any issues with tenant?'),
        task(11,335,'Lease renewal coming up - discuss plans with landlord'),
        task(12,365,'1 year anniversary - touch base + market update. Switch to Yearly Nurture Plan'),
      ]
    }
  ];

  const results = [];
  for (const plan of plans) {
    const r = await fubPost('/actionPlans', { name: plan.name, stopOnContacted: false, steps: plan.steps }, targetKey);
    results.push({ name: plan.name, status: r.status === 200 || r.status === 201 ? 'created' : 'failed', error: r.body?.errorMessage || null });
    await delay(200);
  }
  return results;
}

// ── PART 3: Create email templates ────────────────────────────────────
async function createEmailTemplates(targetKey) {
  const templates = [
    { name: "Next Steps: Tenant (Rental Accepted)", subject: "Next Steps: %property_address%", body: `<p>Hi %contact_rels_first_name%,</p><p>Congrats on getting your lease accepted! Here is what we need to tackle right away:</p><ol><li>Deposit cheque by [DEADLINE]</li><li>Arrange tenant insurance</li><li>Prepare post-dated cheques</li></ol><p><strong>Deposit Cheque</strong></p><p>We need a certified cheque or bank draft for $[AMOUNT] to the landlord's brokerage by [DEADLINE]. Make it out to "[LISTING BROKERAGE] Inc." and deliver to [Brokerage Address].</p><p><strong>Post-Dated Cheques</strong></p><p>[#] post-dated monthly cheques for $[AMOUNT] made out to "[LANDLORD NAME]" dated [SECOND MONTH] through [LAST MONTH].</p><p><strong>Lease Start Date</strong></p><p>[DAY, DATE]</p><p><strong>Tenant Insurance</strong></p><p>Required before move-in. Let me know if you need a recommendation.</p><p><strong>New Mailing Address</strong></p><p>[# Street Name], [City], ON [Postal Code]</p><p>Reach out any time with questions.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>` },
    { name: "Next Steps: Buyer - Freehold (Offer Accepted)", subject: "Next Steps: %property_address%", body: `<p>Hi %contact_rels_first_name%,</p><p>Congrats on your accepted offer on [PROPERTY ADDRESS]!</p><ol><li>Deposit cheque by [DEADLINE]</li><li>Financing condition fulfilled by [DEADLINE]</li><li>Home inspection condition fulfilled by [DEADLINE]</li></ol><p><strong>Deposit Cheque</strong></p><p>Certified cheque or bank draft for $[AMOUNT] to the selling brokerage by [DEADLINE].</p><p><strong>Financing</strong></p><p>Condition due [DATE]. I will prepare the Notice of Fulfillment once your broker confirms. Let me know if you need a recommendation.</p><p><strong>Home Inspection</strong></p><p>Condition due [DATE]. I recommend Carson Dunlop - let me know your preferred time and I will book it.<br>Sheila Corman | 416-964-9415 | info@carsondunlop.com</p><p><strong>Lawyer</strong></p><p>Send me your lawyer's contact info and I will forward all documents. Happy to recommend one if needed.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>` },
    { name: "Next Steps: Buyer - Condo (Offer Accepted)", subject: "Next Steps: %property_address%", body: `<p>Hi %contact_rels_first_name%,</p><p>Congrats on [PROPERTY ADDRESS]!</p><ol><li>Deposit cheque by [DEADLINE]</li><li>Financing condition fulfilled by [DEADLINE]</li><li>Status certificate condition fulfilled by [DEADLINE]</li></ol><p><strong>Deposit Cheque</strong></p><p>Certified cheque or bank draft for $[AMOUNT] to the listing brokerage by [DEADLINE].</p><p><strong>Financing</strong></p><p>Condition due [DATE]. Notice of Fulfillment prepared once your broker confirms.</p><p><strong>Status Certificate</strong></p><p>Once received you have 2 days to review with your lawyer. I will prepare the Notice of Fulfillment once satisfied.</p><p><strong>Lawyer</strong></p><p>Send me their details and I will coordinate all documents. Happy to recommend if needed.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>` },
    { name: "Next Steps: Seller - Pre-Listing Freehold", subject: "Next Steps: Getting Your Home Ready for Market", body: `<p>Hi %contact_rels_first_name%,</p><p>Getting close! Before we go live on [DATE] I need a couple of things from you.</p><p><strong>Lawyer</strong></p><p>Please send me your lawyer's contact info so I can send documents as soon as a deal comes in. Happy to recommend if needed.</p><p><strong>Mortgage Broker</strong></p><p>If you have an existing mortgage please provide your broker's info so we can loop them in.</p><p><strong>Prospect Match</strong></p><p>You are set up to receive alerts for comparable homes listing near [ADDRESS].</p><p>Almost there. Talk soon,<br>%agent_first_name%</p>` },
    { name: "Next Steps: Seller - Pre-Listing Condo", subject: "Next Steps: Getting Your Condo Ready for Market", body: `<p>Hi %contact_rels_first_name%,</p><p>Before we go live on [DATE] here is what we need right away.</p><ol><li>Order status certificate by [DEADLINE]</li><li>Send lawyer and mortgage broker contact info</li></ol><p><strong>Status Certificate</strong></p><p>Please order from [PROPERTY MANAGEMENT COMPANY] by [DEADLINE]. Let me know once ordered.</p><p><strong>Lawyer and Mortgage Broker</strong></p><p>Send contact info so I can forward documents as soon as a deal comes in. Happy to provide recommendations.</p><p><strong>Prospect Match</strong></p><p>You are set up to receive alerts for comparable units in your building.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>` },
    { name: "Countdown to Closing: Buyers", subject: "You're Firm! Closing Info for %property_address%", body: `<p>Hi %contact_rels_first_name%,</p><p>Congrats on your firm deal! Here is everything you need to know heading into closing.</p><p><strong>Closing Date</strong></p><p>[CLOSING DATE]</p><p><strong>Lawyer Meeting</strong></p><p>Meet with your lawyer a few days before closing to sign final paperwork and pick up keys. They will confirm your closing costs bank draft amount.</p><p><strong>Mortgage</strong></p><p>Sign final mortgage docs with your lender before closing. They send instructions to your lawyer.</p><p><strong>Home Insurance</strong></p><p>Make sure insurance is in place. Let me know if you need a recommendation.</p><p><strong>Buyer Visits</strong></p><p>You are entitled to 2 visits before closing. I recommend one the day before to check all appliances and chattels. Let me know right away if anything is not working.</p><p><strong>Your New Address</strong></p><p>[# Street Name], [City], ON [Postal Code]</p><p>So excited for you. Reach out any time.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>` },
    { name: "Countdown to Closing: Sellers", subject: "Closing Day is Almost Here: %property_address%", body: `<p>Hi %contact_rels_first_name%,</p><p>Congrats again on the firm deal. A couple of reminders heading into closing.</p><p><strong>Closing Date</strong></p><p>[CLOSING DATE]</p><p><strong>Lawyer Meeting</strong></p><p>Coordinate paperwork signing and key delivery with your lawyer before closing.</p><p><strong>Appliances and Chattels</strong></p><p>Please check everything at least one day before closing. Let me know right away if anything is not working so we can address it before the buyers take possession.</p><p><strong>Buyer Visits</strong></p><p>Buyers are entitled to 2 visits with 24-hour notice. I will notify you as soon as they are booked.</p><p>Almost there. Reach out any time.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>` },
    { name: "Day of Live Listing", subject: "We're Live! %property_address%", body: `<p>Hi %contact_rels_first_name%,</p><p>Your listing is live on MLS today! Here are all your marketing links:</p><ul><li>MLS Listing: [LINK]</li><li>Property Website: [LINK]</li><li>Video: [LINK]</li><li>Photos: [LINK]</li></ul><p><strong>Showings</strong></p><p>You will receive showing requests to accept. This gives you advance notice before agents bring buyers through.</p><p><strong>While Listed</strong></p><ul><li>Leave the lockbox on the front door until sold (code: [CODE])</li><li>Hide all valuables</li><li>Keep the home staged, clean, and tidy at all times</li><li>Lights on and curtains open during showings</li><li>Best to not be home during showings</li></ul><p>I will send weekly updates with showing counts and agent feedback.</p><p>Really excited. Reach out any time.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>` },
    { name: "3 Days Before Going Live", subject: "Almost Live: %property_address%", body: `<p>Hi %contact_rels_first_name%,</p><p>We go live on [DAY]. A few things to keep in mind:</p><ul><li>Agents use the lockbox for showings. Code: [CODE]. Keep key in until sold.</li><li>Hide all valuables during the listing period.</li><li>I will notify you of all showings. Please be as accommodating as possible with timing.</li><li>Most showings are booked last minute. Slots are 1 hour but buyers often run behind.</li><li>Best if no one is home during showings.</li><li>Keep the home staged, clean, and tidy throughout.</li><li>Minimize fragrant cooking and remove all air fresheners.</li><li>Lights on and curtains open during showings especially at night.</li><li>Be accessible by phone and email when we get an offer.</li></ul><p>Open house is [DAY/TIME] if applicable.</p><p>Almost there. Reach out with any questions.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>` },
    { name: "Offer Presentation Reminder", subject: "Offer Presentation Tonight: %property_address%", body: `<p>Hi [AGENT NAME],</p><p>On behalf of my clients, thank you for showing [ADDRESS]. This [X] bed, [X] bath [TYPE] is accepting offers tonight.</p><p><strong>Property Details</strong></p><ul><li>MLS #[NUMBER] | Listed at $[PRICE]</li><li>[X] Beds | [X] Baths | [X] Parking | [NEIGHBOURHOOD]</li></ul><p><strong>Offer Details</strong></p><ul><li>Tonight: [DAY, DATE] at [TIME] | email to david@davidspeedie.com</li><li>Register by [TIME]: 647.244.3931</li><li>Minimum 2 signed copies required</li><li>Deposit: min 5% certified cheque or bank draft</li><li>Closing: [DATE] preferred | Condition-free offers preferred</li><li>Inclusions: [LIST]</li></ul><p>Feedback always appreciated if not bringing an offer.</p><p>%agent_first_name% %agent_last_name% | %agent_phone% | %agent_email%</p>` },
    { name: "Google Review Request", subject: "How Was Working With Me?", body: `<p>Hi %contact_rels_first_name%,</p><p>Now that things have settled I just wanted to say it was genuinely great working with you.</p><p>If you had a good experience and have a couple of minutes, a Google review would mean a lot to me. It is one of the best ways to help me grow and keep doing what I love.</p><p>[GOOGLE REVIEW LINK]</p><p>No pressure at all. And please do not hesitate to reach out any time if you need anything or have friends or family looking to buy, sell, or rent in Toronto.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>` }
  ];

  const results = [];
  for (const t of templates) {
    const r = await fubPost('/templates', t, targetKey);
    results.push({ name: t.name, status: r.status === 200 || r.status === 201 ? 'created' : 'failed', error: r.body?.errorMessage || null });
    await delay(150);
  }
  return results;
}

// ── Main handler ──────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session || session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const { agentId, dryRun = false } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });

  const sourceKey = process.env.LORRY_FUB_KEY;
  if (!sourceKey) return res.status(500).json({ error: 'Missing env var: LORRY_FUB_KEY' });

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const raw = await redis.get(`agent:${agentId}`);
    if (!raw) return res.status(404).json({ error: `Agent ${agentId} not found in Redis` });

    const agent = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const targetKey = agent.fubApiKey;
    if (!targetKey) return res.status(400).json({ error: `Agent ${agentId} has no FUB API key stored. Add it first via Update FUB key.` });

    if (dryRun) {
      return res.status(200).json({
        success: true, dryRun: true,
        agent: agent.name || agentId,
        steps: ['Replicate action plans from Lorry (18 plans)', 'Create 5 lease plans (Tenant/Landlord)', 'Create 11 email templates']
      });
    }

    // Run all three steps
    const [actionPlans, leasePlans, emailTemplates] = await Promise.all([
      replicateActionPlans(sourceKey, targetKey),
      createLeasePlans(targetKey),
      createEmailTemplates(targetKey)
    ]);

    const summary = {
      actionPlans: { created: actionPlans.filter(r => r.status === 'created').length, failed: actionPlans.filter(r => r.status === 'failed').length },
      leasePlans: { created: leasePlans.filter(r => r.status === 'created').length, failed: leasePlans.filter(r => r.status === 'failed').length },
      emailTemplates: { created: emailTemplates.filter(r => r.status === 'created').length, failed: emailTemplates.filter(r => r.status === 'failed').length },
    };

    return res.status(200).json({ success: true, dryRun: false, agent: agent.name || agentId, summary, actionPlans, leasePlans, emailTemplates });
  } catch(e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
};
