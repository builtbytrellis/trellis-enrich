const fetch = require('node-fetch');

async function ensureTagExists(tagName, headers) {
  try {
    await fetch('https://api.followupboss.com/v1/tags', {
      method: 'POST', headers, body: JSON.stringify({ name: tagName })
    });
  } catch(e) {}
}

// Map occupation to FUB profession tag
function getProfessionTag(jobTitle, company) {
  const title = (jobTitle || '').toLowerCase();
  const text = `${title} ${(company || '').toLowerCase()}`;

  // Standard mapped categories
  if (/doctor|physician|surgeon|dentist|pharmacist|nurse|medical|psychologist|therapist|speech|pathologist|healthcare|clinical|optometrist|chiropractor|physiotherapist/.test(text)) return 'Profession: Healthcare';
  if (/lawyer|attorney|legal|law |barrister|solicitor|paralegal|notary/.test(text)) return 'Profession: Legal';
  if (/finance|financial|accountant|accounting|banker|investment|investor|analyst|cfo|controller|aml|mortgage|insurance|credit|auditor|actuary|wealth/.test(text)) return 'Profession: Finance';
  if (/engineer|developer|software|tech|it |network|data |cyber|product manager|ux|ui|cto|programmer|devops|architect|qa |tester/.test(text)) return 'Profession: Tech';
  if (/teacher|professor|educator|principal|school|education|tutor|academic|lecturer|instructor/.test(text)) return 'Profession: Education';
  if (/contractor|electrician|plumber|carpenter|\btrades\b|construction|hvac|mechanical|millwright|welder|mason/.test(text)) return 'Profession: Trades';
  if (/real estate agent|realtor|\bbroker\b|property manager/.test(text)) return 'Profession: Real Estate Agent';
  if (/mortgage broker|mortgage agent|mortgage specialist/.test(text)) return 'Profession: Mortgage Broker';
  if (/marketing|brand|communications|advertising|\bpr\b|public relations|content|social media|copywriter|media buyer|growth/.test(text)) return 'Profession: Marketing';
  if (/owner|entrepreneur|founder|\bceo\b|president|self.employ|self employ/.test(text)) return 'Profession: Business Owner';
  if (/director|vice president|\bvp\b|managing|executive|\bc[a-z]o\b/.test(text)) return 'Profession: Business Owner';
  if (/sales|account executive|account manager|business development|bdr|sdr/.test(text)) return 'Profession: Business Owner';
  if (/designer|architect|interior|creative|art director|illustrator|photographer|videographer/.test(text)) return 'Profession: Business Owner';
  if (/chef|restauran|hospitality|hotel|property/.test(text)) return 'Profession: Business Owner';

  // Custom fallback — if job title exists but doesn't match, create a custom profession tag
  if (jobTitle && jobTitle.trim()) {
    // Capitalize each word for the tag
    const formatted = jobTitle.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    return `Profession: ${formatted}`;
  }

  return null;
}

