require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const {
  DEFAULT_MODEL,
  WEB_SEARCH_TOOL,
  ADVISOR_OUTPUT_CONFIG,
  buildAskSystemPrompt,
  buildAskMessages,
  buildGuestPersonaSystemPrompt,
  buildQuorumSystemPrompt,
  buildReviewSystemPrompt,
  buildSynthesisSystemPrompt,
} = require('./lib/prompts');
const { requireAuth } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ADVISORS_FILE = path.join(__dirname, 'advisors.json');
const READING_FILE = path.join(__dirname, 'reading.json');

app.use(express.json({ limit: '20mb' })); // larger limit for base64 photo uploads
app.use(express.static(path.join(__dirname, 'public')));

// Access-code gate on every API route (no-op unless BOARD_ACCESS_CODE is set)
app.use('/api', (req, res, next) => {
  if (requireAuth(req, res)) next();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function readAdvisors() {
  return JSON.parse(fs.readFileSync(ADVISORS_FILE, 'utf8'));
}

function writeAdvisors(data) {
  fs.writeFileSync(ADVISORS_FILE, JSON.stringify(data, null, 2));
}

function startTextStream(res) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();
}

async function pipeTextDeltas(stream, res) {
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      res.write(event.delta.text);
    }
  }
  res.end();
}

function streamError(res, err, label) {
  console.error(`${label}:`, err.message);
  if (!res.headersSent) {
    res.status(500).json({ error: err.message });
  } else {
    res.write(`\n\n[Error: ${err.message}]`);
    res.end();
  }
}

// ── Advisor CRUD ─────────────────────────────────────────────────────────────

app.get('/api/advisors', (req, res) => {
  res.json(readAdvisors());
});

app.put('/api/advisors', (req, res) => {
  writeAdvisors(req.body);
  res.json({ success: true });
});

// ── Reading Room feed ────────────────────────────────────────────────────────

app.get('/api/reading', (req, res) => {
  try {
    res.json(JSON.parse(fs.readFileSync(READING_FILE, 'utf8')));
  } catch {
    res.json({ updatedAt: null, items: [] });
  }
});

// ── Ask (streaming) — first ask, follow-ups, and Round 2 rebuttals ──────────

app.post('/api/ask', async (req, res) => {
  const { question, advisorId, userProfile, history, thread, rebuttal, guest } = req.body;
  if ((!question && !rebuttal) || !advisorId) {
    return res.status(400).json({ error: 'advisorId plus question or rebuttal are required' });
  }

  const advisors = readAdvisors();
  // A guest advisor exists only for this session: the client carries its persona.
  const advisor = (guest && guest.persona && guest.name)
    ? { ...guest, id: advisorId }
    : advisors.find(a => a.id === advisorId);
  if (!advisor) {
    return res.status(404).json({ error: 'Advisor not found' });
  }

  const systemPrompt = buildAskSystemPrompt(advisor, advisors, userProfile, history);
  const messages = buildAskMessages({ question, thread, rebuttal });

  startTextStream(res);
  try {
    const stream = client.messages.stream({
      model: advisor.model || DEFAULT_MODEL,
      max_tokens: 4000,
      output_config: ADVISOR_OUTPUT_CONFIG,
      system: systemPrompt,
      messages,
      tools: [WEB_SEARCH_TOOL],
    });
    await pipeTextDeltas(stream, res);
  } catch (err) {
    streamError(res, err, 'Claude API error');
  }
});

// ── Guest seat — generate a one-session guest advisor ───────────────────────

