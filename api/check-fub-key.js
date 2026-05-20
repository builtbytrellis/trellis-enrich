const fetch = require('node-fetch');
const { verifySession } = require('./auth');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await verifySession(req, res);
  if (!session) return;

  const { fubApiKey } = req.body;
  if (!fubApiKey) return res.status(400).json({ error: 'fubApiKey required' });

  try {
    const encoded = Buffer.from(fubApiKey + ':').toString('base64');
    const r = await fetch('https://api.followupboss.com/v1/identity', {
      headers: { 'Authorization': `Basic ${encoded}` }
    });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 400) }; }

    if (!r.ok) {
      return res.status(200).json({ valid: false, status: r.status, error: body.errorMessage || body.error || 'FUB rejected the key' });
    }

    return res.status(200).json({
      valid: true,
      account: body.account?.name || null,
      account_id: body.account?.id || null,
      user_name: body.name || null,
      user_email: body.email || null,
      user_id: body.id || null,
      role: body.role || null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
