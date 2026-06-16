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

// ── Apply closing date custom field + birthday/closing/lease tasks ──
async function applyDatesAndTasks(personId, contact, headers) {
  try {
    const updates = {};

    // Birthday tasks — day of, next 10 years
    if (contact.birthday) {
      const d = new Date(contact.birthday);
      if (!isNaN(d.getTime())) {
        const now = new Date();
        let startYear = now.getFullYear();
        if (new Date(startYear, d.getMonth(), d.getDate()) < now) startYear++;
        for (let y = startYear; y < startYear + 10; y++) {
          const due = new Date(y, d.getMonth(), d.getDate()).toISOString().split('T')[0];
          await createFubTask(personId, `🎂 Birthday — call/text to wish happy birthday`, due, headers);
        }
      }
    }

    // Trade-based: closing anniversary + lease end reminder
    // The anniversary should celebrate the home they currently OWN — i.e. the most
    // recent PURCHASE — not a property they sold or a lease. Pick the right deal:
    const trades = contact.trade_history || [];
    function pickAnniversaryDeal(list) {
      const withDate = list.filter(t => t.close_date);
      if (!withDate.length) return null;
      const byDateDesc = (a, b) => new Date(b.close_date) - new Date(a.close_date);
      // 1. Most recent purchase (buyer side, not lease)
      const purchases = withDate.filter(t => t.side === 'buyer' && !(t.deal_type||'').includes('lease'));
      if (purchases.length) return purchases.sort(byDateDesc)[0];
      // 2. No purchase — fall back to most recent lease as tenant (lease-end reminder)
      const tenantLeases = withDate.filter(t => t.side === 'tenant');
      if (tenantLeases.length) return tenantLeases.sort(byDateDesc)[0];
      // 3. Otherwise the most recent deal of any kind
      return withDate.sort(byDateDesc)[0];
    }
    const latest = pickAnniversaryDeal(trades);
    if (latest && latest.close_date) {
      // Closing date custom field (FUB customClosingAnniversary)
      updates.customClosingAnniversary = latest.close_date;

      if ((latest.deal_type || '').includes('lease')) {
        // Lease: reminder 90 days before lease ends (assume 1-year lease from close date)
        const start = new Date(latest.close_date);
        if (!isNaN(start.getTime())) {
          const leaseEnd = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate());
          const reminder = new Date(leaseEnd); reminder.setDate(reminder.getDate() - 90);
          if (reminder > new Date()) {
            await createFubTask(personId, `🔑 Lease ending soon (~${leaseEnd.toISOString().split('T')[0]}) — reach out about renewal or next move`, reminder.toISOString().split('T')[0], headers);
          }
        }
      } else {
        // Sale: closing anniversary tasks — day of, next 10 years
        const cd = new Date(latest.close_date);
        if (!isNaN(cd.getTime())) {
          const now = new Date();
          let startYear = now.getFullYear();
          if (new Date(startYear, cd.getMonth(), cd.getDate()) < now) startYear++;
          for (let y = startYear; y < startYear + 10; y++) {
            const due = new Date(y, cd.getMonth(), cd.getDate()).toISOString().split('T')[0];
            const yrsIn = y - cd.getFullYear();
            await createFubTask(personId, `🏠 Closing anniversary (${yrsIn} yr) — check in`, due, headers);
          }
        }
      }
    }

    if (Object.keys(updates).length) {
      await fetch(`https://api.followupboss.com/v1/people/${personId}`, {
        method: 'PUT', headers, body: JSON.stringify(updates)
      });
    }
  } catch(e) { console.warn('applyDatesAndTasks failed (non-fatal):', e.message); }
}

// ── Create a FUB task for a contact ──
async function createFubTask(personId, name, dueDate, headers) {
  if (!personId || !dueDate) return null;
  try {
    const r = await fetch('https://api.followupboss.com/v1/tasks', {
      method: 'POST', headers,
      body: JSON.stringify({ personId, name, dueDate, type: 'Follow Up' })
    });
    return r.ok;
  } catch(e) { return null; }
}

// Next occurrence of a MM-DD anniversary from a YYYY-MM-DD date
function nextAnniversary(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let next = new Date(now.getFullYear(), d.getMonth(), d.getDate());
  if (next < now) next = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate());
  return next.toISOString().split('T')[0];
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

    // Build structured background block — job/company always first, clean format
    const structuredLines = [];
    if (contact.job_title && contact.company) {
      structuredLines.push(`${contact.job_title} at ${contact.company}`);
    } else if (contact.job_title && contact.job_title !== 'unknown') {
      structuredLines.push(contact.job_title);
    } else if (contact.company && contact.company !== 'unknown') {
      structuredLines.push(contact.company);
    }
    if (contact.birthday) structuredLines.push(`Birthday: ${contact.birthday}`);
    if (contact.spouse_name) structuredLines.push(`Spouse: ${contact.spouse_name}`);
    const structuredBlock = structuredLines.join('\n');

    // Notes go below the structured block, separated clearly
    const notesBlock = (contact.notes && contact.notes !== 'unknown') ? contact.notes : null;
    const newDescription = [structuredBlock, notesBlock].filter(Boolean).join('\n\n') || null;

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
      if (structuredBlock) {
        // Always update the structured block (job/company/birthday) at top
        // Keep any existing custom notes Lorry wrote below
        // Strip old Trellis structured blocks first
        const stripped = existingDesc
          .replace(/--- Trellis ---[\s\S]*?(?=\n\n|$)/g, '')
          .replace(/^(Occupation:|Works at |Birthday:|Spouse:)[^\n]*\n?/gm, '')
          .trim();
        const newBg = [structuredBlock, stripped].filter(Boolean).join('\n\n');
        if (newBg !== existingDesc) payload.background = newBg;
      } else if (notesBlock && !existingDesc.includes(notesBlock)) {
        payload.background = existingDesc ? `${existingDesc}\n\n${notesBlock}` : notesBlock;
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
      if (structuredBlock || notesBlock) payload.background = newDescription;
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

      await applyDatesAndTasks(contactId, contact, headers);
      return res.status(200).json({ success: true, fubId: contactId, action: 'created', tags_applied: approvedTags.length });
    }

    // ── Post-push: closing anniversary, birthday + closing + lease tasks ──
    await applyDatesAndTasks(existingId, contact, headers);

    const tagsApplied = payload.tags ? payload.tags.length : 0;
    return res.status(200).json({ success: true, fubId: existingId, action, tags_applied: tagsApplied });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
