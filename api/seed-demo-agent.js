const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

const DEMO_AGENT_ID = 'agent_demo';

const SAMPLE_CONTACTS = [
  { full_name: 'Sarah Mitchell', email: 'sarah.mitchell@gmail.com', phone: '416-555-0142', job_title: 'Marketing Director', company: 'Shopify', birthday: '1988-03-15', city: 'Toronto', suggested_tags: ['Buyer', 'Pre-Approved', 'Age: 30s', 'Profession: Tech', 'Timeline: 3-6 Months'], notes: 'First time buyer. Pre-approved at $850K. Looking in Leslieville and Riverside.' },
  { full_name: 'James & Priya Okonkwo', email: 'jokonkwo@rbc.com', phone: '416-555-0287', job_title: 'Senior Analyst', company: 'RBC Capital Markets', birthday: '1983-07-22', city: 'Toronto', suggested_tags: ['Seller', 'Likely Buyer', 'Age: 40s', 'Profession: Finance', 'Homeowner', 'Upsizer'], notes: 'Selling 3-bed semi in Bloor West. Looking to upsize to freehold with backyard. Budget $1.4M+.' },
  { full_name: 'Michael Chen', email: 'mchen@osler.com', phone: '647-555-0318', job_title: 'Associate', company: 'Osler LLP', birthday: '1991-11-08', city: 'Toronto', suggested_tags: ['Past Client', 'Buyer', 'Age: 30s', 'Profession: Legal', 'Condo Owner', 'High Equity Owner'], notes: 'Bought 2-bed condo in King West 2021. Checking in annually. Potential upsizer in 2-3 years.' },
  { full_name: 'Emma Beausoleil', email: 'emma.b@gmail.com', phone: '416-555-0451', job_title: 'Physiotherapist', company: 'Runnymede Healthcare', birthday: '1985-05-30', city: 'Toronto', suggested_tags: ['Likely Buyer', 'First Time Buyer', 'Age: 40s', 'Profession: Health', 'Nurture', 'Timeline: 6-12 Months'], notes: 'Long-time renter in Roncesvalles. Finally ready to buy. Budget ~$700K for a condo.' },
  { full_name: 'David & Karen Rosenberg', email: 'd.rosenberg@gmail.com', phone: '416-555-0563', job_title: 'Business Owner', company: 'Rosenberg & Associates', birthday: '1965-09-12', city: 'Toronto', suggested_tags: ['Sphere', 'Downsizer', 'Age: 60+', 'Profession: Business Owner', 'Homeowner', 'Has Referred'], notes: 'Referred 2 clients last year. Kids are grown. Thinking about downsizing from Forest Hill home in 2-3 years.' },
  { full_name: 'Natasha Kowalski', email: 'n.kowalski@td.com', phone: '647-555-0674', job_title: 'Branch Manager', company: 'TD Bank', birthday: '1990-01-25', city: 'Toronto', suggested_tags: ['Past Client', 'Seller', 'Age: 30s', 'Profession: Finance', 'Condo Owner', 'Investment Owner'], notes: 'Sold Liberty Village condo 2023. Now owns investment property in Hamilton. Stays in touch regularly.' },
  { full_name: 'Tyler Marchetti', email: 'tyler.m@gmail.com', phone: '416-555-0789', job_title: 'Product Manager', company: 'Wealthsimple', birthday: '1994-06-18', city: 'Toronto', suggested_tags: ['Buyer', 'First Time Buyer', 'Age: 30s', 'Profession: Tech', 'Pre-Approved', 'Timeline: Now'], notes: 'Pre-approved at $650K. Very motivated. Looking in Parkdale and Junction. Wants to move within 60 days.' },
  { full_name: 'Linda & Frank Petrov', email: 'lpetrov@hotmail.com', phone: '416-555-0812', job_title: 'Retired', company: '', birthday: '1952-04-03', city: 'Toronto', suggested_tags: ['Past Client', 'Downsizer', 'Age: 60+', 'Empty Nesters', 'Homeowner', 'High Equity Owner'], notes: 'Past clients — sold North York home 2019. Settled in Etobicoke condo. Check in every 6 months.' },
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session || session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

    // Create demo agent record
    const demoAgent = {
      agentId: DEMO_AGENT_ID,
      name: 'Demo Agent',
      email: 'demo@trellis.ai',
      role: 'agent',
      hasFubKey: false,
      createdAt: new Date().toISOString()
    };
    await redis.set(`agent:id:${DEMO_AGENT_ID}`, JSON.stringify(demoAgent));

    // Clear existing demo contacts
    const existing = await redis.lrange(`agent:${DEMO_AGENT_ID}:contacts`, 0, -1);
    for (const id of existing) await redis.del(id);
    await redis.del(`agent:${DEMO_AGENT_ID}:contacts`);

    // Seed sample contacts
    for (const contact of SAMPLE_CONTACTS) {
      const contactId = `contact:${DEMO_AGENT_ID}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const record = {
        ...contact,
        contactId,
        agentId: DEMO_AGENT_ID,
        savedAt: new Date().toISOString(),
        enriched: true,
        fub_data: { fub_id: null },
      };
      await redis.set(contactId, JSON.stringify(record));
      await redis.lpush(`agent:${DEMO_AGENT_ID}:contacts`, contactId);
    }

    return res.status(200).json({
      success: true,
      agentId: DEMO_AGENT_ID,
      contactsSeeded: SAMPLE_CONTACTS.length,
      message: 'Demo agent ready'
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
