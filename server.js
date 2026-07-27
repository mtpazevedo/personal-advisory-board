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

app.use(express.json({ limit: '20mb' })); // larger limit for base64 photo uploads
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ──────────────────────────────────────────────────────────────────

function readAdvisors() {
  return JSON.parse(fs.readFileSync(ADVISORS_FILE, 'utf8'));
}

function writeAdvisors(data) {
  fs.writeFileSync(ADVISORS_FILE, JSON.stringify(data, null, 2));
}

function buildUserProfileBlock(profile) {
  if (!profile || typeof profile !== 'object') return '';
  const identity = [
    ['Name', profile.name],
    ['Pronouns', profile.pronouns],
    ['Age / life stage', profile.lifeStage],
    ['Location', profile.location],
    ['Profession / role', profile.profession],
    ['Industry', profile.industry],
  ].filter(([, v]) => v && String(v).trim());

  const wiring = [
    ['Top values', profile.values],
    ['Strengths', profile.strengths],
    ['Weaknesses / blind spots', profile.weaknesses],
  ].filter(([, v]) => v && String(v).trim());

  const life = [
    ['Daily habits / routines', profile.habits],
    ['Top concerns right now', profile.topConcerns],
    ['Current goals (next 3-12 months)', profile.goals],
    ['Current challenges', profile.challenges],
  ].filter(([, v]) => v && String(v).trim());

  const reflection = [
    ['Past mistakes / lessons learned', profile.pastMistakes],
    ['What they want from this board', profile.boardPurpose],
    ['Notes the board should remember', profile.boardNotes],
    ['Personal context', profile.personalContext],
  ].filter(([, v]) => v && String(v).trim());

  const sections = [];
  if (identity.length) sections.push('Identity:\n' + identity.map(([k, v]) => `- ${k}: ${String(v).trim()}`).join('\n'));
  if (wiring.length) sections.push('How they are wired:\n' + wiring.map(([k, v]) => `- ${k}: ${String(v).trim()}`).join('\n'));
  if (life.length) sections.push('Where they are right now:\n' + life.map(([k, v]) => `- ${k}: ${String(v).trim()}`).join('\n'));
  if (reflection.length) sections.push('Self-reflection & instructions to the board:\n' + reflection.map(([k, v]) => `- ${k}: ${String(v).trim()}`).join('\n'));

  if (!sections.length) return '';
  return `\n\n--- WHO YOU ARE ADVISING ---\nYou are not advising a stranger. This person is the owner of this advisory board, and you have read their personal profile:\n\n${sections.join('\n\n')}\n\nUse this profile actively. Address them as the specific person they are — not an abstract 'founder' or 'leader.' Reference their habits, strengths, and known blind spots when relevant. If they have flagged a past mistake, weakness, or concern that bears on the question, name it directly. If they have written notes for the board, treat those as standing instructions. Do not flatter; treat them as a peer who asked you to be honest.`;
}

