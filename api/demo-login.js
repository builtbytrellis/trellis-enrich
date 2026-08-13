const { Redis } = require('@upstash/redis');
const crypto = require('crypto');
const { DEMO_AGENT_ID, DEMO_SEED_VERSION, seedDemoData } = require('./demo-dataset');

// Guest entry for ?demo=true: seeds the Demo Agent dataset (once per seed
// version — admins can force a reseed via seed-demo-agent) and returns a
// 4-hour session for the fictional demo account.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

    const seededVersion = await redis.get('demo:seed:version');
    if (seededVersion !== DEMO_SEED_VERSION) await seedDemoData(redis);

    const sessionToken = crypto.randomBytes(32).toString('hex');
    await redis.set(`session:${sessionToken}`, JSON.stringify({
      agentId: DEMO_AGENT_ID, name: 'Demo Agent',
      email: 'demo@trellis.ai', role: 'agent',
      isDemo: true
    }), { ex: 14400 });

    return res.status(200).json({ token: sessionToken, agentId: DEMO_AGENT_ID });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
