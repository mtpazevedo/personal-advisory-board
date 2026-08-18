const { DEFAULT_MODEL, buildQuorumSystemPrompt } = require('../lib/prompts');
const { requireAuth } = require('../lib/auth');
const { callAnthropicText } = require('../lib/stream-proxy');

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAuth(req, res)) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { question, roster } = req.body;
  if (!question || !Array.isArray(roster) || roster.length < 2) {
    return res.status(400).json({ error: 'question and roster are required' });
  }

  const rosterLines = roster
    .map(a => `${a.id} | ${a.name} | ${a.title} | ${(a.expertise || []).join(', ')}`)
    .join('\n');

  try {
    const text = await callAnthropicText({
      apiKey,
      body: {
        model: DEFAULT_MODEL,
        max_tokens: 8000,
        system: buildQuorumSystemPrompt(),
        messages: [
          { role: 'user', content: `Question:\n"${question}"\n\nRoster (id | name | title | expertise):\n${rosterLines}` },
        ],
      },
    });
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(jsonText);
    const validIds = new Set(roster.map(a => a.id));
    const ids = (parsed.ids || []).filter(id => validIds.has(id));
    if (!ids.length) throw new Error('Quorum returned no valid ids');
    res.json({ ids, note: parsed.note || '' });
  } catch (err) {
    console.error('Quorum error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
