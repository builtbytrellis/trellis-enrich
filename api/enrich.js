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
  } catch(e) {
    return null;
  }
}

async function webSearchContact(openai, name, city) {
  const locationHint = city ? ` in ${city}` : ' in Toronto or GTA';
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-search-preview',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Search for information about "${name}"${locationHint}. I need: their job title, employer/company, neighbourhood, approximate age, family situation, and any notable interests or community involvement. Focus on LinkedIn, company websites, news, or social media. Be concise — just the facts you find.`
      }]
    });
    return response.choices[0].message.content?.trim() || null;
  } catch(e) {
    console.warn('Web search failed (non-fatal):', e.message);
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, city, fubApiKey } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const fubKey = fubApiKey || process.env.FUB_API_KEY;

    // Step 1 — pull existing FUB data
    const fubContact = await searchFUB(name, fubKey);

    // Build FUB context string
    let fubContext = '';
    if (fubContact) {
      const emails = (fubContact.emails || []).map(e => e.value).join(', ');
      const phones = (fubContact.phones || []).map(p => p.value).join(', ');
      const addr = (fubContact.addresses || []).map(a => [a.street, a.city, a.state].filter(Boolean).join(' ')).join(', ');
      const tags = (fubContact.tags || []).join(', ');
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
- Created: ${fubContact.created || 'unknown'}
`;
    }

    // Step 2 — web search when FUB data is missing or sparse
    const fubHasUsefulData = fubContact && (
      fubContact.jobTitle ||
      fubContact.company ||
      (fubContact.addresses || []).length > 0 ||
      (fubContact.tags || []).length > 2
    );

    let webContext = '';
    if (!fubHasUsefulData) {
      const searchResult = await webSearchContact(openai, name, city);
      if (searchResult) {
        webContext = `\nWEB SEARCH RESULTS:\n${searchResult}\n`;
      }
    }

    // Step 3 — GPT-4o tag generation
    const dataAvailable = (fubContext || webContext)
      ? `${fubContext}${webContext}`
      : 'No FUB data and web search returned no results — work from name and city only, use low confidence.';

    const tagList = FUB_TAGS.join(', ');

    const prompt = `You are a real estate CRM enrichment agent for Toronto/GTA. Analyze this contact and suggest CRM tags.

Contact name: "${name}"${city ? `\nCity context: ${city}` : ''}
${dataAvailable}

RULES — read carefully:
1. You MUST only suggest tags that appear EXACTLY in the available tag list below. Copy them character-for-character.
2. Do NOT invent tags, rephrase tags, or combine tags. If a concept is not in the list, skip it.
3. Always try to include an age tag (Age: 20s / Age: 30s / Age: 40s / Age: 50s / Age: 60+) — estimate from career stage, graduation year, family situation, or any other signal. Only omit if truly no signal exists.
4. Max 8 tags total.

Available tags (use ONLY these, copied exactly):
${tagList}

Return ONLY this JSON object — no markdown, no explanation:
{
  "full_name": "properly cased full name",
  "initials": "2 uppercase chars",
  "job_title": "from data or inferred or null",
  "company": "from data or inferred or null",
  "location": "city or neighbourhood or null",
  "likely_age_range": "20s or 30s or 40s or 50s or 60+ or unknown",
  "family_signals": "e.g. Married, 2 kids or null",
  "interests": ["array", "of", "strings"],
  "community_involvement": [],
  "linkedin_url": null,
  "suggested_tags": [
    { "tag": "EXACT tag from list", "reason": "one sentence citing the signal", "confidence": "high|medium|low" }
  ],
  "notes": "1-2 sentences useful for a real estate agent",
  "confidence_overall": "high|medium|low",
  "warning": null
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    });

    const result = JSON.parse(response.choices[0].message.content);

    // Server-side filter: strip any tags not in the approved list
    if (result.suggested_tags) {
      result.suggested_tags = result.suggested_tags.filter(t => FUB_TAGS_SET.has(t.tag));
    }

    // Attach raw FUB data for frontend use
    result.fub_data = fubContact ? {
      email: (fubContact.emails || [])[0]?.value || null,
      phone: (fubContact.phones || [])[0]?.value || null,
      address: (fubContact.addresses || [])[0]
        ? [fubContact.addresses[0].street, fubContact.addresses[0].city].filter(Boolean).join(', ')
        : null,
      existing_tags: fubContact.tags || [],
      fub_id: fubContact.id
    } : null;

    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
