function buildUserProfileBlock(profile) {
  if (!profile || typeof profile !== 'object') return '';
  const fields = [
    ['Name', profile.name],
    ['Pronouns', profile.pronouns],
    ['Age / life stage', profile.lifeStage],
    ['Location', profile.location],
    ['Profession / role', profile.profession],
    ['Industry', profile.industry],
    ['Top values', profile.values],
    ['Strengths', profile.strengths],
    ['Weaknesses / blind spots', profile.weaknesses],
    ['Daily habits / routines', profile.habits],
    ['Top concerns right now', profile.topConcerns],
    ['Current goals (next 3-12 months)', profile.goals],
    ['Current challenges', profile.challenges],
    ['Past mistakes / lessons learned', profile.pastMistakes],
    ['What they want from this board', profile.boardPurpose],
    ['Notes the board should remember', profile.boardNotes],
    ['Personal context', profile.personalContext],
  ].filter(([, v]) => v && String(v).trim());

  if (!fields.length) return '';
  const body = fields.map(([k, v]) => `- ${k}: ${String(v).trim()}`).join('\n');
  return `\n\n--- WHO YOU ARE ADVISING ---\n${body}\n\nSpeak to this specific person. Reference their goals, challenges, known blind spots, and standing notes where relevant. If a flagged weakness or past mistake bears on the question, address it directly.`;
}

const MODEL = process.env.MODEL || 'claude-opus-4-6';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { question, responses, userProfile } = req.body;
  if (!question || !responses || !responses.length) {
    return res.status(400).json({ error: 'question and responses are required' });
  }

  const advisorInputs = responses
    .map(
      (r) =>
        `### ${r.name} (${r.title})\nExpertise: ${(r.expertise || []).join(', ')}\n\nResponse:\n${r.text}`
    )
    .join('\n\n---\n\n');

  const profileBlock = buildUserProfileBlock(userProfile);

  const SYSTEM_PROMPT = `You are the Chair of a Personal Advisory Board. Each board member has just given their individual perspective on a question. Your job is to produce a weighted Board Verdict — the collective recommendation, with explicit weights showing whose voice counts most on THIS specific question.

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
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        stream: true,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Question posed to the board:\n"${question}"\n\nIndividual responses:\n\n${advisorInputs}`,
          },
        ],
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
