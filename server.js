require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.MODEL || 'claude-opus-4-6';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ADVISORS_FILE = path.join(__dirname, 'advisors.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Advisor CRUD ──────────────────────────────────────────────────────────────

function readAdvisors() {
  return JSON.parse(fs.readFileSync(ADVISORS_FILE, 'utf8'));
}

function writeAdvisors(data) {
  fs.writeFileSync(ADVISORS_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/advisors', (req, res) => {
  res.json(readAdvisors());
});

// Save full advisor list (used by edit UI)
app.put('/api/advisors', (req, res) => {
  writeAdvisors(req.body);
  res.json({ success: true });
});

// ── Ask (streaming) ───────────────────────────────────────────────────────────

app.post('/api/ask', async (req, res) => {
  const { question, advisorId } = req.body;
  if (!question || !advisorId) {
    return res.status(400).json({ error: 'question and advisorId are required' });
  }

  const advisors = readAdvisors();
  const advisor = advisors.find(a => a.id === advisorId);
  if (!advisor) {
    return res.status(404).json({ error: 'Advisor not found' });
  }

  // Build board context so each advisor knows their fellow members
  const boardContext = advisors
    .filter(a => a.active)
    .map(a => `- ${a.name} — ${a.title}${a.id === advisorId ? ' (this is you)' : ''}`)
    .join('\n');

  const systemPrompt = `${advisor.persona}\n\nIMPORTANT CONTEXT — You sit on a Personal Advisory Board alongside these members:\n${boardContext}\n\nYou know who your fellow board members are, their backgrounds, and how they think. If asked about the board or its members, answer accurately based on this list.`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 1200,
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
  const { question, responses } = req.body;
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

  const systemPrompt = `You are the Chair of a Personal Advisory Board. You have just heard each board member's individual perspective on a question. Your role is to produce a weighted Board Recommendation that synthesizes their collective wisdom.

PROCESS:
1. Analyze the question's domain(s) and determine which advisors have the deepest expertise for this specific question.
2. Assign each advisor a relevance weight: HIGH (core domain), MEDIUM (adjacent expertise), or LOW (outside primary domain). Use each advisor's expertise areas and the nature of the question to make this judgment.
3. For the Stanford SEP Faculty advisor (if present), identify the 1-2 specific professors most relevant. The SEP 2025-2026 faculty includes: Ken Shotts (Ethics & Values), Jesper Sorensen (Strategy), Frank Flynn (Leadership & Communication), Charles O'Reilly (Innovation), Bill Barnett (Competitive Organizations), Rob Reich (AI & Society), Amit Seru (Finance), Baba Shiv (Neuroscience & Leadership), Michele Gelfand (Culture), Maggie Neale (Negotiation), Amir Goldberg (AI Organizations), Yossi Feinberg (Game Theory), Hau Lee (Supply Chain). Name the professor(s), explain which framework or class topic applies, and reference how they would approach this issue.
4. Synthesize a Board Recommendation that:
   - Weighs HIGH-relevance perspectives most heavily in the final recommendation
   - Leads with the strongest, most actionable insight
   - Identifies where the board converges (consensus) and diverges (genuine tension)
   - Resolves tensions with a clear recommendation and explicit reasoning
   - Is concrete and actionable — no hedging

FORMAT:
**Advisor Relevance**
- [Name]: [HIGH/MEDIUM/LOW] — [one-line reason]

**SEP Faculty Spotlight:** [Professor Name(s)] — [why their lens matters here, which framework or class topic applies]

---

**Board Recommendation**
[Synthesized recommendation, 3-5 paragraphs. Weight HIGH advisors' views more heavily. Lead with the key insight. Be direct.]`;

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
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
