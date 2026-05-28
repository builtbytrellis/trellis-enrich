const OpenAI = require('openai');
const fetch = require('node-fetch');

const FUB_TAGS = ["Relationship: A++","Relationship: A+","Relationship: A","Relationship: B","Relationship: C","Relationship: Past Client","Relationship: Referral Source","Relationship: Super Referrer","Relationship: VIP","Relationship: Sphere","Client: Buyer","Client: Seller","Client: Investor","Client: Landlord","Client: Tenant","Life Stage: Young Professional","Life Stage: Young Family","Life Stage: Growing Family","Life Stage: Established Family","Life Stage: Empty Nester","Life Stage: Investor Profile","Timeline: Now","Timeline: 3-6 Months","Timeline: 6-12 Months","Timeline: 12+ Months","Engagement: Active","Engagement: Nurture","Engagement: Cold","Engagement: Do Not Contact","Comms: Text","Comms: Email","Comms: Call","Source: Open House","Source: Referral","Source: Social","Source: Past Client","Source: Cold","Type: Past Client","Type: Referral Source","Type: Super Referrer","Type: VIP","Type: Sphere","Client: Buyer","Client: Seller","Client: Investor","Client: Landlord","Client: Tenant","Buyer: Inquiry","Buyer: Pre-Approved","Buyer: Active","Buyer: Offer Stage","Buyer: Under Contract","Buyer: Closed","Seller: Thinking","Seller: Preparing","Seller: Interviewing","Seller: Ready","Seller: Listed","Seller: Sold","Opportunity: Upsizer","Opportunity: Downsizer","Opportunity: First-Time Buyer","Opportunity: Relocation","Opportunity: Mortgage Renewal","Opportunity: Likely Seller","Opportunity: Likely Buyer","Owner: Primary Residence","Owner: Investment Property","Owner: Rental Property","Owner: Multiple Properties","Property: Detached","Property: Semi-Detached","Property: Condo","Property: Townhouse","Property: Freehold","Property: Bungalow","Property: 3 Storey","Family: No Kids","Family: Kids Under 5","Family: Kids 5-10","Family: Kids Teens","Family: Expecting","Family: Empty Nester","Owned Since: Pre-2010","Owned Since: 2010-2015","Owned Since: 2016-2020","Owned Since: 2021-2023","Owned Since: 2024+","Signal: High Equity","Signal: Would Sell If Right Price","Signal: Would Sell Exclusive","Signal: Street Turnover","Lifestyle: Golfer","Lifestyle: Cottage Owner","Lifestyle: Foodie","Lifestyle: Loves Travel","Lifestyle: Fitness Focused","Lifestyle: Design Oriented","Profession: Finance","Profession: Healthcare","Profession: Legal","Profession: Tech","Profession: Education","Profession: Trades","Profession: Business Owner","Profession: Real Estate Agent","Profession: Mortgage Broker","Age: 20s","Age: 30s","Age: 40s","Age: 50s","Age: 60+"];

const FUB_TAGS_SET = new Set(FUB_TAGS);

async function searchFUB(name, fubApiKey) {
  if (!fubApiKey) return null;
  try {
    const encoded = Buffer.from(fubApiKey + ':').toString('base64');
    const res = await fetch(`https://api.followupboss.com/v1/people?q=${encodeURIComponent(name)}&limit=1`, {
      headers: { 'Authorization': `Basic ${encoded}` }
    });
    const data = await res.json();
    if (data.people && data.people.length > 0) return data.people[0];
    return null;
  } catch(e) { return null; }
}

async function withRetry(fn, label, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e?.message || String(e);
      const is429 = e?.status === 429 || /429|rate limit/i.test(msg);
      if (!is429 || attempt === maxAttempts) break;
      const waitMs = 1500 * attempt;
      console.warn(`${label} 429 attempt ${attempt}, waiting ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

async function webSearchContact(openai, name, city, email) {
  const locationHint = city ? ` in ${city}` : ' in Toronto or GTA';
  const emailHint = email ? ` Their email is ${email}.` : '';

  try {
    const response = await withRetry(() => openai.chat.completions.create({
      model: 'gpt-4o-mini-search-preview',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Search for information about "${name}"${locationHint}.${emailHint}

Find: job title, employer/company, neighbourhood, approximate age, family situation, interests, community involvement, LinkedIn, social media, news mentions.

Do NOT infer profession from email domain unless it's a known corporate domain (e.g. @rbc.com, @osler.com). Consumer ISP emails like @rogers.com, @bell.ca, @gmail.com, @hotmail.com, @yahoo.com tell you nothing about where someone works.

Be specific and concise — just facts you find.`
      }]
    }), 'web search');
    return response.choices[0].message.content?.trim() || null;
  } catch(e) {
    console.warn('Web search failed:', e.message);
    return null;
  }
}

