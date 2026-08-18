const { DEFAULT_MODEL, buildSynthesisSystemPrompt } = require('../lib/prompts');
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

  const { question, responses, userProfile, round, round1Tally } = req.body;
  if (!question || !responses || !responses.length) {
    return res.status(400).json({ error: 'question and responses are required' });
  }

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
    await streamAnthropicToRes({
      apiKey,
      res,
      body: {
        model: DEFAULT_MODEL,
        max_tokens: 3000,
        system: buildSynthesisSystemPrompt(userProfile, { round: round === 2 ? 2 : 1 }),
        messages: [
          {
            role: 'user',
            content: `Question posed to the board:\n"${question}"\n\n${roundPreamble}${advisorInputs}`,
          },
        ],
      },
    });
  } catch (err) {
    console.error('Synthesis error:', err);
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
