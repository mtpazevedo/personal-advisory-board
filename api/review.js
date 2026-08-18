const { DEFAULT_MODEL, buildReviewSystemPrompt } = require('../lib/prompts');
const { requireAuth } = require('../lib/auth');
const { streamAnthropicToRes } = require('../lib/stream-proxy');

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAuth(req, res)) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

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

  try {
    await streamAnthropicToRes({
      apiKey,
      res,
      body: {
        model: DEFAULT_MODEL,
        max_tokens: 4000,
        system: buildReviewSystemPrompt(userProfile),
        messages: [{ role: 'user', content: `Past sessions to review:\n\n${sessionBlocks}` }],
      },
    });
  } catch (err) {
    console.error('Review error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`\n\n[Error: ${err.message}]`);
      res.end();
    }
  }
}

module.exports = handler;
module.exports.config = { supportsResponseStreaming: true };
