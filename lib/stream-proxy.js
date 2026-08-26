// Shared Anthropic streaming proxy for the Vercel functions (api/*.js).
// server.js uses the SDK instead; these functions use raw fetch to keep the
// serverless bundle light. Streams text deltas straight through as plain text.

async function streamAnthropicToRes({ apiKey, body, res }) {
  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ ...body, stream: true }),
  });

  if (!apiRes.ok) {
    const err = await apiRes.text();
    res.status(apiRes.status).json({ error: err });
    return;
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
        if (event.type === 'message_start' && event.message?.usage) {
          const u = event.message.usage;
          console.log(`[cache] read=${u.cache_read_input_tokens || 0} write=${u.cache_creation_input_tokens || 0} in=${u.input_tokens || 0}`);
        }
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          res.write(event.delta.text);
        }
      } catch {}
    }
  }
  res.end();
}

// Non-streaming call; returns the concatenated text of the response.
async function callAnthropicText({ apiKey, body }) {
  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!apiRes.ok) {
    throw new Error(await apiRes.text());
  }
  const msg = await apiRes.json();
  return (msg.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
}

module.exports = { streamAnthropicToRes, callAnthropicText };