function socialDataContext(fubContact) {
  const s = fubContact?.socialData;
  if (!s) return null;
  const parts = [];
  if (s.company) parts.push(`company: ${s.company}`);
  if (s.title) parts.push(`title: ${s.title}`);
  if (s.bio) parts.push(`bio: ${s.bio.slice(0, 600)}`);
  if (s.location) parts.push(`location: ${s.location}`);
  if (s.linkedIn) parts.push(`LinkedIn: ${s.linkedIn}`);
  if (s.gender) parts.push(`gender: ${s.gender}`);
  if (s.age) parts.push(`age: ${s.age}`);
  return parts.length ? parts.join('\n') : null;
}

function inferFromEmail(email) {
  if (!email) return null;
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  
  const domainMap = {
    // Finance
    'rbc.com': 'Works at RBC (Royal Bank of Canada) — Finance profession',
    'td.com': 'Works at TD Bank — Finance profession',
    'bmo.com': 'Works at BMO — Finance profession',
    'scotiabank.com': 'Works at Scotiabank — Finance profession',
    'cibc.com': 'Works at CIBC — Finance profession',
    'sunlife.com': 'Works at Sun Life Financial — Finance/Insurance profession',
    'manulife.com': 'Works at Manulife — Finance/Insurance profession',
    // Legal
    'osler.com': 'Works at Osler law firm — Legal profession',
    'blg.com': 'Works at Borden Ladner Gervais — Legal profession',
    'mccarthy.ca': 'Works at McCarthy Tétrault — Legal profession',
    // Healthcare
    'sunnybrook.ca': 'Works at Sunnybrook Hospital — Healthcare profession',
    'uhn.ca': 'Works at University Health Network — Healthcare profession',
    'sickkids.ca': 'Works at SickKids Hospital — Healthcare profession',
    // Tech
    'shopify.com': 'Works at Shopify — Tech profession',
    // rogers.com and bell.ca removed — used as personal ISP emails, not work emails
    // Real Estate
    'realtor.ca': 'Real estate agent',
    'century21.ca': 'Real estate agent at Century 21',
    'royallepage.ca': 'Real estate agent at Royal LePage',
    'remax.ca': 'Real estate agent at RE/MAX',
  };
  
  // Check exact domain match
  if (domainMap[domain]) return domainMap[domain];
  
  // Check for government emails
  if (domain.endsWith('.gc.ca') || domain.endsWith('.gov.on.ca')) return 'Works in government — likely stable employment, homeowner profile';
  if (domain.endsWith('.edu') || domain.endsWith('.ac.ca') || domain.endsWith('.utoronto.ca')) return 'Works in education/academia';
  if (domain.endsWith('.on.ca') && domain.includes('school')) return 'Works in education — Teacher/Administrator';
  
  // Generic business email = business owner signal
  if (!['gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','me.com'].includes(domain)) {
    return `Has business email @${domain} — likely business owner or professional`;
  }
  
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, city, fubApiKey, email, skip_web_search, agentId } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const fubKey = fubApiKey || process.env.FUB_API_KEY;

    // Step 1 — pull FUB data
    const fubContact = await searchFUB(name, fubKey);
    const contactEmail = email || (fubContact?.emails || [])[0]?.value || null;

    // Build FUB context
    let fubContext = '';
    if (fubContact) {
      const emails = (fubContact.emails || []).map(e => e.value).join(', ');
      const phones = (fubContact.phones || []).map(p => p.value).join(', ');
      const addr = (fubContact.addresses || []).map(a => [a.street, a.city, a.state].filter(Boolean).join(' ')).join(', ');
      const tags = (fubContact.tags || []).join(', ');
      const lastContact = fubContact.lastCommunicationDate || fubContact.updated || null;
      
      fubContext = `
EXISTING FUB DATA:
- Name: ${fubContact.firstName || ''} ${fubContact.lastName || ''}
- Job title: ${fubContact.jobTitle || 'unknown'}
- Company: ${fubContact.company || 'unknown'}
- Email(s): ${emails || 'none'}
- Phone(s): ${phones || 'none'}
- Address: ${addr || 'unknown'}
- Existing tags: ${tags || 'none'}
- Source: ${fubContact.source || 'unknown'}
- Last contact: ${lastContact || 'unknown'}
- Created: ${fubContact.created || 'unknown'}
`;
    }

    // Step 2 — email domain inference (always run)
    const emailInference = inferFromEmail(contactEmail);

    // Step 3 — FUB socialData (free, from FUB's own enrichment)
    const socialCtx = socialDataContext(fubContact);

    // Step 4 — web search: caller can force-skip (bulk load), or we skip when FUB socialData has the signal
    const skipWebSearch = !!skip_web_search || !!(socialCtx && (fubContact?.socialData?.company || fubContact?.socialData?.bio));
    const webResult = skipWebSearch ? null : await webSearchContact(openai, name, city, contactEmail);

    // Build full context
    const contextParts = [];
    if (fubContext) contextParts.push(fubContext);
    if (socialCtx) contextParts.push(`\nFUB SOCIAL DATA:\n${socialCtx}`);
    if (emailInference) contextParts.push(`\nEMAIL INFERENCE:\n${emailInference}`);
    if (webResult) contextParts.push(`\nWEB SEARCH RESULTS:\n${webResult}`);
    
    const dataAvailable = contextParts.length > 0 
      ? contextParts.join('\n')
      : 'No data found — use name and city context only, assign low confidence.';

    const tagList = FUB_TAGS.join(', ');

    const prompt = `You are a real estate CRM enrichment agent specializing in the Toronto/GTA market. Analyze this contact and suggest the most relevant CRM tags.

Contact: "${name}"${city ? ` — City: ${city}` : ''}
${dataAvailable}

RULES:
1. Tags MUST be copied EXACTLY from the available list — character for character
2. Always include an Age tag (Age: 20s / 30s / 40s / 50s / 60+) — calculate from birth year if known. Current year is 2026. Born 1990-1999 = 27-36 = Age: 30s. Born 1987-1996 = 30-39 = Age: 30s. Born 1980-1986 = 40-46 = Age: 40s. Do not use decade of birth — use actual age in 2026.
3. Always include a Life Stage tag when inferable
4. Always include a Profession tag when inferable
5. Use Relationship tag based on source/history (Past Client = Relationship: Past Client, sphere = Relationship: Sphere, etc.)
6. Confidence should be "high" when web search confirms details, "medium" when inferred from email/FUB, "low" when guessing from name only
7. Max 8 tags

Available tags (copy EXACTLY):
${tagList}

Return ONLY this JSON — no markdown:
{
  "full_name": "properly cased name",
  "initials": "2 uppercase chars",
  "job_title": "from data or inferred",
  "company": "from data or inferred",
  "location": "city or neighbourhood",
  "likely_age_range": "20s|30s|40s|50s|60+|unknown",
  "family_signals": "e.g. Married with 2 kids or null",
  "interests": ["array"],
  "community_involvement": [],
  "linkedin_url": null,
  "suggested_tags": [
    {"tag": "EXACT tag from list", "reason": "specific signal that supports this", "confidence": "high|medium|low"}
  ],
  "notes": "2-3 sentences useful for a real estate agent making a nurturing call",
  "confidence_overall": "high|medium|low",
  "warning": null
}`;

    const response = await withRetry(() => openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1400,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    }), 'tag suggest');

    const result = JSON.parse(response.choices[0].message.content);

    // ── Priority override: FUB social/LinkedIn data beats web search guesses ──
    // FUB already pulled LinkedIn/Google data — use it as ground truth
    if (fubContact?.socialData?.title && (!result.job_title || result.job_title === 'unknown')) {
      result.job_title = fubContact.socialData.title;
    }
    if (fubContact?.socialData?.company && (!result.company || result.company === 'unknown')) {
      result.company = fubContact.socialData.company;
    }
    // Also pull from FUB background field — parse "Works at X as Y" or "Occupation: X"
    const bg = fubContact?.background || '';
    if (bg) {
      const worksAt = bg.match(/Works at (.+?) as (.+)/i);
      const occupation = bg.match(/Occupation: (.+)/i);
      if (worksAt) {
        if (!result.company || result.company === 'unknown') result.company = worksAt[1].trim();
        if (!result.job_title || result.job_title === 'unknown') result.job_title = worksAt[2].split('\n')[0].trim();
      } else if (occupation) {
        if (!result.job_title || result.job_title === 'unknown') result.job_title = occupation[1].split('\n')[0].trim();
      }
      // Also check for "Director, Investments at Harbour Equity" format
      const atFormat = bg.match(/^([^\n]+?) at ([^\n]+)/i);
      if (atFormat && (!result.job_title || result.job_title === 'unknown')) {
        result.job_title = atFormat[1].trim();
        result.company = atFormat[2].trim();
      }
    }
    // FUB native jobTitle field (some accounts have it)
    if (fubContact?.jobTitle && (!result.job_title || result.job_title === 'unknown')) {
      result.job_title = fubContact.jobTitle;
    }

    // Server-side filter: strip tags not in approved list
    if (result.suggested_tags) {
      result.suggested_tags = result.suggested_tags.filter(t => FUB_TAGS_SET.has(t.tag));
    }

    // Override age tag using actual birthday if available
    const birthdayRaw = result.birthday || contact?.birthday || null;
    if (birthdayRaw) {
      try {
        const bDate = new Date(birthdayRaw);
        const now = new Date();
        const age = now.getFullYear() - bDate.getFullYear() -
          (now < new Date(now.getFullYear(), bDate.getMonth(), bDate.getDate()) ? 1 : 0);
        const ageTag = age < 30 ? 'Age: 20s' : age < 40 ? 'Age: 30s' : age < 50 ? 'Age: 40s' : age < 60 ? 'Age: 50s' : 'Age: 60+';
        // Remove any existing age tags and replace with correct one
        result.suggested_tags = (result.suggested_tags || []).filter(t => !t.tag.startsWith('Age:'));
        result.suggested_tags.push({ tag: ageTag, confidence: 'high', reason: `Born ${birthdayRaw} — age ${age}` });
      } catch(e) {}
    }

    // Attach FUB data
    result.fub_data = fubContact ? {
      email: (fubContact.emails || [])[0]?.value || null,
      phone: (fubContact.phones || [])[0]?.value || null,
      address: (fubContact.addresses || [])[0]
        ? [fubContact.addresses[0].street, fubContact.addresses[0].city].filter(Boolean).join(', ')
        : null,
      existing_tags: fubContact.tags || [],
      fub_id: fubContact.id
    } : null;

    // ── Auto-attach existing FINTRAC + trade data from Redis ──
    try {
      const { Redis } = require('@upstash/redis');
      const redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

      function normName(n) { return (n||'').toLowerCase().replace(/\s+/g,' ').trim(); }
      function nameMatch(a, b) {
        const ta = normName(a).split(' ').filter(t=>t.length>=2);
        const tb = normName(b).split(' ').filter(t=>t.length>=2);
        return ta.length && tb.length && ta[0]===tb[0] && ta[ta.length-1]===tb[tb.length-1];
      }

      // Find matching contact in History for FINTRAC data
      const contactIds = agentId ? await redis.lrange(`agent:${agentId}:contacts`, 0, 999) : [];
      if (contactIds && contactIds.length) {
        const raws = await Promise.all(contactIds.map(id => redis.get(id)));
        for (const raw of raws) {
          if (!raw) continue;
          const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (nameMatch(result.full_name, c.full_name || c.name)) {
            if (c.birthday && !result.birthday) result.birthday = c.birthday;
            if (c.job_title && !result.job_title) result.job_title = c.job_title;
            if (c.company && !result.company) result.company = c.company;
            if (c.fintrac_verified) result.fintrac_verified = true;
            break;
          }
        }
      }

      // Find matching trades
      const tradeIds = agentId ? await redis.lrange(`agent:${agentId}:trades`, 0, 499) : [];
      if (tradeIds && tradeIds.length) {
        const tradeRaws = await Promise.all(tradeIds.map(id => redis.get(id)));
        const matchedTrades = [];
        for (const raw of tradeRaws) {
          if (!raw) continue;
          const t = typeof raw === 'string' ? JSON.parse(raw) : raw;
          const buyer = t.buyer_or_tenant_name || '';
          const seller = t.seller_or_landlord_name || '';
          if (nameMatch(result.full_name, buyer) || nameMatch(result.full_name, seller)) {
            matchedTrades.push({
              address: t.property_address,
              close_date: t.close_date,
              deal_type: t.deal_type,
              side: nameMatch(result.full_name, buyer) ? (t.deal_type === 'lease' ? 'tenant' : 'buyer') : (t.deal_type === 'lease' ? 'landlord' : 'seller'),
              sale_price: t.sale_price || t.monthly_rent
            });
          }
        }
        if (matchedTrades.length) {
          result.trade_history = matchedTrades;
          // Add Past Client tag if not already there
          if (!result.suggested_tags.find(t => t.tag === 'Relationship: Past Client')) {
            result.suggested_tags.push({ tag: 'Relationship: Past Client', confidence: 'high', reason: `Found ${matchedTrades.length} deal(s) in Past Trades` });
          }
          // Add buyer/seller tag based on most recent trade
          const latest = matchedTrades[0];
          if (latest.side === 'buyer' && !result.suggested_tags.find(t => t.tag === 'Client: Buyer')) {
            result.suggested_tags.push({ tag: 'Client: Buyer', confidence: 'high', reason: `Purchased ${latest.address}` });
          } else if (latest.side === 'seller' && !result.suggested_tags.find(t => t.tag === 'Client: Seller')) {
            result.suggested_tags.push({ tag: 'Client: Seller', confidence: 'high', reason: `Sold ${latest.address}` });
          }
        }
      }
    } catch(e) {
      console.warn('Auto-attach FINTRAC/trades failed (non-fatal):', e.message);
    }

    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
