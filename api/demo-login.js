const { Redis } = require('@upstash/redis');
const crypto = require('crypto');

const DEMO_AGENT_ID = 'agent_demo';

const SAMPLE_CONTACTS = [
  { full_name: 'Sarah Mitchell', email: 'sarah.mitchell@gmail.com', phone: '416-555-0142', job_title: 'Marketing Director', company: 'Shopify', birthday: '1988-03-15', city: 'Toronto', suggested_tags: ['Buyer','Pre-Approved','Age: 30s','Profession: Tech','Timeline: 3-6 Months'], notes: 'First time buyer. Pre-approved at $850K. Looking in Leslieville and Riverside.' },
  { full_name: 'James Okonkwo', email: 'jokonkwo@rbc.com', phone: '416-555-0287', job_title: 'Senior Analyst', company: 'RBC Capital Markets', birthday: '1983-07-22', city: 'Toronto', suggested_tags: ['Seller','Likely Buyer','Age: 40s','Profession: Finance','Homeowner','Upsizer'], notes: 'Selling 3-bed semi in Bloor West. Looking to upsize to freehold. Budget $1.4M+.' },
  { full_name: 'Michael Chen', email: 'mchen@osler.com', phone: '647-555-0318', job_title: 'Associate', company: 'Osler LLP', birthday: '1991-11-08', city: 'Toronto', suggested_tags: ['Past Client','Age: 30s','Profession: Legal','Condo Owner'], notes: 'Bought 2-bed condo in King West 2021. Potential upsizer in 2-3 years.' },
  { full_name: 'Emma Beausoleil', email: 'emma.b@gmail.com', phone: '416-555-0451', job_title: 'Physiotherapist', company: 'Runnymede Healthcare', birthday: '1985-05-30', city: 'Toronto', suggested_tags: ['Likely Buyer','First Time Buyer','Age: 40s','Profession: Health','Nurture'], notes: 'Long-time renter in Roncesvalles. Ready to buy. Budget ~$700K.' },
  { full_name: 'David Rosenberg', email: 'd.rosenberg@gmail.com', phone: '416-555-0563', job_title: 'Business Owner', company: 'Rosenberg & Associates', birthday: '1965-09-12', city: 'Toronto', suggested_tags: ['Sphere','Downsizer','Age: 60+','Profession: Business Owner','Has Referred'], notes: 'Referred 2 clients last year. Thinking about downsizing from Forest Hill in 2-3 years.' },
  { full_name: 'Natasha Kowalski', email: 'n.kowalski@td.com', phone: '647-555-0674', job_title: 'Branch Manager', company: 'TD Bank', birthday: '1990-01-25', city: 'Toronto', suggested_tags: ['Past Client','Age: 30s','Profession: Finance','Investment Owner'], notes: 'Sold Liberty Village condo 2023. Owns investment property in Hamilton.' },
  { full_name: 'Tyler Marchetti', email: 'tyler.m@gmail.com', phone: '416-555-0789', job_title: 'Product Manager', company: 'Wealthsimple', birthday: '1994-06-18', city: 'Toronto', suggested_tags: ['Buyer','First Time Buyer','Age: 30s','Profession: Tech','Pre-Approved','Timeline: Now'], notes: 'Pre-approved $650K. Very motivated. Looking in Parkdale and Junction. Wants to move in 60 days.' },
  { full_name: 'Linda Petrov', email: 'lpetrov@hotmail.com', phone: '416-555-0812', job_title: 'Retired', company: '', birthday: '1952-04-03', city: 'Toronto', suggested_tags: ['Past Client','Downsizer','Age: 60+','Empty Nesters','High Equity Owner'], notes: 'Past client — sold North York home 2019. Settled in Etobicoke condo. Check in every 6 months.' },
  { full_name: 'Kevin Park', email: 'kpark@shopify.com', phone: '647-555-0923', job_title: 'Software Engineer', company: 'Shopify', birthday: '1996-02-14', city: 'Toronto', suggested_tags: ['Buyer','First Time Buyer','Age: 30s','Profession: Tech','Timeline: 6-12 Months'], notes: 'New to Toronto from Vancouver. Renting in the Annex. Starting to explore buying.' },
  { full_name: 'Alicia Torres', email: 'a.torres@sunlife.com', phone: '416-555-1034', job_title: 'Financial Advisor', company: 'Sun Life', birthday: '1979-08-22', city: 'Toronto', suggested_tags: ['Seller','Age: 40s','Profession: Finance','Homeowner','Would Buy For Right Price'], notes: 'Inherited a property in Scarborough. Considering selling. Needs market analysis.' },
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

    // Seed demo agent
    await redis.set(`agent:id:${DEMO_AGENT_ID}`, JSON.stringify({
      agentId: DEMO_AGENT_ID, name: 'Demo Agent', email: 'demo@trellis.ai',
      role: 'agent', hasFubKey: false,
    }));

    // Clear and reseed contacts
    const existing = await redis.lrange(`agent:${DEMO_AGENT_ID}:contacts`, 0, -1);
    for (const id of existing) await redis.del(id);
    await redis.del(`agent:${DEMO_AGENT_ID}:contacts`);

    for (const contact of SAMPLE_CONTACTS) {
      const id = `contact:${DEMO_AGENT_ID}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      await redis.set(id, JSON.stringify({ ...contact, contactId: id, agentId: DEMO_AGENT_ID, enriched: true, savedAt: new Date().toISOString() }));
      await redis.lpush(`agent:${DEMO_AGENT_ID}:contacts`, id);
    }

    // Seed sample trades
    const SAMPLE_TRADES = [
      { property_address: '54 Elm Grove Ave, Toronto ON', buyer_or_tenant_name: 'Michael Chen', seller_or_landlord_name: 'Previous Owner', agent_side: 'buyer', deal_type: 'purchase', close_date: '2021-09-15', sale_price: '785000', source: 'demo' },
      { property_address: '219 Fort York Blvd Unit 1209, Toronto ON', buyer_or_tenant_name: 'New Buyer', seller_or_landlord_name: 'Natasha Kowalski', agent_side: 'seller', deal_type: 'purchase', close_date: '2023-04-28', sale_price: '649000', source: 'demo' },
      { property_address: '38 Joe Shuster Way Unit 2010, Toronto ON', buyer_or_tenant_name: 'Tyler Marchetti', seller_or_landlord_name: 'Previous Owner', agent_side: 'buyer', deal_type: 'purchase', close_date: '2022-07-10', sale_price: '598000', source: 'demo' },
      { property_address: '115 Blue Jays Way Unit 4108, Toronto ON', buyer_or_tenant_name: 'Linda Petrov', seller_or_landlord_name: 'Previous Owner', agent_side: 'buyer', deal_type: 'purchase', close_date: '2019-11-30', sale_price: '712000', source: 'demo' },
      { property_address: '66 Sorauren Ave, Toronto ON', buyer_or_tenant_name: 'New Buyer', seller_or_landlord_name: 'James Okonkwo', agent_side: 'seller', deal_type: 'purchase', close_date: '2024-02-14', sale_price: '1285000', source: 'demo' },
    ];

    const existingTrades = await redis.lrange(`agent:${DEMO_AGENT_ID}:trades`, 0, -1);
    for (const id of existingTrades) await redis.del(id);
    await redis.del(`agent:${DEMO_AGENT_ID}:trades`);

    for (const trade of SAMPLE_TRADES) {
      const tid = `trade:${DEMO_AGENT_ID}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      await redis.set(tid, JSON.stringify({ ...trade, agentId: DEMO_AGENT_ID, savedAt: new Date().toISOString() }));
      await redis.lpush(`agent:${DEMO_AGENT_ID}:trades`, tid);
    }

    // Create demo session (1 hour)
    const sessionToken = crypto.randomBytes(32).toString('hex');
    await redis.set(`session:${sessionToken}`, JSON.stringify({
      agentId: DEMO_AGENT_ID, name: 'Demo Agent',
      email: 'demo@trellis.ai', role: 'agent',
      isDemo: true
    }), { ex: 3600 });

    // Return token as JSON — frontend handles the redirect
    return res.status(200).json({ token: sessionToken, agentId: DEMO_AGENT_ID });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
