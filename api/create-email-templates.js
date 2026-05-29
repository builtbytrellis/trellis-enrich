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

const TEMPLATES = [
  {
    name: "Next Steps: Tenant (Rental Accepted)",
    subject: "Next Steps: %property_address%",
    body: "<p>Hi %contact_rels_first_name%,</p><p>Congratulations on securing your new home! Below is everything you need to take care of before move-in.</p><p><strong>1. Hydro / Water Account</strong></p><p>Set up your account with [HYDRO PROVIDER] before your lease start date.</p><ul><li>Visit [HYDRO PROVIDER WEBSITE] and click Sign Up</li><li>Account start date: [LEASE START DATE]</li></ul><p><strong>2. Elevator Booking</strong></p><p>Book the elevator as soon as possible as move times fill up quickly. You may also need to complete registration forms with the building.</p><ul><li>Concierge: [CONCIERGE PHONE]</li><li>On-Site Property Manager: [PROPERTY MANAGER PHONE]</li></ul><p><strong>3. Tenant Insurance</strong></p><p>You will need tenant insurance in place before your move-in date. A few options to compare:</p><ul><li>Square One Insurance: www.squareoneinsurance.ca</li><li>Belair Direct: www.belairdirect.com</li><li>Your bank may also offer competitive rates</li></ul><p>Requirements: minimum $2,000,000 liability coverage, effective [LEASE START DATE]. Please send me a copy of the policy for the landlord's records.</p><p><strong>4. Visits and Key Exchange</strong></p><p>[KEY EXCHANGE DETAILS]. Do a full walk-through on key exchange day and take photos and videos of the unit. Always best to have documentation in case any issues come up at the end of the tenancy.</p><p>Landlord: [LANDLORD NAME] | [LANDLORD PHONE] | [LANDLORD EMAIL]</p><p>Emergencies - Listing Agent: [LISTING AGENT NAME] | [LISTING AGENT PHONE] | [LISTING AGENT EMAIL]</p><p><strong>5. Key Deposit and Rent Payments</strong></p><ul><li>[LEASE START DATE]: E-transfer $[KEY DEPOSIT AMOUNT] key deposit to [E-TRANSFER EMAIL] (refunded at end of lease when all keys and fobs are returned)</li><li>[FIRST RENT DATE]: First rent payment of $[RENT AMOUNT] due</li></ul><p>E-transfer for future payments: [E-TRANSFER EMAIL]</p><p><strong>6. Ontario Standard Lease</strong></p><p>The listing agent will send over the Ontario Standard Lease which outlines everything agreed upon in the Agreement to Lease. I will forward it as soon as I receive it.</p><p><strong>7. Additional Services to Set Up</strong></p><ul><li>Internet</li><li>Cable</li><li>Telephone</li></ul><p><strong>8. Change of Address</strong></p><ul><li>Canada Post</li><li>Service Ontario (driver's licence, health card)</li><li>Banks and credit cards</li><li>Subscriptions and any other important accounts</li></ul><p><strong>Your New Address</strong></p><p>[# Street Name][, Suite if applicable], [City], ON [Postal Code]</p><p>Always here if you need anything. Do not hesitate to reach out with any questions.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>"
  },
  {
    name: "Next Steps: Buyer - Freehold (Offer Accepted)",
    subject: "Next Steps: %property_address%",
    body: "<p>Hi %contact_rels_first_name%,</p><p>Congrats on your accepted offer on [PROPERTY ADDRESS]!</p><ol><li>Deposit cheque by [DEADLINE]</li><li>Financing condition fulfilled by [DEADLINE]</li><li>Home inspection condition fulfilled by [DEADLINE]</li></ol><p><strong>Deposit Cheque</strong></p><p>Certified cheque or bank draft for $[AMOUNT] to the selling brokerage by [DEADLINE].</p><p><strong>Financing</strong></p><p>Condition due [DATE]. I will prepare the Notice of Fulfillment once your broker confirms. Let me know if you need a recommendation.</p><p><strong>Home Inspection</strong></p><p>Condition due [DATE]. I recommend Carson Dunlop.<br>Sheila Corman | 416-964-9415 | info@carsondunlop.com</p><p><strong>Lawyer</strong></p><p>Send me your lawyer's contact info and I will forward all documents. Happy to recommend one if needed.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>"
  },
  {
    name: "Next Steps: Buyer - Condo (Offer Accepted)",
    subject: "Next Steps: %property_address%",
    body: "<p>Hi %contact_rels_first_name%,</p><p>Congrats on [PROPERTY ADDRESS]!</p><ol><li>Deposit cheque by [DEADLINE]</li><li>Financing condition fulfilled by [DEADLINE]</li><li>Status certificate condition fulfilled by [DEADLINE]</li></ol><p><strong>Deposit Cheque</strong></p><p>Certified cheque or bank draft for $[AMOUNT] to the listing brokerage by [DEADLINE].</p><p><strong>Financing</strong></p><p>Condition due [DATE]. Notice of Fulfillment prepared once your broker confirms.</p><p><strong>Status Certificate</strong></p><p>Once received you have 2 days to review with your lawyer.</p><p><strong>Lawyer</strong></p><p>Send me their details and I will coordinate all documents.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>"
  },
  {
    name: "Next Steps: Seller - Pre-Listing Freehold",
    subject: "Next Steps: Getting Your Home Ready for Market",
    body: "<p>Hi %contact_rels_first_name%,</p><p>Getting close! Before we go live on [DATE] there are a few things we need to wrap up. Please let me know what date you think you will be ready to list so I can get everything ready on my end.</p><p><strong>1. Information Form</strong></p><p>This form covers the basic information we need to prepare your listing paperwork. You will review and sign everything before it is finalized. If you need to make any changes after submitting just let me know.</p><p>Please click <a href='[GOOGLE FORM LINK]'>here</a> to fill it out online.</p><p><strong>2. Coming Soon Sign</strong></p><p>We will install a coming soon sign 1 week before going live on MLS. This draws attention and builds excitement before the property officially hits the market.</p><p><strong>3. Pre-List Home Inspection</strong></p><p>I want to arrange a pre-list home inspection to avoid conditional offers on offer night. The inspector will need about 2 hours and access to both the interior and exterior. Let me know when works and I will get it booked.</p><p><strong>4. Sellers Schedule / Workback</strong></p><p>I have prepared a sellers schedule so we can work together to get your home ready for sale. Please review and update it as things get done so we stay on the same page.</p><p><strong>5. Lawyer and Mortgage Broker</strong></p><p>Please send me the contact info for your lawyer and mortgage broker (name, firm, phone, email) so I can send documents as soon as they are needed. Happy to provide recommendations if needed.</p><p><strong>6. Prospect Match</strong></p><p>You are set up to receive alerts for comparable homes listing near [ADDRESS] so you can keep tabs on the competition.</p><p>I know that was a lot. Take your time and reach out any time with questions.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>"
  },
  {
    name: "Next Steps: Seller - Pre-Listing Condo",
    subject: "Next Steps: Getting Your Condo Ready for Market",
    body: "<p>Hi %contact_rels_first_name%,</p><p>Before we go live on [DATE] here is what we need right away.</p><ol><li>Order status certificate by [DEADLINE]</li><li>Send lawyer and mortgage broker contact info</li></ol><p><strong>Status Certificate</strong></p><p>Please order from [PROPERTY MANAGEMENT COMPANY] by [DEADLINE]. Let me know once ordered.</p><p><strong>Prospect Match</strong></p><p>You are set up to receive alerts for comparable units in your building.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>"
  },
  {
    name: "Countdown to Closing: Buyers",
    subject: "You're Firm! Closing Info for %property_address%",
    body: "<p>Hi %contact_rels_first_name%,</p><p>Congratulations, you are officially firm and soon to be homeowners! So excited for you. Here is everything you need to know heading into closing.</p><p><strong>Closing Date</strong></p><p>[CLOSING DATE]</p><p><strong>Financing</strong></p><p>Please send a copy of the accepted offer and Notice of Fulfillment to your mortgage broker. You will need to coordinate the financing and signing of your final mortgage documents with your lender in the days before closing. They will then send the mortgage instructions to your lawyer.</p><p><strong>Lawyer Meeting</strong></p><p>You will also need to coordinate signing the final paperwork with your lawyer. At this meeting you will need to bring a bank draft for your closing costs. Your lawyer will confirm the exact amount.</p><p>If you need a lawyer recommendation: [LAWYER NAME AND CONTACT]</p><p><strong>Home Insurance</strong></p><p>Make sure you have home and car insurance in place. If you need a recommendation, [YOUR INSURANCE RECOMMENDATION].</p><p><strong>Buyer Visits</strong></p><p>You are entitled to [2 or 3] buyer visits before closing. I recommend booking your last visit for the day before closing to check all appliances and chattels. If anything is not right let me know immediately so we can address it before closing day.</p><p><strong>Change of Address and Other Reminders</strong></p><ul><li>Update your address with Canada Post, Service Ontario, banks, subscriptions</li><li>Register children at local schools if applicable</li><li>Notify your landlord if you are currently renting</li></ul><p><strong>Your New Address</strong></p><p>[# Street Name], [City], ON [Postal Code]</p><p>So excited for you. I am here any time. Almost there!</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>"
  },
  {
    name: "Countdown to Closing: Sellers",
    subject: "Closing Day is Almost Here: %property_address%",
    body: "<p>Hi %contact_rels_first_name%,</p><p>Congrats again on the firm deal. A couple of reminders heading into closing.</p><p><strong>Closing Date</strong></p><p>[CLOSING DATE]</p><p><strong>Lawyer Meeting</strong></p><p>Coordinate paperwork signing and key delivery with your lawyer before closing.</p><p><strong>Appliances and Chattels</strong></p><p>Please check everything at least one day before closing. Let me know right away if anything is not working so we can address it before the buyers take possession.</p><p><strong>Buyer Visits</strong></p><p>Buyers are entitled to 2 visits with 24-hour notice. I will notify you as soon as they are booked.</p><p>Almost there. Reach out any time.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>"
  },
  {
    name: "Day of Live Listing",
    subject: "We're Live! %property_address%",
    body: "<p>Hi %contact_rels_first_name%,</p><p>Your listing is live on MLS today! Here are all your marketing links:</p><ul><li>MLS Listing: [LINK]</li><li>Property Website: [LINK]</li><li>Video: [LINK]</li><li>Photos: [LINK]</li></ul><p><strong>Showings</strong></p><p>You will receive showing requests to accept. This gives you advance notice before agents bring buyers through.</p><p><strong>While Listed</strong></p><ul><li>Leave the lockbox on the front door until sold (code: [CODE])</li><li>Hide all valuables</li><li>Keep the home staged, clean, and tidy at all times</li><li>Lights on and curtains open during showings</li><li>Best to not be home during showings</li></ul><p>I will send weekly updates with showing counts and agent feedback.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>"
  },
  {
    name: "3 Days Before Going Live",
    subject: "Almost Live: %property_address%",
    body: "<p>Hi %contact_rels_first_name%,</p><p>We go live on [DAY]. A few things to keep in mind:</p><ul><li>Agents use the lockbox for showings. Code: [CODE]. Keep key in until sold.</li><li>Hide all valuables.</li><li>I will notify you of all showings. Please be as accommodating as possible with timing.</li><li>Keep the home staged, clean, and tidy throughout.</li><li>Lights on and curtains open during showings.</li><li>Be accessible by phone and email when we get an offer.</li></ul><p>Open house is [DAY/TIME] if applicable.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>"
  },
  {
    name: "Offer Presentation Reminder",
    subject: "Offer Presentation Tonight: %property_address%",
    body: `<p>Hi [AGENT NAME],</p><p>Thank you for showing [ADDRESS] to your clients. Please see the details below for tonight's offer presentation.</p><p><strong>Offer Presentation</strong></p><ul><li>[DAY, DATE] at [TIME]</li><li>Register your offer through Broker Bay with Form 801 by [REGISTRATION DEADLINE]</li><li>Email offer to %agent_email%</li><li>No commission reductions please. If you are planning a buyer rebate please arrange that separately with your client and brokerage.</li><li>Please come in with your best offer up front. Our goal is to keep this quick, simple, and fair. If offers are close the sellers may ask for improvements but this is not guaranteed.</li></ul><p><strong>Possession Date</strong></p><p>[POSSESSION DATE] is ideal</p><p><strong>Required Attachments</strong></p><ul><li>Schedule B and C (attached to the listing)</li><li>Permission to Advertise</li></ul><p><strong>Notes</strong></p><ul><li>There are currently [#] offers registered on the property</li><li>Pre-list home inspection available upon request</li><li>Minimum 5% deposit by bank draft payable to "[BROKERAGE NAME]" or wire transfer to trust account</li></ul><p><strong>Inclusions</strong></p><p>[LIST INCLUSIONS]</p><p><strong>Exclusions</strong></p><p>[LIST EXCLUSIONS]</p><p><strong>Rentals</strong></p><p>[LIST RENTALS OR 'None']</p><p>If you are not bringing an offer, any feedback is always appreciated.</p><p>%agent_first_name% %agent_last_name% | %agent_phone% | %agent_email%</p>`
  },
  {
    name: "Google Review Request",
    subject: "How Was Working With Me?",
    body: "<p>Hi %contact_rels_first_name%,</p><p>Now that things have settled I just wanted to say it was genuinely great working with you.</p><p>If you had a good experience and have a couple of minutes, a Google review would mean a lot to me. It is one of the best ways to help me grow and keep doing what I love.</p><p>[GOOGLE REVIEW LINK]</p><p>No pressure at all. And please do not hesitate to reach out any time.</p><p>Talk soon,<br>%agent_first_name% %agent_last_name%<br>%agent_phone%<br>%agent_email%</p>"
  }
];

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
  const results = [];

  const existingTemplates = await (async () => {
    const encoded = Buffer.from(targetKey + ':').toString('base64');
    const res2 = await fetch('https://api.followupboss.com/v1/templates?limit=100', {
      headers: { 'Authorization': `Basic ${encoded}` }
    });
    const d = await res2.json();
    return new Set((d.templates || []).map(t => t.name.toLowerCase()));
  })();

  for (const template of TEMPLATES) {
    if (dryRun) {
      results.push({ name: template.name, status: 'would_create' });
      continue;
    }
    if (existingTemplates.has(template.name.toLowerCase())) {
      results.push({ name: template.name, status: 'skipped (already exists)' });
      continue;
    }
    const r = await fubPost('/templates', template, targetKey);
    results.push({
      name: template.name,
      status: (r.status === 200 || r.status === 201) ? 'created' : 'failed',
      id: r.body.id || null,
      error: (r.status !== 200 && r.status !== 201) ? JSON.stringify(r.body) : null
    });
    await new Promise(r => setTimeout(r, 150));
  }

  return res.status(200).json({
    success: true, dryRun,
    total: TEMPLATES.length,
    created: results.filter(r => r.status === 'created').length,
    skipped: results.filter(r => r.status?.includes('skipped')).length,
    failed: results.filter(r => r.status === 'failed').length,
    results
  });
};
