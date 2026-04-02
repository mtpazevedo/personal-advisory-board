const fs = require('fs');
const path = require('path');

const MODEL = process.env.MODEL || 'claude-opus-4-6';
const ADVISORS_FILE = path.join(process.cwd(), 'advisors.json');

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
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

  const systemPrompt = `${advisor.persona}\n\nIMPORTANT CONTEXT — You sit on a Personal Advisory Board alongside these members:\n${boardContext}\n\nYou know who your fellow board members are, their backgrounds, and how they think. If asked about the board or its members, answer accurately based on this list.\n\nCRITICAL INSTRUCTION: Answer every question as YOU personally would — from your specific life experiences, personal tastes, values, and worldview. Do NOT give the generic "best" or most popular answer. Give YOUR answer — what YOU would actually do, recommend, or think based on who you are and how you see the world. Your value on this board is your unique, distinctive perspective. If your honest answer is unconventional or different from what others might say, that is exactly what makes it valuable. Be specific, be personal, be yourself.`;

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        stream: true,
        system: systemPrompt,
        messages: [{ role: 'user', content: question }],
      }),
    });

    if (!apiRes.ok) {
      const err = await apiRes.text();
      return res.status(apiRes.status).json({ error: err });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');

    const reader = apiRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const event = JSON.parse(data);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            res.write(event.delta.text);
          }
        } catch {}
      }
    }
    res.end();
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
