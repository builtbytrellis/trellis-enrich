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

        // The FINTRAC form template fills the first ~3000 chars; the filled-in
        // fields live much deeper. Send a generous window so the model sees them.
        const textForModel = text.slice(0, 15000);

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
              content: `This is text extracted from a FINTRAC (Financial Transactions and Reports Analysis Centre of Canada) identity verification form from a Canadian real estate transaction. The form template boilerplate fills most of the text; the actual filled-in client data appears as scattered lines (name, address, DOB in YYYY/MM/DD, occupation, ID type and number).

Extracted text:
${textForModel}

Extract ALL information and return ONLY valid JSON:
{
  "full_name": "full legal name of the client/individual being identified (NOT the realtor) or null",
  "date_of_birth": "YYYY-MM-DD format or null",
  "occupation": "occupation/job title or null",
  "employer": "employer/company or null",
  "address": "street address of individual or null",
  "city": "city or null",
  "province": "province or null",
  "phone": "phone number or null",
  "email": "email or null",
  "id_type": "Passport/Driver's Licence/etc or null",
  "id_number": "ID number or null",
  "is_buyer": true,
  "is_seller": false,
  "property_address": "transaction property address or null"
}
If this is not a FINTRAC form return: {"not_fintrac": true}`
            }]
          })
        }).then(async r => {
          const j = await r.json();
          if (j.error) { const e = new Error(j.error.message); e.status = r.status; throw e; }
          return j;
        });

        const data = await withRetry(callOpenAI, `fintrac:${pdf.filename}`);
        const extracted = JSON.parse(data.choices?.[0]?.message?.content || '{}');

        if (extracted.not_fintrac) {
          results.push({ filename: pdf.filename, error: 'PDF did not look like a FINTRAC form to the model' });
        } else if (!extracted.full_name) {
          results.push({ filename: pdf.filename, error: 'No full_name extracted — form may be blank or unreadable', ...extracted });
        } else {
          results.push({ filename: pdf.filename, ...extracted });
        }

      } catch(fileErr) {
        console.error('Error on', pdf.filename, fileErr.message);
        results.push({ filename: pdf.filename, error: fileErr.message });
      }
    }

    return res.status(200).json({ success: true, count: results.length, results });
  } catch(e) {
    console.error('Extract FINTRAC error:', e);
    return res.status(500).json({ error: e.message });
  }
};
