const { DEFAULT_MODEL, WEB_SEARCH_TOOL, buildGuestPersonaSystemPrompt } = require('../lib/prompts');
const { requireAuth } = require('../lib/auth');

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!requireAuth(req, res)) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { description } = req.body;
  if (!description || !String(description).trim()) {
    return res.status(400).json({ error: 'description is required' });
  }

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 8000,
        system: buildGuestPersonaSystemPrompt(),
        messages: [{ role: 'user', content: `The board owner needs this guest for one question:\n"${String(description).trim()}"` }],
        tools: [WEB_SEARCH_TOOL],
      }),
    });
    if (!apiRes.ok) throw new Error(await apiRes.text());
    const msg = await apiRes.json();
    const text = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const jsonText = text.replace(/^[\s\S]*?\{/, '{').replace(/\}[^}]*$/, '}');
    const g = JSON.parse(jsonText);
    if (!g.name || !g.persona) throw new Error('Guest generation returned an incomplete persona');
    res.json({
      id: 'guest_' + Date.now(),
      name: g.name,
      title: g.title || 'Guest advisor',
      avatar: (g.avatar || g.name.slice(0, 2)).slice(0, 2).toUpperCase(),
      color: '#5C594A',
      expertise: Array.isArray(g.expertise) ? g.expertise : [],
      persona: g.persona,
      active: true,
      isGuest: true,
    });
  } catch (err) {
    console.error('Guest error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
