const { verifySession } = require('./auth');
const formidable = require('formidable');
const fs = require('fs');
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
    const form = formidable({ maxFileSize: 20 * 1024 * 1024, maxFiles: 50 });
    const [, files] = await form.parse(req);

    const pdfFiles = files.pdfs || [];
    const fileList = Array.isArray(pdfFiles) ? pdfFiles : [pdfFiles];

    if (!fileList.length) return res.status(400).json({ error: 'No PDFs provided' });

    const results = [];

    for (const file of fileList) {
      try {
        const pdfBuffer = fs.readFileSync(file.filepath || file.path);
        const base64 = pdfBuffer.toString('base64');
        const filename = file.originalFilename || file.name || 'document.pdf';

        // Use OpenAI GPT-4o vision to extract FINTRAC data
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: 1000,
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `This is a FINTRAC (Financial Transactions and Reports Analysis Centre of Canada) identity verification form from a Canadian real estate transaction.

Extract ALL of the following and return ONLY valid JSON with no markdown:
{
  "full_name": "full legal name as written on form",
  "date_of_birth": "YYYY-MM-DD format or null",
  "occupation": "job title or occupation as written",
  "employer": "employer or company name or null",
  "address": "full street address or null",
  "city": "city or null",
  "province": "province or null",
  "phone": "phone number or null",
  "email": "email address or null",
  "id_type": "e.g. Passport, Driver License, etc or null",
  "id_number": "ID number or null",
  "id_expiry": "expiry date or null",
  "id_issuing_jurisdiction": "province or country that issued ID or null",
  "is_buyer": true or false,
  "is_seller": true or false,
  "property_address": "property address from the transaction if visible or null",
  "transaction_date": "YYYY-MM-DD or null"
}

If this is not a FINTRAC form, return: {"not_fintrac": true}
If there are multiple people on the form, return the PRIMARY person (first listed).`
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:application/pdf;base64,${base64}`,
                    detail: 'high'
                  }
                }
              ]
            }]
          })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);

        const text = data.choices?.[0]?.message?.content || '';
        const clean = text.replace(/```json\n?|```/g, '').trim();
        const extracted = JSON.parse(clean);

        if (!extracted.not_fintrac) {
          results.push({ filename, ...extracted });
        }

        // Clean up temp file
        try { fs.unlinkSync(file.filepath || file.path); } catch(_) {}

      } catch(fileErr) {
        console.error('Error processing', file.originalFilename, fileErr.message);
        results.push({ filename: file.originalFilename || 'unknown', error: fileErr.message });
      }
    }

    return res.status(200).json({ success: true, count: results.length, results });
  } catch(e) {
    console.error('Extract FINTRAC error:', e);
    return res.status(500).json({ error: e.message });
  }
};
