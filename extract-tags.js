const Anthropic = require('@anthropic-ai/sdk');

const FUB_TAGS = ["Relationship: A++","Relationship: A+","Relationship: A","Relationship: B","Relationship: C","Relationship: Past Client","Relationship: Referral Source","Relationship: Super Referrer","Relationship: VIP","Relationship: Sphere","Client: Buyer","Client: Seller","Client: Investor","Client: Landlord","Client: Tenant","Family: Kids Under 5","Family: Kids 5-10","Family: Kids Teens","Family: Kids Adult","Family: No Kids","Family: Newly Married","Family: Expecting Baby","Family: Empty Nester","Family: Growing Family","Age: 20s","Age: 30s","Age: 40s","Age: 50s","Age: 60+","Profession: Finance","Profession: Healthcare","Profession: Legal","Profession: Tech","Profession: Education","Profession: Trades","Profession: Business Owner","Lifestyle: Loves Travel","Lifestyle: Fitness Focused","Lifestyle: Design Oriented","Lifestyle: Foodie","Lifestyle: Golfer","Lifestyle: Cottage Owner","Opportunity: Likely Seller","Opportunity: Likely Buyer","Opportunity: Upsizer","Opportunity: Downsizer","Opportunity: Mortgage Renewal 6M","Opportunity: Mortgage Renewal 12M","Life Event: Divorce / Separation","Life Event: New Job","Life Event: New Baby","Life Event: Recently Purchased","Divorce: Male","Divorce: Female","Divorce: Stage 1 Separated","Divorce: Stage 2 Divorced","Engagement: Active","Engagement: Nurture","Engagement: Cold","Comms: Prefers Text","Comms: Prefers Call","Comms: Prefers Email","Psychology: Risk Averse","Psychology: Analytical","Psychology: Emotional Buyer","Psychology: Status Driven","Network: Connector","Network: Community Leader","Network: Business Owner"];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { transcript, contactName } = req.body;
  if (!transcript) return res.status(400).json({ error: 'Transcript required' });

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const prompt = `A real estate agent recorded a voice memo about "${contactName || 'a contact'}". Extract CRM tags from what they said.

Transcript: "${transcript}"

Return ONLY raw JSON:
{"suggested_tags":[{"tag":"exact tag","reason":"what supports this","confidence":"high|medium|low"}],"extracted_details":{"job_title":null,"company":null,"birthday":null,"address":null,"family_notes":null,"interests":[]},"notes":"any important info"}

Available tags: ${FUB_TAGS.join(', ')}
Only extract tags clearly supported by what the agent said.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }]
    });

    let text = response.content[0].text.replace(/```json|```/g, '').trim();
    res.status(200).json(JSON.parse(text));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
