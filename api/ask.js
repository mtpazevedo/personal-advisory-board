const fs = require('fs');
const path = require('path');
const { DEFAULT_MODEL, WEB_SEARCH_TOOL, ADVISOR_OUTPUT_CONFIG, buildAskSystemPrompt, buildAskMessages, buildChatSystemPrompt } = require('../lib/prompts');
const { requireAuth } = require('../lib/auth');
const { streamAnthropicToRes } = require('../lib/stream-proxy');

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

  const { question, advisorId, userProfile, history, thread, rebuttal, guest, mode } = req.body;
  if ((!question && !rebuttal) || !advisorId) {
    return res.status(400).json({ error: 'advisorId plus question or rebuttal are required' });
  }

  const advisors = JSON.parse(fs.readFileSync(ADVISORS_FILE, 'utf8'));
  // A guest advisor exists only for this session: the client carries its persona.
  const advisor = (guest && guest.persona && guest.name)
    ? { ...guest, id: advisorId }
    : advisors.find(a => a.id === advisorId);
  if (!advisor) {
    return res.status(404).json({ error: 'Advisor not found' });
  }

  try {
    await streamAnthropicToRes({
      apiKey,
      res,
      body: {
        model: advisor.model || DEFAULT_MODEL,
        max_tokens: mode === 'chat' ? 2000 : 4000,
        output_config: ADVISOR_OUTPUT_CONFIG,
        system: mode === 'chat'
          ? buildChatSystemPrompt(advisor, userProfile)
          : buildAskSystemPrompt(advisor, advisors, userProfile, history),
        messages: buildAskMessages({ question, thread, rebuttal }),
        tools: [WEB_SEARCH_TOOL],
      },
    });
  } catch (err) {
    console.error('Claude API error:', err);
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
