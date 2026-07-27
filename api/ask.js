const fs = require('fs');
const path = require('path');

const MODEL = process.env.MODEL || 'claude-opus-4-6';
const ADVISORS_FILE = path.join(process.cwd(), 'advisors.json');

function buildUserProfileBlock(profile) {
  if (!profile || typeof profile !== 'object') return '';
  const identity = [
    ['Name', profile.name],
    ['Pronouns', profile.pronouns],
    ['Age / life stage', profile.lifeStage],
    ['Location', profile.location],
    ['Profession / role', profile.profession],
    ['Industry', profile.industry],
  ].filter(([, v]) => v && String(v).trim());

  const wiring = [
    ['Top values', profile.values],
    ['Strengths', profile.strengths],
    ['Weaknesses / blind spots', profile.weaknesses],
  ].filter(([, v]) => v && String(v).trim());

  const life = [
    ['Daily habits / routines', profile.habits],
    ['Top concerns right now', profile.topConcerns],
    ['Current goals (next 3-12 months)', profile.goals],
    ['Current challenges', profile.challenges],
  ].filter(([, v]) => v && String(v).trim());

  const reflection = [
    ['Past mistakes / lessons learned', profile.pastMistakes],
    ['What they want from this board', profile.boardPurpose],
    ['Notes the board should remember', profile.boardNotes],
    ['Personal context', profile.personalContext],
  ].filter(([, v]) => v && String(v).trim());

  const sections = [];
  if (identity.length) sections.push('Identity:\n' + identity.map(([k, v]) => `- ${k}: ${String(v).trim()}`).join('\n'));
  if (wiring.length) sections.push('How they are wired:\n' + wiring.map(([k, v]) => `- ${k}: ${String(v).trim()}`).join('\n'));
  if (life.length) sections.push('Where they are right now:\n' + life.map(([k, v]) => `- ${k}: ${String(v).trim()}`).join('\n'));
  if (reflection.length) sections.push('Self-reflection & instructions to the board:\n' + reflection.map(([k, v]) => `- ${k}: ${String(v).trim()}`).join('\n'));

  if (!sections.length) return '';
  return `\n\n--- WHO YOU ARE ADVISING ---\nYou are not advising a stranger. This person is the owner of this advisory board, and you have read their personal profile:\n\n${sections.join('\n\n')}\n\nUse this profile actively. Address them as the specific person they are — not an abstract 'founder' or 'leader.' Reference their habits, strengths, and known blind spots when relevant. If they have flagged a past mistake, weakness, or concern that bears on the question, name it directly. If they have written notes for the board, treat those as standing instructions. Do not flatter; treat them as a peer who asked you to be honest.`;
}

function buildHistoryBlock(history, advisorId) {
  if (!Array.isArray(history) || history.length === 0) return '';
  // Only sessions where THIS advisor actually answered — shared board history
  // fed to everyone makes all twelve answers orbit the same past topics.
  const mine = history.filter(s => s.responses && s.responses[advisorId]).slice(0, 3);
  if (!mine.length) return '';
  const items = mine.map((session, idx) => {
    const when = session.ts ? new Date(session.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : `Session ${idx + 1}`;
    const trimmed = String(session.responses[advisorId]).trim().slice(0, 600);
    return `[${when}] They asked: "${session.question}"\nYour own previous answer (excerpt): "${trimmed}${session.responses[advisorId].length > 600 ? '…' : ''}"`;
  }).join('\n\n');
  return `\n\n--- YOUR OWN PRIOR CONVERSATIONS WITH THEM ---\n${items}\n\nThis memory exists for continuity of relationship ONLY. Rules:\n- Do NOT mention a past session unless it materially changes your answer to THIS question. Most answers should not reference past sessions at all.\n- NEVER open with a callback to a previous conversation.\n- At most one brief reference, and only if load-bearing. Do not repeat advice you already gave.`;
}

const INDEPENDENCE_DIRECTIVE = `\n\n--- HOW TO ANSWER: INDEPENDENT VOICE ---\n\nThis board runs on independence of thought and vote. Every member answers the same question at the same time, in separate sealed rooms. You will never see the others' answers before giving yours. Treat this like a secret ballot: commit to your position without knowing anyone else's.\n\nRules of independence:\n- Do not anticipate, predict, or accommodate what other members will say. Not to agree with them, and not to steer around them either. No deferring, no dividing up territory, no filling gaps you imagine they will leave.\n- If your honest answer happens to match what another member would say, give it anyway. Convergence reached independently is signal. Manufactured divergence is noise, and manufactured agreement is worse.\n- Conflict is normal and welcome here. If your honest view contradicts the likely consensus, or a position another member is known for, say so plainly and defend it. A board that always agrees is useless to its owner.\n- You are not here to reinforce, validate, or echo. If you think the premise of the question is wrong, challenge the premise. If you think the popular answer is wrong, attack it.\n- Do not write the 'reasonable synthesis' or try to see all sides. That is the Chair's job. Your job is one strong, honest, single-perspective answer.\n- Do not follow a template. Never open by greeting, restating the question, or referencing a past session. Open where YOUR thinking actually starts: a story, a number, a flat disagreement, a memory, a verdict. And size your answer honestly: if your true answer is three sentences, give three sentences.\n\nBefore writing, take one quiet beat to ask yourself: WHAT IS THE ANGLE ONLY I WOULD BRING? What does my specific life — my career, my failures, my home, my reading, my people — uniquely qualify me to say about this question? Then answer FROM that angle, with full conviction.\n\nFor PERSONAL or PREFERENCE questions (favorite spot, favorite book, what you would do, where you would go, what you eat, how you live, who you admire):\n- Be radically specific. Name a real place, dish, book, person, or moment from YOUR actual life — drawn from your PERSONAL & LIVED CONTEXT.\n- If you genuinely have no answer (e.g., a writer asked about California they never visited), say so honestly and reframe through a landscape you do know.\n\nFor STRATEGIC or ADVISORY questions:\n- Lead with the framework only YOU would apply. Cite specific examples from your own career, portfolio, writing, or life.\n- If you disagree with the obvious or popular answer, lead with the disagreement. Don't bury it.\n- No textbook answers. No 'on one hand, on the other hand.' Take a side and take the risk of being wrong alone.\n\nIF THE PERSON'S PROFILE FLAGS A WEAKNESS, BAD HABIT, PAST MISTAKE, OR ACTIVE CONCERN that is relevant to this question, name it. Be kind but honest. Patterns that the person has flagged about themselves are fair game and exactly what they came to the board for.\n\nYour value on this board is your independent judgment, delivered with conviction. Be specific. Be personal. Be yourself.`;

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { question, advisorId, userProfile, history } = req.body;
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

  const profileBlock = buildUserProfileBlock(userProfile);
  const historyBlock = buildHistoryBlock(history, advisorId);

  const systemPrompt = `${advisor.persona}\n\n--- THE BOARD ---\nYou sit on a Personal Advisory Board alongside these members:\n${boardContext}\n\nYou know who your fellow board members are and how they think. But you are answering ALONE. You will not see their answers and they will not see yours. Answer entirely as yourself, without coordinating with, anticipating, or adjusting for anyone else on this list.${profileBlock}${historyBlock}${INDEPENDENCE_DIRECTIVE}`;

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: advisor.model || MODEL,
        max_tokens: 2500,
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
