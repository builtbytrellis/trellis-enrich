const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');
const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = await verifySession(req, res);
  if (!session || session.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const { agentId, fubApiKey } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

    // Contact stats from Redis
    const contactIds = await redis.lrange(`agent:${agentId}:contacts`, 0, -1);
    const tradeIds   = await redis.lrange(`agent:${agentId}:trades`, 0, -1);

    // Count enriched vs not
    let enriched = 0, pushed = 0, fintrac = 0;
    if (contactIds.length) {
      const sample = contactIds.slice(0, 200);
      const raws = await Promise.all(sample.map(id => redis.get(id)));
      for (const raw of raws) {
        if (!raw) continue;
        const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (c.job_title || c.company || c.birthday) enriched++;
        if (c.fub_data?.fub_id) pushed++;
        if (c.fintrac_verified) fintrac++;
      }
    }

    // FUB stats
    let actionPlanCount = 0, templateCount = 0;
    if (fubApiKey) {
      const encoded = Buffer.from(fubApiKey + ':').toString('base64');
      const headers = { 'Authorization': `Basic ${encoded}` };
      try {
        const [plansRes, templatesRes] = await Promise.all([
          fetch('https://api.followupboss.com/v1/actionPlans?limit=100', { headers }),
          fetch('https://api.followupboss.com/v1/templates?limit=100', { headers })
        ]);
        const plans = await plansRes.json();
        const templates = await templatesRes.json();
        actionPlanCount = (plans.actionPlans || []).filter(p => p.createdById > 0).length;
        templateCount = (templates.templates || []).length;
      } catch(e) {}
    }

    return res.status(200).json({
      contacts:     contactIds.length,
      enriched,
      pushed,
      fintrac,
      trades:       tradeIds.length,
      actionPlans:  actionPlanCount,
      templates:    templateCount,
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
