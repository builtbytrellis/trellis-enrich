const fetch = require('node-fetch');
const { Redis } = require('@upstash/redis');
const { verifySession } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await verifySession(req, res);
  if (!session) return;

  const { dealId, agentId } = req.body;
  if (!dealId) return res.status(400).json({ error: 'dealId required' });

  const targetId = agentId && session.role === 'admin' ? agentId : session.agentId;

  try {
    const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
    const raw = await redis.get(`agent:id:${targetId}`);
    if (!raw) return res.status(404).json({ error: 'agent not found' });
    const agent = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!agent.fubApiKey) return res.status(400).json({ error: 'No FUB API key on file for this agent' });

    const encoded = Buffer.from(agent.fubApiKey + ':').toString('base64');

    // First fetch the deal so we know what we're deleting (for the audit trail).
    const getRes = await fetch(`https://api.followupboss.com/v1/deals/${dealId}`, {
      headers: { 'Authorization': `Basic ${encoded}` }
    });
    let dealSnapshot = null;
    if (getRes.ok) {
      try { dealSnapshot = await getRes.json(); } catch {}
    }

    const delRes = await fetch(`https://api.followupboss.com/v1/deals/${dealId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Basic ${encoded}` }
    });
    const text = await delRes.text();
    let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }

    return res.status(200).json({
      success: delRes.ok,
      status: delRes.status,
      deal: dealSnapshot ? { id: dealSnapshot.id, name: dealSnapshot.name, value: dealSnapshot.price || dealSnapshot.value } : null,
      body,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
