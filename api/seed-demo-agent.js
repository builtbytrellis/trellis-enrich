const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');
const { DEMO_AGENT_ID, seedDemoData } = require('./demo-dataset');

// Admin-only: force a full reseed of the Demo Agent account with the
// fictional dataset in demo-dataset.js (contacts, trades, review + queue).
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session || session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const seeded = await seedDemoData(redis);
    return res.status(200).json({ success: true, agentId: DEMO_AGENT_ID, ...seeded, message: 'Demo agent reseeded' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