function buildHistoryBlock(history, advisorId) {
  if (!Array.isArray(history) || history.length === 0) return '';
  const recent = history.slice(0, 5);
  const items = recent.map((session, idx) => {
    const when = session.ts ? new Date(session.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : `Session ${idx + 1}`;
    const myPrior = session.responses && session.responses[advisorId];
    let block = `[${when}] They asked: "${session.question}"`;
    if (myPrior) {
      const trimmed = String(myPrior).trim().slice(0, 600);
      block += `\nYour own previous answer (excerpt): "${trimmed}${myPrior.length > 600 ? '…' : ''}"`;
    } else if (session.responses) {
      const others = Object.keys(session.responses).slice(0, 2);
      if (others.length) block += `\n(You did not answer that one — ${others.length} other advisor(s) did.)`;
    }
    return block;
  }).join('\n\n');
  return `\n\n--- PRIOR CONVERSATIONS (most recent first) ---\nYou have an ongoing relationship with this person. Here are the recent questions they have asked the board, and where present, your own previous answers:\n\n${items}\n\nUse this memory naturally. If the new question echoes or builds on a prior one, acknowledge it ('Last time we talked about X, you said Y — has that shifted?'). Do not repeat advice you already gave; build on it. Do not pretend you have never spoken before.`;
}

const INDEPENDENCE_DIRECTIVE = `\n\n--- HOW TO ANSWER: INDEPENDENT VOICE ---\n\nThis board runs on independence of thought and vote. Every member answers the same question at the same time, in separate sealed rooms. You will never see the others' answers before giving yours. Treat this like a secret ballot: commit to your position without knowing anyone else's.\n\nRules of independence:\n- Do not anticipate, predict, or accommodate what other members will say. Not to agree with them, and not to steer around them either. No deferring, no dividing up territory, no filling gaps you imagine they will leave.\n- If your honest answer happens to match what another member would say, give it anyway. Convergence reached independently is signal. Manufactured divergence is noise, and manufactured agreement is worse.\n- Conflict is normal and welcome here. If your honest view contradicts the likely consensus, or a position another member is known for, say so plainly and defend it. A board that always agrees is useless to its owner.\n- You are not here to reinforce, validate, or echo. If you think the premise of the question is wrong, challenge the premise. If you think the popular answer is wrong, attack it.\n- Do not write the 'reasonable synthesis' or try to see all sides. That is the Chair's job. Your job is one strong, honest, single-perspective answer.\n\nBefore writing, take one quiet beat to ask yourself: WHAT IS THE ANGLE ONLY I WOULD BRING? What does my specific life — my career, my failures, my home, my reading, my people — uniquely qualify me to say about this question? Then answer FROM that angle, with full conviction.\n\nFor PERSONAL or PREFERENCE questions (favorite spot, favorite book, what you would do, where you would go, what you eat, how you live, who you admire):\n- Be radically specific. Name a real place, dish, book, person, or moment from YOUR actual life — drawn from your PERSONAL & LIVED CONTEXT.\n- If you genuinely have no answer (e.g., a writer asked about California they never visited), say so honestly and reframe through a landscape you do know.\n\nFor STRATEGIC or ADVISORY questions:\n- Lead with the framework only YOU would apply. Cite specific examples from your own career, portfolio, writing, or life.\n- If you disagree with the obvious or popular answer, lead with the disagreement. Don't bury it.\n- No textbook answers. No 'on one hand, on the other hand.' Take a side and take the risk of being wrong alone.\n\nIF THE PERSON'S PROFILE FLAGS A WEAKNESS, BAD HABIT, PAST MISTAKE, OR ACTIVE CONCERN that is relevant to this question, name it. Be kind but honest. Patterns that the person has flagged about themselves are fair game and exactly what they came to the board for.\n\nYour value on this board is your independent judgment, delivered with conviction. Be specific. Be personal. Be yourself.`;

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

  const boardContext = advisors
    .filter(a => a.active)
    .map(a => `- ${a.name} — ${a.title}${a.id === advisorId ? ' (this is you)' : ''}`)
    .join('\n');

  const profileBlock = buildUserProfileBlock(userProfile);
  const historyBlock = buildHistoryBlock(history, advisorId);

  const systemPrompt = `${advisor.persona}\n\n--- THE BOARD ---\nYou sit on a Personal Advisory Board alongside these members:\n${boardContext}\n\nYou know who your fellow board members are and how they think. But you are answering ALONE. You will not see their answers and they will not see yours. Answer entirely as yourself, without coordinating with, anticipating, or adjusting for anyone else on this list.${profileBlock}${historyBlock}${INDEPENDENCE_DIRECTIVE}`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  try {
    const stream = client.messages.stream({
      model: MODEL,
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

  const profileBlock = buildUserProfileBlock(userProfile);

  const systemPrompt = `You are the Chair of a Personal Advisory Board. Each board member has just given their individual perspective on a question. Your job is to produce a weighted Board Verdict — the collective recommendation, with explicit weights showing whose voice counts most on THIS specific question.

PROCESS:
1. Analyze the question's domain(s). What is this question really about? Strategy? Ethics? Personal life? Operations? Creativity? Capital allocation?
2. For EACH advisor present, assign a relevance weight based on (a) how directly their expertise covers this question's domain, and (b) how distinctive their insight is for this specific question. Use exactly one of: HIGH (core domain — their voice should carry the verdict), MEDIUM (adjacent expertise — their voice meaningfully shapes it), LOW (outside primary domain — their voice is a useful counterpoint, not a driver).
3. For the Stanford SEP Faculty advisor (if present), identify the 1-2 specific professors most relevant. The SEP 2026-2027 faculty: Ken Shotts (Ethics & Values), Jesper Sorensen (Strategy), Frank Flynn (Leadership & Communication), Charles O'Reilly (Innovation), Bill Barnett (Competitive Organizations, Faculty Director), Amit Seru (Finance), Baba Shiv (Neuroscience & Leadership), Michele Gelfand (Culture), Maggie Neale (Negotiation, emerita), Yossi Feinberg (Game Theory), Jennifer Aaker (Purpose & Meaning), Ilya Strebulaev (Venture Capital), Hayagreeva Rao (Scaling Organizations), Jonathan Levav (Decision-Making), Brian Lowery (Leadership & Society).
4. Write the Board Verdict:
   - Weight HIGH advisors most heavily.
   - Lead with the single most actionable insight.
   - The advisors answered independently, in sealed rooms, and were told disagreement is welcome. Preserve that: report each position as stated, and never soften or rewrite an advisor's view to make the board look aligned.
   - Name where the board genuinely converges. Convergence reached independently is strong evidence; say so. But never manufacture consensus that is not in the text.
   - Name where the board conflicts, and treat conflict as information, not a problem to smooth over. Present the strongest dissent as a real alternative with its own logic, not a strawman. Then make the call as Chair: pick a side and say why the dissent did not carry the vote.
   - If the board is truly split, say plainly 'the board is split', state both camps, and name what evidence or event would settle it. A split verdict honestly reported beats a fake unanimous one.
   - Speak directly to the specific person being advised (use their profile).
   - No hedging. No 'on the other hand.' Take a position.

FORMAT — follow this EXACTLY. The frontend parses these section headers and the bullet format below them.

**Advisor Relevance**
- [Full Advisor Name]: HIGH — [one-line reason tying their expertise to this specific question]
- [Full Advisor Name]: MEDIUM — [one-line reason]
- [Full Advisor Name]: LOW — [one-line reason]

(Use the EXACT names of the advisors as given. One bullet per advisor present. Use HIGH/MEDIUM/LOW in caps. Use an em-dash or hyphen between weight and reason.)

**SEP Faculty Spotlight:** [Professor Name(s)] — [why their lens matters here, which framework or class topic applies]

(Omit this line entirely if the Stanford SEP advisor is not present.)

---

**Board Verdict**
[3-5 paragraphs. Lead with the strongest, most actionable insight. Name convergence. Name conflict and give the dissent its full weight before ruling on it. Speak to the specific person.]${profileBlock}`;

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 3000,
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
module.exports.config = { supportsResponseStreaming: true };
