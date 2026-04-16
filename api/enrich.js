const OpenAI = require('openai');

const FUB_TAGS = ["Relationship: A++","Relationship: A+","Relationship: A","Relationship: B","Relationship: C","Relationship: Past Client","Relationship: Referral Source","Relationship: Super Referrer","Relationship: VIP","Relationship: Sphere","Client: Buyer","Client: Seller","Client: Investor","Client: Landlord","Client: Tenant","Buyer Phase: Inquiry","Buyer Phase: Pre-Approval","Buyer Phase: Actively Viewing","Buyer Phase: Offer Stage","Buyer Phase: Under Contract","Buyer Phase: Closed","Seller Phase: Just Thinking","Seller Phase: Preparing Home","Seller Phase: Ready to List","Seller Phase: Listed","Seller Phase: Sold","Timeline: Now","Timeline: 3-6 Months","Timeline: 6-12 Months","Timeline: 12+ Months","Property: Detached","Property: Semi","Property: Condo","Property: Townhouse","Property: Freehold","Property: Bungalow","Owner: Primary Residence","Owner: Investment Property","Owner: Rental Property","Owner: Multiple Properties","Family: Kids Under 5","Family: Kids 5-10","Family: Kids Teens","Family: Kids Adult","Family: No Kids","Family: Newly Married","Family: Expecting Baby","Family: Empty Nester","Family: Growing Family","Age: 20s","Age: 30s","Age: 40s","Age: 50s","Age: 60+","Profession: Finance","Profession: Healthcare","Profession: Legal","Profession: Tech","Profession: Education","Profession: Trades","Profession: Business Owner","Lifestyle: Loves Travel","Lifestyle: Fitness Focused","Lifestyle: Design Oriented","Lifestyle: Foodie","Lifestyle: Golfer","Lifestyle: Cottage Owner","Buyer: Luxury","Buyer: Renovation","Buyer: Turnkey","Buyer: School Focused","Buyer: Price Sensitive","Opportunity: Likely Seller","Opportunity: Likely Buyer","Opportunity: Upsizer","Opportunity: Downsizer","Opportunity: Mortgage Renewal 6M","Opportunity: Mortgage Renewal 12M","Opportunity: Owned 3+ Years","Opportunity: Owned 5+ Years","Opportunity: Owned 10+ Years","Opportunity: High Equity Owner","Opportunity: Would Sell If Right Price","Opportunity: Would Buy If Right Price","Life Event: Divorce / Separation","Life Event: New Job","Life Event: Job Relocation","Life Event: New Baby","Life Event: Death in Family","Life Event: Recently Purchased","Divorce: Male","Divorce: Female","Divorce: Stage 1 Separated","Divorce: Stage 2 Divorced","Divorce: Nesting","Divorce: Renting","Engagement: Active","Engagement: Nurture","Engagement: Cold","Engagement: Highly Engaged","Engagement: Ghosted","Engagement: Re-Engaged","Engagement: Do Not Contact","Engagement: Do Not Mail","Comms: Prefers Text","Comms: Prefers Call","Comms: Prefers Email","Comms: Slow Responder","Decision: Husband","Decision: Wife","Decision: Joint","Psychology: Risk Averse","Psychology: Analytical","Psychology: Emotional Buyer","Psychology: Status Driven","Network: Connector","Network: Community Leader","Network: Business Owner","Network: School Community Leader","Network: PTA / Parent Group"];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, city } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = `You are a real estate CRM enrichment agent for Toronto/GTA. Based on your knowledge, return info about this person.

Contact: "${name}"${city ? `\nCity: ${city}` : ''}

Return ONLY a JSON object, no markdown, no explanation:
{"full_name":"string","initials":"2 chars","job_title":null,"company":null,"location":null,"likely_age_range":"20s|30s|40s|50s|60+|unknown","family_signals":null,"interests":[],"community_involvement":[],"linkedin_url":null,"suggested_tags":[{"tag":"exact tag","reason":"one sentence","confidence":"high|medium|low"}],"notes":null,"confidence_overall":"high|medium|low","warning":null}

Available tags: ${FUB_TAGS.join(', ')}
Max 6 tags. Be conservative. If name is too common set confidence_overall to low and add a warning.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1000,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    });

    res.status(200).json(JSON.parse(response.choices[0].message.content));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
