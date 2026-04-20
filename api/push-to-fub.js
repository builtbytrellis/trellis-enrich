const fetch = require('node-fetch');

async function ensureTagExists(tagName, headers) {
  try {
    await fetch('https://api.followupboss.com/v1/tags', {
      method: 'POST', headers, body: JSON.stringify({ name: tagName })
    });
    return true;
  } catch(e) { return false; }
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
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Basic ${encoded}` };

  try {
    const approvedTags = contact.approved_tags || [];

    // Auto-create tags in FUB if they don't exist
    for (const tag of approvedTags) {
      await ensureTagExists(tag, headers);
    }

    const nameParts = (contact.full_name || '').trim().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Build the FUB payload with all editable fields
    const payload = {
      firstName,
      lastName,
      ...(contact.email ? { emails: [{ value: contact.email, type: 'home' }] } : {}),
      ...(contact.phone ? { phones: [{ value: contact.phone, type: 'mobile' }] } : {}),
      ...(contact.stage ? { stage: contact.stage } : {}),
      ...(contact.notes ? { description: contact.notes } : {}),
      ...(contact.job_title ? { jobTitle: contact.job_title } : {}),
      ...(contact.company ? { company: contact.company } : {}),
      ...(approvedTags.length ? { tags: approvedTags } : {}),
    };

    // Custom fields (birthday, spouse)
    const customFields = {};
    if (contact.birthday) customFields['Birthday'] = contact.birthday;
    if (contact.spouse_name) customFields['Spouse Name'] = contact.spouse_name;
    if (Object.keys(customFields).length) payload.customFields = customFields;

    let fubResult;
    const existingId = contact.fub_data?.fub_id;

    if (existingId) {
      // Update existing contact
      const updateRes = await fetch(`https://api.followupboss.com/v1/people/${existingId}`, {
        method: 'PUT', headers, body: JSON.stringify(payload)
      });
      const updateText = await updateRes.text();
      if (!updateRes.ok) return res.status(400).json({ error: `FUB update error ${updateRes.status}: ${updateText}` });
      fubResult = { id: existingId, action: 'updated' };
    } else {
      // Create new contact
      const createRes = await fetch('https://api.followupboss.com/v1/people', {
        method: 'POST', headers, body: JSON.stringify(payload)
      });
      const createText = await createRes.text();
      if (!createRes.ok) return res.status(400).json({ error: `FUB create error ${createRes.status}: ${createText}` });
      fubResult = { ...JSON.parse(createText), action: 'created' };
    }

    const contactId = fubResult.id || existingId;

    // Add enrichment note
    const noteParts = [];
    if (contact.interests?.length) noteParts.push(`Interests: ${contact.interests.join(', ')}`);
    if (contact.likely_age_range && contact.likely_age_range !== 'unknown') noteParts.push(`Est. age range: ${contact.likely_age_range}`);
    if (approvedTags.length) noteParts.push(`Trellis tags applied: ${approvedTags.join(', ')}`);
    noteParts.push(`Enriched by Trellis on ${new Date().toLocaleDateString('en-CA')}`);

    if (noteParts.length && contactId) {
      try {
        await fetch('https://api.followupboss.com/v1/notes', {
          method: 'POST', headers,
          body: JSON.stringify({ personId: contactId, body: noteParts.join('\n'), isHtml: false })
        });
      } catch(e) { console.warn('Note creation failed (non-fatal):', e.message); }
    }

    res.status(200).json({ success: true, fubId: contactId, action: fubResult.action, tags_applied: approvedTags.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
