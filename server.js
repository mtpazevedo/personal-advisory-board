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