app.post('/api/guest', async (req, res) => {
  const { description } = req.body;
  if (!description || !String(description).trim()) {
    return res.status(400).json({ error: 'description is required' });
  }
  try {
    const msg = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 8000,
      system: buildGuestPersonaSystemPrompt(),
      messages: [{ role: 'user', content: `The board owner needs this guest for one question:\n"${String(description).trim()}"` }],
      tools: [WEB_SEARCH_TOOL],
    });
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const jsonText = text.replace(/^[\s\S]*?\{/, '{').replace(/\}[^}]*$/, '}');
    const g = JSON.parse(jsonText);
    if (!g.name || !g.persona) throw new Error('Guest generation returned an incomplete persona');
    res.json({
      id: 'guest_' + Date.now(),
      name: g.name,
      title: g.title || 'Guest advisor',
      avatar: (g.avatar || g.name.slice(0, 2)).slice(0, 2).toUpperCase(),
      color: '#5C594A',
      expertise: Array.isArray(g.expertise) ? g.expertise : [],
      persona: g.persona,
      active: true,
      isGuest: true,
    });
  } catch (err) {
    console.error('Guest error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Quorum — the Chair picks the bench for this question ────────────────────

app.post('/api/quorum', async (req, res) => {
  const { question, roster } = req.body;
  if (!question || !Array.isArray(roster) || roster.length < 2) {
    return res.status(400).json({ error: 'question and roster are required' });
  }
  const rosterLines = roster
    .map(a => `${a.id} | ${a.name} | ${a.title} | ${(a.expertise || []).join(', ')}`)
    .join('\n');
  try {
    const msg = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 8000,
      system: buildQuorumSystemPrompt(),
      messages: [
        { role: 'user', content: `Question:\n"${question}"\n\nRoster (id | name | title | expertise):\n${rosterLines}` },
      ],
    });
    const text = msg.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(jsonText);
    const validIds = new Set(roster.map(a => a.id));
    const ids = (parsed.ids || []).filter(id => validIds.has(id));
    if (!ids.length) throw new Error('Quorum returned no valid ids');
    res.json({ ids, note: parsed.note || '' });
  } catch (err) {
    console.error('Quorum error:', err.message);
    // Fail open: the frontend falls back to the full selection
    res.status(500).json({ error: err.message });
  }
});

// ── Text-to-speech (ElevenLabs) ──────────────────────────────────────────────

app.post('/api/tts', async (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return res.status(503).json({ error: 'Voices not enabled: add ELEVENLABS_API_KEY to .env and restart.' });
  }
  const { advisorId, text, voiceId } = req.body;
  if ((!advisorId && !voiceId) || !text) {
    return res.status(400).json({ error: 'advisorId (or voiceId) and text are required' });
  }
  // Explicit voiceId (voice audition in Edit Board) beats the advisor's saved one
  const advisor = advisorId ? readAdvisors().find(a => a.id === advisorId) : null;
  const useVoice = voiceId || (advisor && advisor.voiceId);
  if (!useVoice) {
    return res.status(404).json({ error: 'Advisor has no voiceId configured' });
  }
  try {
    const r = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${useVoice}/stream?output_format=mp3_44100_128`,
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

// ── Board Synthesis (Round 1 verdict and Round 2 final verdict) ─────────────

app.post('/api/synthesize', async (req, res) => {
  const { question, responses, userProfile, round, round1Tally } = req.body;
  if (!question || !responses || !responses.length) {
    return res.status(400).json({ error: 'question and responses are required' });
  }

  startTextStream(res);

  const advisorInputs = responses
    .map(
      (r) =>
        `### ${r.name} (${r.title})\nExpertise: ${(r.expertise || []).join(', ')}\n\nResponse:\n${r.text}`
    )
    .join('\n\n---\n\n');

  const roundPreamble = round === 2
    ? `Round 1 ballot (before the debate): ${round1Tally || 'no formal votes'}\n\nRound 2 responses (after open debate):\n\n`
    : 'Individual responses:\n\n';

  try {
    const stream = client.messages.stream({
      model: DEFAULT_MODEL,
      max_tokens: 3000,
      system: buildSynthesisSystemPrompt(userProfile, { round: round === 2 ? 2 : 1 }),
      messages: [
        {
          role: 'user',
          content: `Question posed to the board:\n"${question}"\n\n${roundPreamble}${advisorInputs}`,
        },
      ],
    });
    await pipeTextDeltas(stream, res);
  } catch (err) {
    streamError(res, err, 'Synthesis error');
  }
});

// ── Board Review — the Chair audits past decisions ──────────────────────────

app.post('/api/review', async (req, res) => {
  const { sessions, userProfile } = req.body;
  if (!Array.isArray(sessions) || !sessions.length) {
    return res.status(400).json({ error: 'sessions are required' });
  }

  const sessionBlocks = sessions
    .map((s, i) => {
      const outcome = s.outcome
        ? `Outcome recorded by the owner: [${s.outcome.label}] ${s.outcome.note || ''}`
        : 'No outcome recorded.';
      return `SESSION ${i + 1} (${s.date})\nQuestion: "${s.question}"\nBallot: ${s.ballot || 'no formal votes'}\nVerdict excerpt: ${s.verdict || '(none)'}\n${outcome}`;
    })
    .join('\n\n---\n\n');

  startTextStream(res);
  try {
    const stream = client.messages.stream({
      model: DEFAULT_MODEL,
      max_tokens: 4000,
      system: buildReviewSystemPrompt(userProfile),
      messages: [{ role: 'user', content: `Past sessions to review:\n\n${sessionBlocks}` }],
    });
    await pipeTextDeltas(stream, res);
  } catch (err) {
    streamError(res, err, 'Review error');
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
