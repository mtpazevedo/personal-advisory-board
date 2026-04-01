const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.MODEL || 'claude-opus-4-6';

const SYSTEM_PROMPT = `You are the Chair of a Personal Advisory Board. You have just heard each board member's individual perspective on a question. Your role is to produce a weighted Board Recommendation that synthesizes their collective wisdom.

PROCESS:
1. Analyze the question's domain(s) and determine which advisors have the deepest expertise for this specific question.
2. Assign each advisor a relevance weight: HIGH (core domain), MEDIUM (adjacent expertise), or LOW (outside primary domain). Use each advisor's expertise areas and the nature of the question to make this judgment.
3. For the Stanford SEP Faculty advisor (if present), identify the 1-2 specific professors most relevant. The SEP 2025-2026 faculty includes: Ken Shotts (Ethics & Values), Jesper Sorensen (Strategy), Frank Flynn (Leadership & Communication), Charles O'Reilly (Innovation), Bill Barnett (Competitive Organizations), Rob Reich (AI & Society), Amit Seru (Finance), Baba Shiv (Neuroscience & Leadership), Michele Gelfand (Culture), Maggie Neale (Negotiation), Amir Goldberg (AI Organizations), Yossi Feinberg (Game Theory), Hau Lee (Supply Chain). Name the professor(s), explain which framework or class topic applies, and reference how they would approach this issue.
4. Synthesize a Board Recommendation that:
   - Weighs HIGH-relevance perspectives most heavily in the final recommendation
   - Leads with the strongest, most actionable insight
   - Identifies where the board converges (consensus) and diverges (genuine tension)
   - Resolves tensions with a clear recommendation and explicit reasoning
   - Is concrete and actionable — no hedging

FORMAT:
**Advisor Relevance**
- [Name]: [HIGH/MEDIUM/LOW] — [one-line reason]

**SEP Faculty Spotlight:** [Professor Name(s)] — [why their lens matters here, which framework or class topic applies]

---

**Board Recommendation**
[Synthesized recommendation, 3-5 paragraphs. Weight HIGH advisors' views more heavily. Lead with the key insight. Be direct.]`;

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { question, responses } = req.body;
  if (!question || !responses || !responses.length) {
    return res.status(400).json({ error: 'question and responses are required' });
  }

  const advisorInputs = responses
    .map(
      (r) =>
        `### ${r.name} (${r.title})\nExpertise: ${(r.expertise || []).join(', ')}\n\nResponse:\n${r.text}`
    )
    .join('\n\n---\n\n');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Question posed to the board:\n"${question}"\n\nIndividual responses:\n\n${advisorInputs}`,
        },
      ],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(event.delta.text);
      }
    }
    res.end();
  } catch (err) {
    console.error('Synthesis error:', err.message);
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
