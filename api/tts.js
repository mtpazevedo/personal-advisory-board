const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../lib/auth');

const ADVISORS_FILE = path.join(process.cwd(), 'advisors.json');

async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAuth(req, res)) return;
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return res.status(503).json({ error: 'Voices not enabled: set ELEVENLABS_API_KEY in the Vercel environment.' });
  }
  // GET (progressive <audio> playback) reads query; POST reads body
  const { advisorId, text, voiceId } = req.method === 'GET' ? req.query : req.body;
  if ((!advisorId && !voiceId) || !text) {
    return res.status(400).json({ error: 'advisorId (or voiceId) and text are required' });
  }
  const advisors = JSON.parse(fs.readFileSync(ADVISORS_FILE, 'utf8'));
  const advisor = advisorId ? advisors.find(a => a.id === advisorId) : null;
  const useVoice = voiceId || (advisor && advisor.voiceId);
  if (!useVoice) {
    return res.status(404).json({ error: 'Advisor has no voiceId configured' });
  }
  try {
    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${useVoice}/stream?output_format=mp3_44100_128&optimize_streaming_latency=2`,
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: String(text).slice(0, 5000),
          model_id: 'eleven_multilingual_v2',
          ...(advisor && advisor.voiceSettings ? { voice_settings: advisor.voiceSettings } : {}),
        }),
      }
    );
    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).json({ error: err.slice(0, 500) });
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    const reader = r.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error('TTS error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
}

module.exports = handler;
module.exports.config = { supportsResponseStreaming: true };