// Fetch existing FUB contact and return their current field values
async function getFubContact(fubId, headers) {
  try {
    const r = await fetch(`https://api.followupboss.com/v1/people/${fubId}`, { method: 'GET', headers });
    if (!r.ok) return null;
    return await r.json();
  } catch(e) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { fubApiKey, contact, updateOnly } = req.body;
  if (!fubApiKey || !contact) return res.status(400).json({ error: 'Missing data' });

  const encoded = Buffer.from(fubApiKey + ':').toString('base64');
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Basic ${encoded}` };

  try {
    const approvedTags = contact.approved_tags || [];

    // Auto-add profession tag from occupation
    const professionTag = getProfessionTag(contact.job_title, contact.company);
    if (professionTag && !approvedTags.includes(professionTag)) {
      approvedTags.push(professionTag);
    }

    for (const tag of approvedTags) {
      await ensureTagExists(tag, headers);
    }

    const nameParts = (contact.full_name || '').trim().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Build background text
    const backgroundParts = [];
    if (contact.job_title && contact.company) backgroundParts.push(`Works at ${contact.company} as ${contact.job_title}`);
    else if (contact.job_title) backgroundParts.push(`Occupation: ${contact.job_title}`);
    else if (contact.company) backgroundParts.push(`Company: ${contact.company}`);
    if (contact.notes) backgroundParts.push(contact.notes);
    const newDescription = backgroundParts.join('\n') || null;

    let existingId = contact.fub_data?.fub_id;
    let payload = {};
    let action = 'created';

    // If no fub_id stored, search FUB by name first to avoid duplicates
    if (!existingId && contact.full_name) {
      try {
        const searchRes = await fetch(
          `https://api.followupboss.com/v1/people?q=${encodeURIComponent(contact.full_name)}&limit=1`,
          { method: 'GET', headers }
        );
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const match = searchData.people?.[0];
          if (match) existingId = match.id;
        }
      } catch(e) { console.warn('FUB name search failed:', e.message); }
    }

    if (existingId) {
      // ── SMART UPDATE: fetch existing contact, only patch missing/changed fields ──
      action = 'updated';
      const existing = await getFubContact(existingId, headers);

      // Email — add if FUB has none
      const existingEmails = existing?.emails?.map(e => e.value?.toLowerCase()) || [];
      if (contact.email && !existingEmails.includes(contact.email.toLowerCase())) {
        payload.emails = [...(existing?.emails || []), { value: contact.email, type: 'home' }];
      }

      // Phone — add if FUB has none
      const existingPhones = existing?.phones?.map(p => p.value?.replace(/\D/g, '')) || [];
      const newPhone = (contact.phone || '').replace(/\D/g, '');
      if (newPhone && !existingPhones.includes(newPhone)) {
        payload.phones = [...(existing?.phones || []), { value: contact.phone, type: 'mobile' }];
      }

      // Stage — only set if FUB stage is empty/Lead and we have something better
      if (contact.stage && (!existing?.stage || existing.stage === 'Lead')) {
        payload.stage = contact.stage;
      }

      // Background/description — append new info if not already present
      const existingDesc = existing?.background || '';
      if (newDescription && !existingDesc.includes(newDescription.split('\n')[0])) {
        // Append BELOW existing notes — never overwrite Lorry's custom notes
        payload.background = existingDesc
          ? `${existingDesc}\n\n--- Trellis ---\n${newDescription}`
          : newDescription;
      }

      // Tags — merge, don't overwrite. Add only tags not already on contact.
      const existingTags = (existing?.tags || []).map(t => typeof t === 'string' ? t : (t.name || t.label || ''));
      const newTags = approvedTags.filter(t => !existingTags.includes(t));
      if (newTags.length) {
        payload.tags = [...existingTags, ...newTags];
      }

      // Birthday — write to FUB custom field customBirthday
      const existingBirthday = existing?.customBirthday || '';
      if (contact.birthday && !existingBirthday) {
        payload.customBirthday = contact.birthday;
      }
      if (contact.spouse_name && !(existing?.background || '').includes(contact.spouse_name)) {
        payload.background = (payload.background || existing?.background || '') + '\nSpouse: ' + contact.spouse_name;
      }

      // If nothing changed, skip the PUT
      if (!Object.keys(payload).length) {
        return res.status(200).json({ success: true, fubId: existingId, action: 'no_changes', tags_applied: 0 });
      }

      console.log('[push-to-fub] payload for', existingId, ':', JSON.stringify(payload));
      const updateRes = await fetch(`https://api.followupboss.com/v1/people/${existingId}`, {
        method: 'PUT', headers, body: JSON.stringify(payload)
      });
      const updateText = await updateRes.text();
      console.log('[push-to-fub] FUB response:', updateRes.status, updateText.slice(0,200));
      if (!updateRes.ok) return res.status(400).json({ error: `FUB update error ${updateRes.status}: ${updateText}` });

    } else if (updateOnly) {
      return res.status(200).json({ success: true, action: 'skipped_no_fub_id', tags_applied: 0 });
    } else {
      // ── NEW CONTACT: build full payload ──
      if (contact.email) payload.emails = [{ value: contact.email, type: 'home' }];
      if (contact.phone) payload.phones = [{ value: contact.phone, type: 'mobile' }];
      if (contact.stage) payload.stage = contact.stage;
      if (newDescription) payload.background = newDescription;
      if (approvedTags.length) payload.tags = approvedTags;

      if (contact.birthday) payload.customBirthday = contact.birthday;
      if (contact.spouse_name) payload.background = (payload.background ? payload.background + '\n' : '') + 'Spouse: ' + contact.spouse_name;

      payload.firstName = firstName;
      payload.lastName = lastName;

      const createRes = await fetch('https://api.followupboss.com/v1/people', {
        method: 'POST', headers, body: JSON.stringify(payload)
      });
      const createText = await createRes.text();
      if (!createRes.ok) return res.status(400).json({ error: `FUB create error ${createRes.status}: ${createText}` });
      const created = JSON.parse(createText);
      const contactId = created.id;

      // Enrichment note for new contacts
      const noteParts = [];
      if (contact.interests?.length) noteParts.push(`Interests: ${contact.interests.join(', ')}`);
      if (contact.likely_age_range && contact.likely_age_range !== 'unknown') noteParts.push(`Est. age range: ${contact.likely_age_range}`);
      if (approvedTags.length) noteParts.push(`Trellis tags applied: ${approvedTags.join(', ')}`);
      noteParts.push(`Enriched by Trellis on ${new Date().toLocaleDateString('en-CA')}`);

      if (contactId) {
        try {
          await fetch('https://api.followupboss.com/v1/notes', {
            method: 'POST', headers,
            body: JSON.stringify({ personId: contactId, body: noteParts.join('\n'), isHtml: false })
          });
        } catch(e) {}
      }

      return res.status(200).json({ success: true, fubId: contactId, action: 'created', tags_applied: approvedTags.length });
    }

    const tagsApplied = payload.tags ? (payload.tags.length - (existing?.tags||[]).length) : 0;
    return res.status(200).json({ success: true, fubId: existingId, action, tags_applied: tagsApplied });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
