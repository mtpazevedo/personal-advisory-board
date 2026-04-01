const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.MODEL || 'claude-opus-4-6';
const ADVISORS_FILE = path.join(process.cwd(), 'advisors.json');

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { question, advisorId } = req.body;
  if (!question || !advisorId) {
    return res.status(400).json({ error: 'question and advisorId are required' });
  }

  const advisors = JSON.parse(fs.readFileSync(ADVISORS_FILE, 'utf8'));
  const advisor = advisors.find(a => a.id === advisorId);
  if (!advisor) {
    return res.status(404).json({ error: 'Advisor not found' });
  }

  const boardContext = advisors
    .filter(a => a.active)
    .map(a => `- ${a.name} — ${a.title}${a.id === advisorId ? ' (this is you)' : ''}`)
    .join('\n');

  const systemPrompt = `${advisor.persona}\n\nIMPORTANT CONTEXT — You sit on a Personal Advisory Board alongside these members:\n${boardContext}\n\nYou know who your fellow board members are, their backgrounds, and how they think. If asked about the board or its members, answer accurately based on this list.`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: question }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
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
}

module.exports = handler;
module.exports.config = { supportsResponseStreaming: true };
