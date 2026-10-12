const fs = require('fs');
const path = require('path');
const { DEFAULT_MODEL, buildBriefSystemPrompt, buildBriefRosterLines, buildBriefOwnerLine } = require('../lib/prompts');
const { requireAuth } = require('../lib/auth');
const { callAnthropicText } = require('../lib/stream-proxy');

const ADVISORS_FILE = path.join(process.cwd(), 'advisors.json');

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAuth(req, res)) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { question, ids, guest, userProfile } = req.body;
  if (!question || !Array.isArray(ids) || ids.length < 2) {
    return res.status(400).json({ error: 'question and ids are required' });
  }

  const advisors = JSON.parse(fs.readFileSync(ADVISORS_FILE, 'utf8'));
  const rosterLines = buildBriefRosterLines(advisors, ids, guest);

  try {
    const text = await callAnthropicText({
      apiKey,
      body: {
        model: DEFAULT_MODEL,
        max_tokens: 6000,
        system: buildBriefSystemPrompt(),
        messages: [{ role: 'user', content: `${buildBriefOwnerLine(userProfile)}\n\nQuestion from the owner:\n"${question}"\n\nThe bench:\n${rosterLines}` }],
      },
    });
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(jsonText);
    const mode = parsed.mode === 'task' ? 'task' : 'decision';
    const briefs = {};
    if (mode === 'task' && parsed.briefs && typeof parsed.briefs === 'object') {
      for (const id of ids) if (typeof parsed.briefs[id] === 'string' && parsed.briefs[id].trim()) briefs[id] = parsed.briefs[id].trim();
    }
    res.json({ mode, note: parsed.note || '', briefs });
  } catch (err) {
    console.error('Clerk error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
