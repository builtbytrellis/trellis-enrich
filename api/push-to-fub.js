const fetch = require('node-fetch');

async function ensureTagExists(tagName, headers) {
  try {
    const res = await fetch('https://api.followupboss.com/v1/tags', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: tagName })
    });
    // 200 = created, 422 = already exists — both are fine
    return true;
  } catch(e) {
    return false;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { fubApiKey, contact } = req.body;
  if (!fubApiKey || !contact) return res.status(400).json({ error: 'Missing data' });

  const encoded = Buffer.from(fubApiKey + ':').toString('base64');
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${encoded}`
  };

  try {
    const approvedTags = contact.approved_tags || [];

    // Auto-create any tags that don't exist in FUB yet
    for (const tag of approvedTags) {
      await ensureTagExists(tag, headers);
    }

    // If contact exists in FUB — update it
    if (contact.fub_data && contact.fub_data.fub_id) {
      const payload = {};
      if (approvedTags.length > 0) payload.tags = approvedTags;
      if (contact.notes) payload.description = contact.notes;
      if (contact.job_title) payload.jobTitle = contact.job_title;

      const updateRes = await fetch(`https://api.followupboss.com/v1/people/${contact.fub_data.fub_id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload)
      });

      const updateText = await updateRes.text();
      if (!updateRes.ok) return res.status(400).json({ error: `FUB update error ${updateRes.status}: ${updateText}` });
      return res.status(200).json({ success: true, fubId: contact.fub_data.fub_id, action: 'updated', tags_applied: approvedTags.length });
    }

    // New contact — create it
    const nameParts = (contact.full_name || '').trim().split(' ');
    const payload = {
      firstName: nameParts[0] || '',
      lastName: nameParts.slice(1).join(' ') || '',
    };
    if (approvedTags.length > 0) payload.tags = approvedTags;
    if (contact.notes) payload.description = contact.notes;
    if (contact.fub_data?.email) payload.emails = [{ value: contact.fub_data.email }];
    if (contact.fub_data?.phone) payload.phones = [{ value: contact.fub_data.phone }];

    const createRes = await fetch('https://api.followupboss.com/v1/people', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const createText = await createRes.text();
    if (!createRes.ok) return res.status(400).json({ error: `FUB create error ${createRes.status}: ${createText}` });

    const data = JSON.parse(createText);
    res.status(200).json({ success: true, fubId: data.id, action: 'created', tags_applied: approvedTags.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
