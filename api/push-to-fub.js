const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { fubApiKey, contact } = req.body;
  if (!fubApiKey || !contact) return res.status(400).json({ error: 'Missing data' });

  try {
    const nameParts = (contact.full_name || '').split(' ');
    const payload = {
      firstName: nameParts[0] || '',
      lastName: nameParts.slice(1).join(' ') || '',
      tags: contact.approved_tags || [],
      ...(contact.notes && { description: contact.notes }),
      ...(contact.email && { emails: [{ value: contact.email }] }),
      ...(contact.linkedin_url && { websites: [{ url: contact.linkedin_url, type: 'linkedin' }] })
    };

    const fubRes = await fetch('https://api.followupboss.com/v1/people', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(fubApiKey + ':').toString('base64')}`
      },
      body: JSON.stringify(payload)
    });

    const data = await fubRes.json();
    if (!fubRes.ok) throw new Error(data.message || `FUB error ${fubRes.status}`);
    res.status(200).json({ success: true, fubId: data.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
