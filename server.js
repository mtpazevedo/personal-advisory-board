require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { DEFAULT_MODEL, buildAskSystemPrompt, buildSynthesisSystemPrompt } = require('./lib/prompts');

const app = express();
const PORT = process.env.PORT || 3000;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ADVISORS_FILE = path.join(__dirname, 'advisors.json');

app.use(express.json({ limit: '20mb' })); // larger limit for base64 photo uploads
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ──────────────────────────────────────────────────────────────────

function readAdvisors() {
  return JSON.parse(fs.readFileSync(ADVISORS_FILE, 'utf8'));
}

function writeAdvisors(data) {
  fs.writeFileSync(ADVISORS_FILE, JSON.stringify(data, null, 2));
}

// ── Advisor CRUD ─────────────────────────────────────────────────────────────

app.get('/api/advisors', (req, res) => {
  res.json(readAdvisors());
});

app.put('/api/advisors', (req, res) => {
  writeAdvisors(req.body);
  res.json({ success: true });
});

// ── Ask (streaming) ──────────────────────────────────────────────────────────

app.post('/api/ask', async (req, res) => {
  const { question, advisorId, userProfile, history } = req.body;
  if (!question || !advisorId) {
    return res.status(400).json({ error: 'question and advisorId are required' });
  }

  const advisors = readAdvisors();
  const advisor = advisors.find(a => a.id === advisorId);
  if (!advisor) {
    return res.status(404).json({ error: 'Advisor not found' });
  }

  const systemPrompt = buildAskSystemPrompt(advisor, advisors, userProfile, history);

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  try {
    const stream = client.messages.stream({
      model: advisor.model || DEFAULT_MODEL,
      max_tokens: 2500,
      system: systemPrompt,
      messages: [{ role: 'user', content: question }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        res.write(event.delta.text);
      }
    }
    res.end();
  } catch (err) {
    console.error('Claude API error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`\n\n[Error: ${err.message}]`);
      res.end();
    }
  }
});

// ── Text-to-speech (ElevenLabs) ──────────────────────────────────────────────

app.post('/api/tts', async (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return res.status(503).json({ error: 'Voices not enabled: add ELEVENLABS_API_KEY to .env and restart.' });
  }
  const { advisorId, text } = req.body;
  if (!advisorId || !text) {
    return res.status(400).json({ error: 'advisorId and text are required' });
  }
  const advisor = readAdvisors().find(a => a.id === advisorId);
  if (!advisor || !advisor.voiceId) {
    return res.status(404).json({ error: 'Advisor has no voiceId configured' });
  }
  try {
    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${advisor.voiceId}/stream?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: String(text).slice(0, 5000),
          model_id: 'eleven_multilingual_v2',
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
    console.error('TTS error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

// ── Board Synthesis (weighted recommendation) ────────────────────────────────

app.post('/api/synthesize', async (req, res) => {
  const { question, responses, userProfile } = req.body;
  if (!question || !responses || !responses.length) {
    return res.status(400).json({ error: 'question and responses are required' });
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const advisorInputs = responses
    .map(
      (r) =>
        `### ${r.name} (${r.title})\nExpertise: ${(r.expertise || []).join(', ')}\n\nResponse:\n${r.text}`
    )
    .join('\n\n---\n\n');

  try {
    const stream = client.messages.stream({
      model: DEFAULT_MODEL,
      max_tokens: 3000,
      system: buildSynthesisSystemPrompt(userProfile),
      messages: [
        {
          role: 'user',
          content: `Question posed to the board:\n"${question}"\n\nIndividual responses:\n\n${advisorInputs}`,
        },
      ],
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        res.write(event.delta.text);
      }
    }
    res.end();
  } catch (err) {
    console.error('Synthesis error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`\n\n[Error: ${err.message}]`);
      res.end();
    }
  }
});

// Start server locally (Vercel uses the exported app directly)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n  Personal Advisory Board running at http://localhost:${PORT}\n`);
  });
}

module.exports = app;
module.exports.config = { supportsResponseStreaming: true };
