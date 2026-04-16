const OpenAI = require('openai');
const Busboy = require('busboy');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const chunks = [];
    let filename = 'audio.webm';
    let mimetype = 'audio/webm';

    await new Promise((resolve, reject) => {
      const bb = Busboy({ headers: req.headers });
      bb.on('file', (name, file, info) => {
        filename = info.filename || filename;
        mimetype = info.mimeType || mimetype;
        file.on('data', d => chunks.push(d));
        file.on('end', resolve);
      });
      bb.on('error', reject);
      req.pipe(bb);
    });

    const buffer = Buffer.concat(chunks);
    const { toFile } = require('openai');
    const file = await toFile(buffer, filename, { type: mimetype });
    const transcription = await openai.audio.transcriptions.create({ file, model: 'whisper-1', language: 'en' });
    res.status(200).json({ transcript: transcription.text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
