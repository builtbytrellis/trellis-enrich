const { verifySession } = require('./auth');
const fetch = require('node-fetch');

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = await verifySession(req, res);
  if (!session) return;

  try {
    const { pdfs } = req.body;
    if (!pdfs || !pdfs.length) return res.status(400).json({ error: 'No PDFs provided' });

    const results = [];

    for (const pdf of pdfs) {
      try {
        const pdfBuffer = Buffer.from(pdf.base64, 'base64');
        const pdfParse = require('pdf-parse');
        const pdfData = await pdfParse(pdfBuffer);
        const text = pdfData.text || '';

        if (!text.trim()) {
          results.push({ filename: pdf.filename, error: 'PDF has no extractable text (likely scanned image — OCR not yet supported)' });
          continue;
        }

        // TP commission statements are short (~3K chars); send the whole thing.
        // Cap at 10K as a safety bound for unusual documents.
        const textForModel = text.length > 10000 ? text.slice(0, 10000) : text;

        const callOpenAI = () => fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 900,
            response_format: { type: 'json_object' },
            messages: [{
              role: 'user',
              content: `This is text extracted from a real estate brokerage Trade Package (TP) / commission statement — typically issued by the agent's brokerage (e.g. Forest Hill Real Estate Inc.) when a deal is processed. The agent in question is the one named under "Agents:" — they earned the commission on this trade.

The document has labeled sections. Common fields and where to find them:
- Property header at the top: street address, then city/province/postal on the next line
- Type / Class lines explain the deal:
    "A - RESIDENTIAL" / "A - COMMERCIAL" etc. → property_type
    "A - LISTING" or "OUR LISTING" → agent was on SELLER side (listing agent)
    "B - SALE OF COMPETITOR'S LISTING" → agent was on BUYER side (selling agent, i.e. they brought the buyer)
    "C - LEASE" → lease deal
- MLS #: the listing ID
- Offer Date, Entry Date, Firm Date, Close Date
- Status (Open / Firm / Closed)
- Contacts section lists Buyer, Seller, Solicitors. Each line has a one-letter end marker:
    "BuyerSMARCO PICCOLO27 ALLOWAY PL, MAPLE, ON, L6A-1N9, CA" — the S after "Buyer" is a side marker; the name follows immediately, then address
- Selling Price (the actual sale price)
- Deposit amount + who held it ("Held By")
- Listing Comm. Rate vs Selling Comm. Rate:
    If Listing Comm. Rate > 0% → agent was on LISTING (seller) side
    If Selling Comm. Rate > 0% → agent was on SELLING (buyer) side
    Both > 0% = double-end deal (agent represented both sides)
- Commission row breaks out: Listing / Listing Other / Selling / Selling Other / Sub-Total / HST / Total
- Agents section names the agent (e.g. "GREENSPAN, LORRY") with their agent code

Extracted text:
${textForModel}

Return ONLY valid JSON. Use null for any field you can't find. Numeric fields as numbers (not strings, no dollar signs or commas). Dates as YYYY-MM-DD.

{
  "mls_number": "string or null",
  "property_address": "street address with unit (e.g. '35 Bastion Street, Unit 1920')",
  "property_city": "string or null",
  "property_province": "two-letter province code or null",
  "property_postal": "postal code or null",
  "property_type": "Residential / Commercial / Lease or null",
  "agent_name": "the agent named in the Agents section (e.g. 'Lorry Greenspan')",
  "agent_code": "string or null",
  "agent_side": "'buyer' if Selling Comm. Rate > 0 and Listing Comm. Rate = 0, 'seller' if reversed, 'both' if double-end, null if unclear",
  "buyer_name": "full name of buyer or null",
  "buyer_address": "buyer's address as shown (this is where they CURRENTLY live, BEFORE moving into the property they bought) or null",
  "seller_name": "full name of seller or null",
  "seller_address": "seller's address as shown or null",
  "selling_price": numeric_or_null,
  "deposit": numeric_or_null,
  "deposit_held_by": "string or null",
  "offer_date": "YYYY-MM-DD or null",
  "firm_date": "YYYY-MM-DD or null",
  "close_date": "YYYY-MM-DD or null",
  "status": "Open / Firm / Closed or null",
  "listing_commission_pct": numeric_or_null,
  "selling_commission_pct": numeric_or_null,
  "gross_commission": "the total selling-side commission amount before splits, or null",
  "agent_share_pretax": "the agent's share before HST (from the Agents row) or null",
  "agent_share_after_hst": "the agent's net after HST or null",
  "outside_brokerage": "the OTHER brokerage on the deal (e.g. the listing brokerage if agent was buy-side) or null",
  "outside_brokerage_agent": "the OTHER agent or null"
}
If this is not a brokerage trade package or commission statement return: {"not_trade_package": true}`
            }]
          })
        }).then(async r => {
          const j = await r.json();
          if (j.error) { const e = new Error(j.error.message); e.status = r.status; throw e; }
          return j;
        });

        const data = await withRetry(callOpenAI, `trade:${pdf.filename}`);
        const extracted = JSON.parse(data.choices?.[0]?.message?.content || '{}');

        if (extracted.not_trade_package) {
          results.push({ filename: pdf.filename, error: 'PDF did not look like a brokerage trade package / commission statement' });
        } else if (!extracted.property_address && !extracted.selling_price) {
          results.push({ filename: pdf.filename, error: 'No property address or sale price extracted — form may be unreadable', ...extracted });
        } else {
          results.push({ filename: pdf.filename, ...extracted });
        }
      } catch (fileErr) {
        console.error('Error on', pdf.filename, fileErr.message);
        results.push({ filename: pdf.filename, error: fileErr.message });
      }
    }

    return res.status(200).json({ success: true, count: results.length, results });
  } catch (e) {
    console.error('extract-trade error:', e);
    return res.status(500).json({ error: e.message });
  }
};
