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
        const text = (pdfData.text || '').trim();

        if (text.length < 200) {
          results.push({
            filename: pdf.filename,
            error: 'PDF has minimal extractable text (likely scanned image / Authentisign-wrapped). OCR support is needed for this brokerage\'s format.'
          });
          continue;
        }

        const textForModel = text.length > 10000 ? text.slice(0, 10000) : text;

        const callOpenAI = () => fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 1000,
            response_format: { type: 'json_object' },
            messages: [{
              role: 'user',
              content: `You are extracting deal data from a real estate brokerage Trade Package / Commission Statement. Layouts differ by brokerage; do not assume any specific labels.

STEP 1 — IDENTIFY DEAL TYPE
Look for any of these signals:
  - "LEASE", "RENTAL", "LEASING", "Monthly Rent", "Tenant", "Landlord", "Lessee", "Lessor" → deal_type = "lease"
  - "SALE", "Purchase", "Buyer", "Seller", "Vendor", "Selling Price" with a price > \$100,000 → deal_type = "sale"
  - Very short doc (~<1000 chars) with only commission/fees and no parties or property section → deal_type = "lease_renewal" (renewal commission slip)
  - Class / Type / Category fields naming "RESIDENTIAL SALE", "RENTAL OR LEASING FEE", "COMMERCIAL LEASE", etc. — use them
  - If the "Selling Price" or main monetary amount is between \$1,000 and \$15,000, treat it as MONTHLY RENT (deal_type = lease), not a sale price

STEP 2 — IDENTIFY AGENT SIDE
The agent named in the document (usually under "Agents:" or similar) earned the commission. Determine which side:
  - "Listing Comm. Rate > 0" / "Listing Side" / "Listing Agent: <name>" → agent_side = "seller" (sale) or "landlord" (lease)
  - "Selling Comm. Rate > 0" / "Co-op Side" / "Buyer Agent: <name>" / "Selling Agent: <name>" → agent_side = "buyer" (sale) or "tenant" (lease)
  - Both > 0 → "both" (double-ended)

STEP 3 — EXTRACT NAMES
Names sometimes have a single-letter side-marker prefix (e.g. "BuyerSMARCO PICCOLO" — the S is a Selling-end marker, the actual name is MARCO PICCOLO; "SellerLDIANA BATALEVICH" — the L is the Listing-end marker, actual name is DIANA BATALEVICH). STRIP these single-letter prefixes.

Different brokerages use different role labels:
  - Sale: Buyer / Purchaser / Vendor / Seller
  - Lease: Tenant / Lessee / Landlord / Lessor

The "current address" shown for a buyer/tenant is where they live BEFORE this transaction (we'll use the property address as their new home after).

STEP 4 — PRICES
  - Sale → "sale_price" field; "monthly_rent" stays null
  - Lease → "monthly_rent" field; "sale_price" stays null
  - "Selling Price" labeled values map to whichever applies based on deal_type

Extracted text:
${textForModel}

Return ONLY valid JSON. Numbers as numbers (no dollar signs/commas). Dates as YYYY-MM-DD.

{
  "deal_type": "'sale' | 'lease' | 'lease_renewal' | 'unknown'",
  "mls_number": "string or null",
  "property_address": "street + unit (e.g. '35 Bastion Street, Unit 1920') or null",
  "property_city": "string or null",
  "property_province": "two-letter province or null",
  "property_postal": "postal code or null",
  "property_type": "'Residential' / 'Commercial' / null",
  "agent_name": "the agent who earned the commission",
  "agent_code": "string or null",
  "agent_side": "'buyer' (sale-buy), 'seller' (sale-list), 'tenant' (lease-rep-tenant), 'landlord' (lease-rep-landlord), 'both' (double-ended), or null",
  "buyer_or_tenant_name": "full name (strip side-marker prefix) or null",
  "buyer_or_tenant_current_address": "their address as shown (BEFORE the move) or null",
  "seller_or_landlord_name": "full name (strip side-marker prefix) or null",
  "seller_or_landlord_current_address": "address as shown or null",
  "sale_price": numeric_or_null,
  "monthly_rent": numeric_or_null,
  "lease_term_months": numeric_or_null,
  "deposit": numeric_or_null,
  "deposit_held_by": "string or null",
  "offer_date": "YYYY-MM-DD or null",
  "firm_date": "YYYY-MM-DD or null",
  "close_date": "YYYY-MM-DD or null",
  "status": "string or null",
  "listing_commission_pct": numeric_or_null,
  "selling_commission_pct": numeric_or_null,
  "gross_commission": numeric_or_null,
  "agent_share_pretax": numeric_or_null,
  "agent_share_after_hst": numeric_or_null,
  "outside_brokerage": "the OTHER brokerage on the deal or null",
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
        } else if (!extracted.property_address && !extracted.sale_price && !extracted.monthly_rent) {
          results.push({ filename: pdf.filename, error: 'No property address or price extracted — form may be unreadable', ...extracted });
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
