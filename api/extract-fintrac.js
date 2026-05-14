const { verifySession } = require('./auth');
const fetch = require('node-fetch');

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
        // Convert base64 PDF to buffer and extract text using pdf-parse
        const pdfBuffer = Buffer.from(pdf.base64, 'base64');
        
        // Use pdf-parse to extract text
        const pdfParse = require('pdf-parse');
        const pdfData = await pdfParse(pdfBuffer);
        const text = pdfData.text || '';

        if (!text.trim()) {
          console.log('No text extracted from', pdf.filename, '— may be scanned');
          continue;
        }

        // Send extracted text to GPT-4o
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: 1000,
            response_format: { type: 'json_object' },
            messages: [{
              role: 'user',
              content: `This is text extracted from a FINTRAC (Financial Transactions and Reports Analysis Centre of Canada) identity verification form from a Canadian real estate transaction.

Extracted text:
${text.slice(0, 3000)}

Extract ALL information and return ONLY valid JSON:
{
  "full_name": "full legal name or null",
  "date_of_birth": "YYYY-MM-DD format or null",
  "occupation": "occupation or null",
  "employer": "employer or null",
  "address": "street address or null",
  "city": "city or null",
  "province": "province or null",
  "phone": "phone number or null",
  "email": "email or null",
  "id_type": "Passport/Driver License/etc or null",
  "id_number": "ID number or null",
  "is_buyer": true,
  "is_seller": false,
  "property_address": "property address or null"
}
If this is not a FINTRAC form return: {"not_fintrac": true}`
            }]
          })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        const extracted = JSON.parse(data.choices?.[0]?.message?.content || '{}');
        
        if (!extracted.not_fintrac && extracted.full_name) {
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
