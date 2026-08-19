// ── Storage keys ─────────────────────────────────────────────────────────────
const LS_PROFILE = 'advisoryBoard.userProfile';
const LS_HISTORY = 'advisoryBoard.history';
const LS_PHOTOS  = 'advisoryBoard.photoOverrides';
const LS_CODE    = 'advisoryBoard.accessCode';
const LS_BENCH   = 'advisoryBoard.benchMode';

// ── State ────────────────────────────────────────────────────────────────────
let advisors = [];
let guests = [];              // one-session guest advisors (never persisted)
let selectedIds = new Set();
let editAdvisors = [];
let responseTexts = {};   // round 1 texts by advisor id
let round2Texts = {};     // round 2 texts by advisor id
let threads = {};         // advisor id -> [{role, content}, ...] for follow-ups
let currentQuestion = '';
let currentBench = [];    // advisors actually convened this session
let currentSessionId = null;
let debateRan = false;
let userProfile = loadProfile();
let history = loadHistory();
let photoOverrides = loadPhotoOverrides();
let accessCode = localStorage.getItem(LS_CODE) || '';
let benchMode = localStorage.getItem(LS_BENCH) || 'full';

// ── Authenticated fetch ──────────────────────────────────────────────────────
function api(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (accessCode) headers['x-board-code'] = accessCode;
  return fetch(url, { ...opts, headers });
}

function showGate(withError) {
  document.getElementById('gate').style.display = 'flex';
  document.getElementById('gate-error').style.display = withError ? 'block' : 'none';
  setTimeout(() => document.getElementById('gate-code').focus(), 50);
}

function hideGate() {
  document.getElementById('gate').style.display = 'none';
}

async function submitGate(e) {
  e.preventDefault();
  accessCode = document.getElementById('gate-code').value.trim();
  localStorage.setItem(LS_CODE, accessCode);
  await init(true);
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init(fromGate) {
  const res = await api('/api/advisors');
  if (res.status === 401) {
    showGate(!!fromGate);
    return;
  }
  hideGate();
  advisors = await res.json();
  selectedIds = new Set(advisors.filter(a => a.active).map(a => a.id));
  renderChips();
  renderBenchToggle();
  refreshProfileBanner();
  renderEpigraph();
}

// ── localStorage helpers ─────────────────────────────────────────────────────
function loadProfile() {
  try { return JSON.parse(localStorage.getItem(LS_PROFILE)) || {}; }
  catch { return {}; }
}

function saveProfileToLS(p) {
  localStorage.setItem(LS_PROFILE, JSON.stringify(p));
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(LS_HISTORY)) || []; }
  catch { return []; }
}

function saveHistoryToLS(h) {
  localStorage.setItem(LS_HISTORY, JSON.stringify(h));
}

function loadPhotoOverrides() {
  try { return JSON.parse(localStorage.getItem(LS_PHOTOS)) || {}; }
  catch { return {}; }
}

function savePhotoOverridesToLS(p) {
  localStorage.setItem(LS_PHOTOS, JSON.stringify(p));
}

// Update the current session in history (after follow-ups, debate, outcomes)
function updateCurrentSession(mutate) {
  if (!currentSessionId) return;
  const s = history.find(x => x.id === currentSessionId);
  if (!s) return;
  mutate(s);
  saveHistoryToLS(history);
}

// Resolve effective photo for an advisor (override beats stored)
function effectivePhoto(advisor) {
  return photoOverrides[advisor.id] || advisor.photo || '';
}

function isProfileMeaningful(p) {
  if (!p) return false;
  return Object.values(p).some(v => v && String(v).trim().length > 0);
}

// Sort a list of advisors alphabetically by display name.
function sortByName(arr) {
  return [...arr].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

function refreshProfileBanner() {
  const banner = document.getElementById('profile-banner');
  if (!banner) return;
  banner.style.display = isProfileMeaningful(userProfile) ? 'none' : 'flex';
}

// Active members plus any convened guests
function activeRoster() {
  return [...advisors.filter(a => a.active), ...guests];
}

function findMember(id) {
  return advisors.find(a => a.id === id) || guests.find(g => g.id === id);
}

// ── Chip rendering ───────────────────────────────────────────────────────────
function renderChips() {
  const container = document.getElementById('advisor-chips');
  container.innerHTML = [...sortByName(advisors.filter(a => a.active)), ...guests]
    .map(a => {
      const photo = effectivePhoto(a);
      const bioClick = `onclick="event.stopPropagation(); openBioModal('${a.id}')" title="About ${escAttr(a.name)}"`;
      const avatarHTML = photo
        ? `<span class="chip-avatar chip-avatar-photo" style="background-image:url('${photo}')" ${bioClick}></span>`
        : `<span class="chip-avatar" ${bioClick}>${escAttr(a.avatar)}</span>`;
      return `
        <div class="advisor-chip ${selectedIds.has(a.id) ? 'selected' : ''} ${a.isGuest ? 'guest' : ''}"
             style="--color:${a.color}"
             data-id="${a.id}"
             onclick="toggleChip('${a.id}')"
             title="${escAttr(a.name)} — ${escAttr(a.title)}">
          ${avatarHTML}
          <div style="min-width:0">
            <div class="chip-name name-link" onclick="event.stopPropagation(); openBioModal('${a.id}')" title="About ${escAttr(a.name)}">${escText(a.name.split(' ').slice(0, 2).join(' '))}</div>
            ${a.isGuest ? '<div class="chip-guest-tag">Guest</div>' : ''}
          </div>
        </div>
      `;
    }).join('');
}

// ── Guest seat ───────────────────────────────────────────────────────────────
async function conveneGuest() {
  const input = document.getElementById('guest-desc');
  const btn = document.getElementById('guest-btn');
  const description = input.value.trim();
  if (!description) { highlight(input); return; }
  btn.disabled = true;
  btn.textContent = 'Summoning…';
  try {
    const res = await api('/api/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      alert('Could not summon the guest: ' + err.error);
    } else {
      const g = await res.json();
      guests.push(g);
      selectedIds.add(g.id);
      renderChips();
      input.value = '';
    }
  } catch (err) {
    alert('Could not summon the guest: ' + err.message);
  }
  btn.disabled = false;
  btn.textContent = 'Convene';
}

function toggleChip(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  renderChips();
}

function selectAll() {
  selectedIds = new Set(advisors.filter(a => a.active).map(a => a.id));
  renderChips();
}

function deselectAll() {
  selectedIds.clear();
  renderChips();
}

// ── Bench mode (full board vs quorum) ────────────────────────────────────────
function renderBenchToggle() {
  document.getElementById('bench-full').classList.toggle('active', benchMode === 'full');
  document.getElementById('bench-quorum').classList.toggle('active', benchMode === 'quorum');
}

function setBenchMode(mode) {
  benchMode = mode;
  localStorage.setItem(LS_BENCH, mode);
  renderBenchToggle();
}

// ── Epigraph: a line from the current business shelf ─────────────────────────
const EPIGRAPHS = [
  { q: 'Good is the enemy of great.', a: 'Jim Collins', b: 'Good to Great' },
  { q: 'You do not rise to the level of your goals. You fall to the level of your systems.', a: 'James Clear', b: 'Atomic Habits' },
  { q: 'A hallmark of an open mind is not letting your ideas become your identity.', a: 'Adam Grant', b: 'Think Again' },
  { q: 'Pain plus reflection equals progress.', a: 'Ray Dalio', b: 'Principles' },
  { q: 'Great markets make great companies.', a: 'Bill Gurley', b: null },
  { q: 'In a world deluged by irrelevant information, clarity is power.', a: 'Yuval Noah Harari', b: '21 Lessons for the 21st Century' },
  { q: "It's easier to hold to your principles 100 percent of the time than it is to hold to them 98 percent of the time.", a: 'Clayton Christensen', b: 'How Will You Measure Your Life?' },
  { q: 'Nothing in life is as important as you think it is, while you are thinking about it.', a: 'Daniel Kahneman', b: 'Thinking, Fast and Slow' },
  { q: 'How you climb a mountain is more important than reaching the top.', a: 'Yvon Chouinard', b: 'Let My People Go Surfing' },
  { q: 'The first rule of compounding: never interrupt it unnecessarily.', a: 'Charlie Munger', b: null },
  { q: 'What got you here won’t get you there.', a: 'Marshall Goldsmith', b: 'What Got You Here Won’t Get You There' },
  { q: 'Hard choices, easy life. Easy choices, hard life.', a: 'Jerzy Gregorek', b: null },
];
let lastEpigraph = -1;

function renderEpigraph() {
  const el = document.getElementById('epigraph');
  if (!el) return;
  let i;
  do { i = Math.floor(Math.random() * EPIGRAPHS.length); } while (i === lastEpigraph && EPIGRAPHS.length > 1);
  lastEpigraph = i;
  const e = EPIGRAPHS[i];
  el.innerHTML = `
    <div class="epigraph-quote">“${escText(e.q)}”</div>
    <div class="epigraph-attr">${escText(e.a)}${e.b ? ` · <em>${escText(e.b)}</em>` : ''}</div>
  `;
}

// ── Keyboard shortcut ────────────────────────────────────────────────────────
function handleKey(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    askBoard();
  }
}

// ── Ask the Board ────────────────────────────────────────────────────────────
async function askBoard() {
  const question = document.getElementById('question').value.trim();
  if (!question) {
    highlight(document.getElementById('question'));
    return;
  }
  if (selectedIds.size === 0) {
    highlight(document.querySelector('.advisor-chips'));
    return;
  }

  const btn = document.getElementById('ask-btn');
  btn.disabled = true;
  btn.textContent = 'Asking…';

  let selected = sortByName(activeRoster().filter(a => selectedIds.has(a.id)));
  const quorumNote = document.getElementById('quorum-note');
  quorumNote.style.display = 'none';

  // Quorum: the Chair convenes the bench for this question
  if (benchMode === 'quorum' && selected.length > 6) {
    btn.textContent = 'Convening…';
    try {
      const qres = await api('/api/quorum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          roster: selected.map(a => ({ id: a.id, name: a.name, title: a.title, expertise: a.expertise || [] })),
        }),
      });
      if (qres.ok) {
        const q = await qres.json();
        const picked = new Set(q.ids);
        const bench = selected.filter(a => picked.has(a.id));
        if (bench.length >= 2) {
          selected = bench;
          quorumNote.innerHTML = `<strong>The Chair convened:</strong> ${bench.map(a => escText(a.name)).join(', ')}. ${escText(q.note || '')}`;
          quorumNote.style.display = 'block';
        }
      }
      // On failure fall through with the full selection
    } catch {}
    btn.textContent = 'Asking…';
  }

  currentQuestion = question;
  currentBench = selected;
  responseTexts = {};
  round2Texts = {};
  threads = {};
  debateRan = false;

  const section = document.getElementById('responses-section');
  section.style.display = 'block';
  document.getElementById('question-echo').textContent = `"${question}"`;
  document.getElementById('debate-section').style.display = 'none';
  document.getElementById('debate-responses').innerHTML = '';
  document.getElementById('final-section').style.display = 'none';
  document.getElementById('debate-cta').style.display = 'none';
  document.getElementById('synthesis-section').style.display = 'none';

  const grid = document.getElementById('responses');
  grid.innerHTML = '';
  for (const advisor of selected) {
    grid.appendChild(buildResponseCard(advisor, ''));
  }

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  await Promise.all(selected.map(a => streamRound1(a, question)));

  let synthesisText = '';
  if (selected.length > 1) {
    synthesisText = await synthesizeBoard(question, selected);
  }

  // Save session to history
  currentSessionId = 'sess_' + Date.now();
  const session = {
    id: currentSessionId,
    ts: Date.now(),
    question,
    advisors: selected.map(a => ({ id: a.id, name: a.name, title: a.title, color: a.color })),
    responses: { ...responseTexts },
    synthesis: synthesisText || '',
    threads: {},
    round2: null,
    outcome: null,
  };
  history.unshift(session);
  if (history.length > 100) history = history.slice(0, 100);
  saveHistoryToLS(history);

  // Offer Round 2 when more than one member answered
  if (selected.length > 1) {
    document.getElementById('debate-cta').style.display = 'flex';
  }

  btn.disabled = false;
  btn.textContent = 'Ask the Board';
}

// Build a response card. `suffix` distinguishes round-2 cards ('' or '2').
function buildResponseCard(advisor, suffix) {
  const card = document.createElement('div');
  card.className = 'response-card';
  card.style.setProperty('--color', advisor.color);
  const photo = effectivePhoto(advisor);
  const bioClick = `onclick="openBioModal('${advisor.id}')" title="About ${escAttr(advisor.name)}"`;
  const avatarHTML = photo
    ? `<span class="card-avatar card-avatar-photo" style="background-image:url('${photo}')" ${bioClick}></span>`
    : `<span class="card-avatar" style="background:${advisor.color}" ${bioClick}>${escText(advisor.avatar)}</span>`;
  card.innerHTML = `
    <div class="card-header">
      ${avatarHTML}
      <div>
        <div class="card-name name-link" onclick="openBioModal('${advisor.id}')" title="About ${escAttr(advisor.name)}">${escText(advisor.name)}</div>
        <div class="card-role">${escText(advisor.title)}</div>
      </div>
      <span class="position-badge" id="pos${suffix}-${advisor.id}" style="display:none"></span>
      <button class="tts-btn" id="tts${suffix}-${advisor.id}" style="display:none"
              onclick="toggleSpeak('${advisor.id}', '${suffix}')" title="Listen to ${escAttr(advisor.name)}">▶</button>
    </div>
    <div class="card-body" id="body${suffix}-${advisor.id}">
      <span class="thinking" style="--color:${advisor.color}">Thinking</span>
    </div>
    <div class="followups" id="fu${suffix}-${advisor.id}"></div>
    <div class="followup-box" id="fubox${suffix}-${advisor.id}" style="display:none">
      <input type="text" id="fuin${suffix}-${advisor.id}"
             placeholder="Push back on ${escAttr(advisor.name.split(' ')[0])}…"
             onkeydown="if(event.key==='Enter'){sendFollowUp('${advisor.id}','${suffix}')}" />
      <button onclick="sendFollowUp('${advisor.id}','${suffix}')" title="Send follow-up">→</button>
    </div>
  `;
  return card;
}

// ── Formal vote (POSITION line) parsing ──────────────────────────────────────
const POSITION_RE = /(^|\n)\s*POSITION:\s*(YES|NO|CONDITIONAL)\s*(?:[—–\-:]\s*)?(.*?)\s*$/i;

function parsePosition(text) {
  const m = String(text || '').trimEnd().match(POSITION_RE);
  if (!m) return null;
  return { vote: m[2].toUpperCase(), reason: m[3].trim() };
}

function stripPositionLine(text) {
  return String(text || '').trimEnd().replace(POSITION_RE, '').trimEnd();
}

function positionBadgeHTML(pos) {
  if (!pos) return '';
  const cls = pos.vote.toLowerCase();
  return `<span class="position-badge pos-${cls}" title="${escAttr(pos.reason)}">${pos.vote}</span>`;
}

function ballotEntries(texts, advisorsList) {
  return advisorsList.map(a => ({
    name: a.name,
    color: a.color,
    pos: parsePosition(texts[a.id]),
  }));
}

function tallyString(entries) {
  const voted = entries.filter(e => e.pos);
  const counts = { YES: 0, NO: 0, CONDITIONAL: 0 };
  voted.forEach(e => counts[e.pos.vote]++);
  const abstained = entries.length - voted.length;
  const parts = [];
  if (counts.YES) parts.push(`${counts.YES} YES`);
  if (counts.NO) parts.push(`${counts.NO} NO`);
  if (counts.CONDITIONAL) parts.push(`${counts.CONDITIONAL} CONDITIONAL`);
  if (abstained) parts.push(`${abstained} no vote`);
  return parts.length ? parts.join(', ') : 'no formal votes';
}

function renderBallotHTML(entries) {
  const voted = entries.filter(e => e.pos);
  if (!voted.length) return '';
  const chips = voted.map(e => `
    <span class="ballot-chip pos-${e.pos.vote.toLowerCase()}" style="--color:${e.color}" title="${escAttr(e.pos.reason)}">
      ${escText(e.name.split(' ').slice(0, 2).join(' '))} · ${e.pos.vote}
    </span>
  `).join('');
  return `
    <div class="ballot">
      <div class="ballot-title">The ballot <span class="ballot-summary">${tallyString(entries).replace(/, /g, ' · ')}</span></div>
      <div class="ballot-chips">${chips}</div>
    </div>
  `;
}

// ── TL;DR extraction ─────────────────────────────────────────────────────────
// Advisors and the Chair open answers with a "TL;DR: …" line (see lib/prompts.js).
// Render it as a styled summary block wherever it appears in the text.
const TLDR_LINE_RE = /^\s*(?:\*\*)?TL;?DR(?:\*\*)?\s*:\s*/i;

function renderAnswerHTML(text) {
  const lines = String(text || '').split('\n');
  const i = lines.findIndex(l => TLDR_LINE_RE.test(l));
  if (i === -1) return renderMarkdown(text);
  const tldr = lines[i].replace(TLDR_LINE_RE, '').replace(/\*\*\s*$/, '').trim();
  const before = lines.slice(0, i).join('\n').trim();
  const after = lines.slice(i + 1).join('\n').trim();
  return (before ? renderMarkdown(before) : '') +
    `<div class="tldr"><div class="tldr-label">TL;DR</div><div class="tldr-text">${escText(tldr)}</div></div>` +
    renderMarkdown(after);
}

// ── Streaming helpers ────────────────────────────────────────────────────────
async function streamInto(bodyEl, res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fullText += decoder.decode(value, { stream: true });
    bodyEl.innerHTML = renderMarkdown(fullText);
  }
  return fullText;
}

function finishAdvisorCard(advisor, suffix, fullText) {
  const bodyEl = document.getElementById(`body${suffix}-${advisor.id}`);
  const pos = parsePosition(fullText);
  bodyEl.innerHTML = renderAnswerHTML(pos ? stripPositionLine(fullText) : fullText);
  if (pos) {
    const badge = document.getElementById(`pos${suffix}-${advisor.id}`);
    if (badge) {
      badge.textContent = pos.vote;
      badge.className = `position-badge pos-${pos.vote.toLowerCase()}`;
      badge.title = pos.reason;
      badge.style.display = 'inline-flex';
    }
  }
  if (advisor.voiceId) {
    const tts = document.getElementById(`tts${suffix}-${advisor.id}`);
    if (tts) tts.style.display = 'inline-flex';
  }
}

async function streamRound1(advisor, question) {
  const bodyEl = document.getElementById(`body-${advisor.id}`);
  bodyEl.innerHTML = '';
  try {
    const res = await api('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        advisorId: advisor.id,
        userProfile,
        history: advisor.isGuest ? [] : history.slice(0, 5),
        guest: advisor.isGuest ? advisor : undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      bodyEl.innerHTML = `<span class="error-text">Error: ${escText(err.error)}</span>`;
      return;
    }

    const fullText = await streamInto(bodyEl, res);
    responseTexts[advisor.id] = fullText;
    threads[advisor.id] = [
      { role: 'user', content: question },
      { role: 'assistant', content: fullText },
    ];
    finishAdvisorCard(advisor, '', fullText);
    document.getElementById(`fubox-${advisor.id}`).style.display = 'flex';
  } catch (err) {
    bodyEl.innerHTML = `<span class="error-text">Error: ${escText(err.message)}</span>`;
  }
}

// ── Follow-up threads ────────────────────────────────────────────────────────
async function sendFollowUp(advisorId, suffix) {
  const input = document.getElementById(`fuin${suffix}-${advisorId}`);
  const text = input.value.trim();
  if (!text) return;
  const advisor = findMember(advisorId) || currentBench.find(a => a.id === advisorId);
  if (!advisor || !threads[advisorId]) return;
  input.value = '';
  input.disabled = true;

  const fuWrap = document.getElementById(`fu${suffix}-${advisorId}`);
  const qEl = document.createElement('div');
  qEl.className = 'followup-q';
  qEl.textContent = text;
  fuWrap.appendChild(qEl);
  const aEl = document.createElement('div');
  aEl.className = 'followup-a';
  aEl.innerHTML = `<span class="thinking" style="--color:${advisor.color}">Thinking</span>`;
  fuWrap.appendChild(aEl);
  aEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    const res = await api('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: text,
        advisorId,
        userProfile,
        history: [],
        thread: threads[advisorId],
        guest: advisor.isGuest ? advisor : undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      aEl.innerHTML = `<span class="error-text">Error: ${escText(err.error)}</span>`;
      input.disabled = false;
      return;
    }
    aEl.innerHTML = '';
    const reply = await streamInto(aEl, res);
    aEl.innerHTML = renderAnswerHTML(reply);
    threads[advisorId].push({ role: 'user', content: text }, { role: 'assistant', content: reply });
    updateCurrentSession(s => { s.threads = s.threads || {}; s.threads[advisorId] = threads[advisorId].slice(2); });
  } catch (err) {
    aEl.innerHTML = `<span class="error-text">Error: ${escText(err.message)}</span>`;
  }
  input.disabled = false;
  input.focus();
}

// ── Round 2: open debate ─────────────────────────────────────────────────────
async function openDebate() {
  if (debateRan) return;
  debateRan = true;
  document.getElementById('debate-cta').style.display = 'none';

  const bench = currentBench.filter(a => responseTexts[a.id]);
  const entries = ballotEntries(responseTexts, bench);
  const tally = tallyString(entries);

  const section = document.getElementById('debate-section');
  section.style.display = 'block';
  const grid = document.getElementById('debate-responses');
  grid.innerHTML = '';
  for (const advisor of bench) {
    grid.appendChild(buildResponseCard(advisor, '2'));
  }
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  await Promise.all(bench.map(advisor => streamRound2(advisor, bench, tally)));

  // Final ballot + final verdict
  const entries2 = ballotEntries(round2Texts, bench);
  document.getElementById('ballot2').innerHTML = renderBallotHTML(entries2);
  const finalSection = document.getElementById('final-section');
  finalSection.style.display = 'block';
  const finalBody = document.getElementById('final-body');
  finalBody.innerHTML = '<span class="thinking" style="--color:#111">Ruling on the final ballot</span>';
  finalSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  let finalText = '';
  try {
    const res = await api('/api/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: currentQuestion,
        userProfile,
        round: 2,
        round1Tally: tally,
        responses: bench.map(a => ({
          name: a.name,
          title: a.title,
          expertise: a.expertise || [],
          text: round2Texts[a.id] || '(did not respond)',
        })),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      finalBody.innerHTML = `<span class="error-text">Error: ${escText(err.error)}</span>`;
    } else {
      finalBody.innerHTML = '';
      finalText = await streamInto(finalBody, res);
      finalBody.innerHTML = renderAnswerHTML(finalText);
    }
  } catch (err) {
    finalBody.innerHTML = `<span class="error-text">Error: ${escText(err.message)}</span>`;
  }

  updateCurrentSession(s => {
    s.round2 = { responses: { ...round2Texts }, synthesis: finalText };
  });
}

async function streamRound2(advisor, bench, tally) {
  const bodyEl = document.getElementById(`body2-${advisor.id}`);
  bodyEl.innerHTML = `<span class="thinking" style="--color:${advisor.color}">Reading the ballot</span>`;

  const others = bench
    .filter(o => o.id !== advisor.id)
    .map(o => {
      const pos = parsePosition(responseTexts[o.id]);
      return {
        name: o.name,
        vote: pos ? pos.vote : null,
        reason: pos ? pos.reason : '',
        excerpt: stripPositionLine(responseTexts[o.id]).slice(0, 600),
      };
    });

  try {
    const res = await api('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        advisorId: advisor.id,
        userProfile,
        history: [],
        thread: threads[advisor.id] ? threads[advisor.id].slice(0, 2) : [],
        rebuttal: { tally, others },
        guest: advisor.isGuest ? advisor : undefined,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      bodyEl.innerHTML = `<span class="error-text">Error: ${escText(err.error)}</span>`;
      return;
    }
    bodyEl.innerHTML = '';
    const fullText = await streamInto(bodyEl, res);
    round2Texts[advisor.id] = fullText;
    finishAdvisorCard(advisor, '2', fullText);
  } catch (err) {
    bodyEl.innerHTML = `<span class="error-text">Error: ${escText(err.message)}</span>`;
  }
}

// ── Markdown renderer ────────────────────────────────────────────────────────
function renderMarkdown(text) {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');

  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  html = html.replace(/^---+$/gm, '<hr>');

  const lines = html.split('\n');
  const out = [];
  let inList = false;
  for (const line of lines) {
    const isBullet = /^[-•]\s+(.*)/.exec(line);
    if (isBullet) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${isBullet[1]}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(line);
    }
  }
  if (inList) out.push('</ul>');
  html = out.join('\n');

  html = html
    .split(/\n{2,}/)
    .map(para => {
      const t = para.trim();
      if (!t) return '';
      if (t.startsWith('<h3>') || t.startsWith('<ul>') || t.startsWith('<li>') || t.startsWith('<hr>')) return t;
      return `<p>${t.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');

  return html;
}

// ── Board Synthesis ──────────────────────────────────────────────────────────
async function synthesizeBoard(question, selected) {
  const synthesisSection = document.getElementById('synthesis-section');
  const synthesisBody = document.getElementById('synthesis-body');
  synthesisSection.style.display = 'block';
  synthesisBody.innerHTML = '<span class="thinking" style="--color:#111">Tallying the board verdict</span>';

  // Render the formal ballot from the independently cast POSITION lines
  document.getElementById('ballot').innerHTML = renderBallotHTML(ballotEntries(responseTexts, selected));

  setTimeout(() => synthesisSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

  const responses = selected.map(a => ({
    name: a.name,
    title: a.title,
    expertise: a.expertise || [],
    text: responseTexts[a.id] || '',
  }));

  let fullText = '';
  try {
    const res = await api('/api/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, responses, userProfile }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      synthesisBody.innerHTML = `<span class="error-text">Error: ${escText(err.error)}</span>`;
      return '';
    }

    fullText = await streamInto(synthesisBody, res);

    // After streaming completes: parse weights, render the vote panel,
    // and re-render the prose with the Advisor Relevance block stripped out.
    const weights = parseAdvisorWeights(fullText);
    if (weights && weights.length) {
      const votePanel = renderVotePanel(weights, selected);
      const stripped = stripAdvisorRelevanceBlock(fullText);
      synthesisBody.innerHTML = votePanel + renderAnswerHTML(stripped);
    } else {
      synthesisBody.innerHTML = renderAnswerHTML(fullText);
    }
  } catch (err) {
    synthesisBody.innerHTML = `<span class="error-text">Error: ${escText(err.message)}</span>`;
  }
  return fullText;
}

// ── Vote weights parsing & rendering ─────────────────────────────────────────
function parseAdvisorWeights(text) {
  const m = text.match(/\*\*Advisor Relevance\*\*\s*\n([\s\S]+?)(?=\n\s*\*\*|\n\s*---)/);
  if (!m) return null;
  const items = [];
  for (const line of m[1].split('\n')) {
    const lm = line.match(/^\s*[-•]\s*(.+?)\s*:\s*(HIGH|MEDIUM|LOW)\s*[—\-:]\s*(.+?)\s*$/i);
    if (lm) items.push({
      name: lm[1].trim(),
      weight: lm[2].toUpperCase(),
      reason: lm[3].trim(),
    });
  }
  return items.length ? items : null;
}

function stripAdvisorRelevanceBlock(text) {
  return text.replace(/\*\*Advisor Relevance\*\*\s*\n[\s\S]+?(?=\n\s*\*\*|\n\s*---)/, '').trimStart();
}

function renderVotePanel(items, selectedAdvisors) {
  const points = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const totalPoints = items.reduce((s, i) => s + (points[i.weight] || 0), 0) || 1;

  // Map each weight item to its advisor color & avatar (best-effort name match)
  const enriched = items.map(item => {
    const ad = selectedAdvisors.find(a => normalizeName(a.name) === normalizeName(item.name))
            || selectedAdvisors.find(a => normalizeName(a.name).startsWith(normalizeName(item.name).split(' ')[0]));
    return {
      ...item,
      color: ad?.color || '#999',
      avatar: ad?.avatar || item.name.slice(0, 2).toUpperCase(),
      photo: ad ? effectivePhoto(ad) : '',
      pct: ((points[item.weight] || 0) / totalPoints * 100),
    };
  });

  const stacked = enriched.map(e =>
    `<div class="vote-segment" style="width:${e.pct.toFixed(2)}%; background:${e.color}" title="${escAttr(e.name)} · ${e.weight} · ${e.pct.toFixed(0)}%"></div>`
  ).join('');

  const widthMap = { HIGH: 100, MEDIUM: 60, LOW: 28 };
  const rows = enriched.map(e => {
    const avatarHTML = e.photo
      ? `<span class="vote-avatar vote-avatar-photo" style="background-image:url('${e.photo}'); border-color:${e.color}"></span>`
      : `<span class="vote-avatar" style="background:${e.color}">${escText(e.avatar)}</span>`;
    return `
      <div class="vote-row">
        ${avatarHTML}
        <div class="vote-row-name">${escText(e.name)}</div>
        <div class="vote-row-bar"><div class="vote-row-fill" style="width:${widthMap[e.weight]}%; background:${e.color}"></div></div>
        <div class="vote-row-weight vote-weight-${e.weight.toLowerCase()}">${e.weight}</div>
        <div class="vote-row-reason">${escText(e.reason)}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="vote-panel">
      <div class="vote-panel-label">Vote weights for this question</div>
      <div class="vote-stacked-bar">${stacked}</div>
      <div class="vote-rows">${rows}</div>
    </div>
  `;
}

function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/[^\w\s]/g, '').trim();
}

// ── Member Bio & Picks ───────────────────────────────────────────────────────
function pickTag(type) {
  return `<span class="pick-tag pick-tag-${escAttr(String(type || 'pick').toLowerCase())}">${escText(type || 'pick')}</span>`;
}

function renderPicksList(picks) {
  if (!Array.isArray(picks) || !picks.length) return '';
  return `<div class="picks-list">` + picks.map(p => `
    <div class="pick-item">
      ${pickTag(p.type)}
      <div class="pick-content">
        <div class="pick-title">${escText(p.item)}</div>
        ${p.note ? `<div class="pick-note">${escText(p.note)}</div>` : ''}
      </div>
    </div>
  `).join('') + `</div>`;
}

function openBioModal(id) {
  const a = findMember(id);
  if (!a) return;
  const photo = effectivePhoto(a);
  const avatarHTML = photo
    ? `<div class="bio-photo" style="background-image:url('${photo}'); border-color:${a.color}"></div>`
    : `<div class="bio-photo bio-photo-initials" style="background:${a.color}">${escText(a.avatar)}</div>`;
  document.getElementById('bio-title').textContent = a.name;
  document.getElementById('bio-body').innerHTML = `
    <div class="bio-header">
      ${avatarHTML}
      <div>
        <div class="bio-name">${escText(a.name)}</div>
        <div class="bio-role" style="color:${a.color}">${escText(a.title)}</div>
      </div>
    </div>
    ${a.bio ? `<p class="bio-text">${escText(a.bio)}</p>` : '<p class="bio-text">No bio yet. Add one in Edit Board.</p>'}
    ${a.picks && a.picks.length ? `<div class="bio-picks-label">Their picks</div>${renderPicksList(a.picks)}` : ''}
  `;
  document.getElementById('bio-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeBioModal() {
  document.getElementById('bio-modal').style.display = 'none';
  document.body.style.overflow = '';
}

function bioOverlayClick(e) {
  if (e.target === document.getElementById('bio-modal')) closeBioModal();
}

// ── Reading Room ─────────────────────────────────────────────────────────────
const READING_TYPES = ['book', 'article', 'essay', 'podcast', 'video', 'interview', 'music', 'exhibition', 'quote'];

function switchMain(id) {
  for (const m of ['main-ask', 'main-history', 'main-reading', 'main-chat']) {
    document.getElementById(m).style.display = m === id ? (id === 'main-ask' ? 'flex' : 'block') : 'none';
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function goHome() {
  switchMain('main-ask');
}

async function openReadingView() {
  switchMain('main-reading');
  renderStandingPicks();
  const list = document.getElementById('reading-list');
  list.innerHTML = '<div class="history-empty">Loading the shelf…</div>';
  try {
    const res = await api('/api/reading');
    const feed = res.ok ? await res.json() : { items: [] };
    renderReadingFeed(feed);
  } catch {
    list.innerHTML = '<div class="history-empty">Could not load the reading feed.</div>';
  }
}

function closeReadingView() {
  switchMain('main-ask');
}

function renderReadingFeed(feed) {
  const list = document.getElementById('reading-list');
  const updated = document.getElementById('reading-updated');
  if (feed.updatedAt) {
    updated.textContent = `What the board is reading, saying, and listening to. Last refreshed ${feed.updatedAt}.`;
  }
  const items = Array.isArray(feed.items) ? feed.items : [];
  if (!items.length) {
    list.innerHTML = '<div class="history-empty">The shelf is empty. The weekly refresh will stock it.</div>';
    return;
  }
  const byAdvisor = {};
  for (const item of items) {
    (byAdvisor[item.advisorId] = byAdvisor[item.advisorId] || []).push(item);
  }
  const ordered = sortByName(advisors.filter(a => byAdvisor[a.id]));
  list.innerHTML = ordered.map(a => {
    const photo = effectivePhoto(a);
    const avatarHTML = photo
      ? `<span class="card-avatar card-avatar-photo" style="background-image:url('${photo}')"></span>`
      : `<span class="card-avatar" style="background:${a.color}">${escText(a.avatar)}</span>`;
    const rows = byAdvisor[a.id].map(item => `
      <div class="reading-item">
        ${pickTag(item.type)}
        <div class="reading-item-content">
          <div class="reading-item-title">${item.url
            ? `<a href="${escAttr(item.url)}" target="_blank" rel="noopener">${escText(item.title)}</a>`
            : escText(item.title)}</div>
          ${item.note ? `<div class="reading-item-note">${escText(item.note)}</div>` : ''}
          ${item.date ? `<div class="reading-item-date">${escText(item.date)}</div>` : ''}
        </div>
      </div>
    `).join('');
    return `
      <div class="reading-advisor" style="--color:${a.color}">
        <div class="picks-advisor-header name-link" onclick="openBioModal('${a.id}')" title="About ${escAttr(a.name)}">
          ${avatarHTML}
          <div>
            <div class="card-name">${escText(a.name)}</div>
            <div class="card-role">${escText(a.title)}</div>
          </div>
        </div>
        ${rows}
      </div>
    `;
  }).join('');
}

function renderStandingPicks() {
  const body = document.getElementById('picks-body');
  const withPicks = sortByName(advisors.filter(a => a.active && a.picks && a.picks.length));
  if (!withPicks.length) {
    body.innerHTML = '<p class="bio-text">No picks yet.</p>';
    return;
  }
  body.innerHTML = withPicks.map(a => {
    const photo = effectivePhoto(a);
    const avatarHTML = photo
      ? `<span class="card-avatar card-avatar-photo" style="background-image:url('${photo}')"></span>`
      : `<span class="card-avatar" style="background:${a.color}">${escText(a.avatar)}</span>`;
    return `
      <div class="picks-advisor" style="--color:${a.color}">
        <div class="picks-advisor-header name-link" onclick="openBioModal('${a.id}')" title="About ${escAttr(a.name)}">
          ${avatarHTML}
          <div>
            <div class="card-name">${escText(a.name)}</div>
            <div class="card-role">${escText(a.title)}</div>
          </div>
        </div>
        ${renderPicksList(a.picks)}
      </div>
    `;
  }).join('');
}

// ── 1-on-1 private sessions ──────────────────────────────────────────────────
const LS_DMS = 'advisoryBoard.dms';
let dms = (() => { try { return JSON.parse(localStorage.getItem(LS_DMS)) || {}; } catch { return {}; } })();
let currentDm = null;
let dmAutoSpeak = localStorage.getItem('advisoryBoard.dmAutoSpeak') === '1';
let dmBusy = false;

function saveDms() { localStorage.setItem(LS_DMS, JSON.stringify(dms)); }

function openChatView() {
  switchMain('main-chat');
  document.getElementById('dm-session').style.display = 'none';
  const picker = document.getElementById('dm-picker');
  picker.style.display = 'grid';
  picker.innerHTML = sortByName(advisors.filter(a => a.active)).map(a => {
    const photo = effectivePhoto(a);
    const avatarHTML = photo
      ? `<span class="chip-avatar chip-avatar-photo" style="background-image:url('${photo}')"></span>`
      : `<span class="chip-avatar">${escAttr(a.avatar)}</span>`;
    const count = (dms[a.id] || []).length;
    return `
      <div class="advisor-chip selected" style="--color:${a.color}" onclick="openDm('${a.id}')" title="Private session with ${escAttr(a.name)}">
        ${avatarHTML}
        <div style="min-width:0">
          <div class="chip-name">${escText(a.name.split(' ').slice(0, 2).join(' '))}</div>
          ${count ? `<div class="chip-guest-tag">${Math.ceil(count / 2)} exchanges</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

function openDm(id) {
  const a = findMember(id);
  if (!a) return;
  currentDm = id;
  document.getElementById('dm-picker').style.display = 'none';
  const session = document.getElementById('dm-session');
  session.style.display = 'block';
  const photo = effectivePhoto(a);
  const avatarHTML = photo
    ? `<span class="card-avatar card-avatar-photo" style="background-image:url('${photo}')" onclick="openBioModal('${a.id}')"></span>`
    : `<span class="card-avatar" style="background:${a.color}" onclick="openBioModal('${a.id}')">${escText(a.avatar)}</span>`;
  document.getElementById('dm-head').innerHTML = `
    ${avatarHTML}
    <div style="flex-grow:1; min-width:0">
      <div class="card-name">${escText(a.name)}</div>
      <div class="card-role">${escText(a.title)}</div>
    </div>
    <button class="btn-link" onclick="toggleDmAutoSpeak(this)">${dmAutoSpeak ? 'Voice: on' : 'Voice: off'}</button>
    <button class="btn-link" onclick="clearDm()">New conversation</button>
    <button class="btn-link" onclick="openChatView()">← All members</button>
  `;
  renderDmMessages();
  document.getElementById('dm-text').focus();
}

function toggleDmAutoSpeak(btn) {
  dmAutoSpeak = !dmAutoSpeak;
  localStorage.setItem('advisoryBoard.dmAutoSpeak', dmAutoSpeak ? '1' : '0');
  btn.textContent = dmAutoSpeak ? 'Voice: on' : 'Voice: off';
}

function clearDm() {
  if (!currentDm) return;
  if ((dms[currentDm] || []).length && !confirm('Start a fresh conversation? The current one is discarded.')) return;
  dms[currentDm] = [];
  saveDms();
  renderDmMessages();
}

function renderDmMessages() {
  const wrap = document.getElementById('dm-messages');
  const a = findMember(currentDm);
  const msgs = dms[currentDm] || [];
  if (!msgs.length) {
    wrap.innerHTML = `<div class="history-empty">The room is yours. Say what you came to say.</div>`;
    return;
  }
  wrap.innerHTML = msgs.map((m, i) => m.role === 'user'
    ? `<div class="dm-msg dm-user">${escText(m.content)}</div>`
    : `<div class="dm-msg dm-advisor" style="--color:${a.color}">
         <div class="dm-advisor-text">${renderMarkdown(m.content)}</div>
         ${a.voiceId ? `<button class="tts-btn dm-speak" onclick="speakDmMessage(${i})" title="Listen">▶</button>` : ''}
       </div>`
  ).join('');
  wrap.scrollTop = wrap.scrollHeight;
}

async function speakDmMessage(i) {
  const msgs = dms[currentDm] || [];
  const m = msgs[i];
  if (!m || m.role !== 'assistant') return;
  stopSpeaking();
  try {
    const res = await api('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ advisorId: currentDm, text: m.content }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    currentAudio = new Audio(URL.createObjectURL(blob));
    currentAudio.onended = stopSpeaking;
    await currentAudio.play();
    const stopBtn = document.getElementById('stop-voice');
    if (stopBtn) stopBtn.style.display = 'inline-flex';
  } catch {}
}

async function sendDm() {
  if (dmBusy || !currentDm) return;
  const input = document.getElementById('dm-text');
  const text = input.value.trim();
  if (!text) return;
  const a = findMember(currentDm);
  const thread = (dms[currentDm] || []).map(m => ({ role: m.role, content: m.content }));
  dms[currentDm] = dms[currentDm] || [];
  dms[currentDm].push({ role: 'user', content: text, ts: Date.now() });
  saveDms();
  input.value = '';
  renderDmMessages();

  const wrap = document.getElementById('dm-messages');
  const liveEl = document.createElement('div');
  liveEl.className = 'dm-msg dm-advisor';
  liveEl.style.setProperty('--color', a.color);
  liveEl.innerHTML = `<div class="dm-advisor-text"><span class="thinking" style="--color:${a.color}">Thinking</span></div>`;
  wrap.appendChild(liveEl);
  wrap.scrollTop = wrap.scrollHeight;

  dmBusy = true;
  try {
    const res = await api('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: text, advisorId: currentDm, userProfile, thread, mode: 'chat' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      liveEl.querySelector('.dm-advisor-text').innerHTML = `<span class="error-text">Error: ${escText(err.error)}</span>`;
      dmBusy = false;
      return;
    }
    const target = liveEl.querySelector('.dm-advisor-text');
    target.innerHTML = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      full += decoder.decode(value, { stream: true });
      target.innerHTML = renderMarkdown(full);
      wrap.scrollTop = wrap.scrollHeight;
    }
    dms[currentDm].push({ role: 'assistant', content: full, ts: Date.now() });
    saveDms();
    renderDmMessages();
    if (dmAutoSpeak && a.voiceId) speakDmMessage(dms[currentDm].length - 1);
  } catch (err) {
    liveEl.querySelector('.dm-advisor-text').innerHTML = `<span class="error-text">Error: ${escText(err.message)}</span>`;
  }
  dmBusy = false;
  input.focus();
}

// Dictation via the browser's speech recognition (no API key needed)
let dictation = null;
function toggleDictation() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = document.getElementById('dm-mic');
  if (!SR) { alert('Voice input needs Chrome or Safari.'); return; }
  if (dictation) { dictation.stop(); return; }
  const input = document.getElementById('dm-text');
  dictation = new SR();
  dictation.lang = (navigator.language || 'en-US').startsWith('pt') ? 'pt-BR' : 'en-US';
  dictation.interimResults = true;
  dictation.continuous = false;
  const base = input.value ? input.value + ' ' : '';
  dictation.onresult = e => {
    input.value = base + Array.from(e.results).map(r => r[0].transcript).join('');
  };
  dictation.onend = () => {
    dictation = null;
    micBtn.classList.remove('recording');
    if (input.value.trim()) sendDm();
  };
  dictation.onerror = () => { dictation = null; micBtn.classList.remove('recording'); };
  micBtn.classList.add('recording');
  dictation.start();
}

// ── Voice playback (ElevenLabs) ──────────────────────────────────────────────
let currentAudio = null;
let currentAudioKey = null;

function resetSpeakBtn(key) {
  const btn = document.getElementById(`tts${key}`);
  if (btn) { btn.textContent = '▶'; btn.classList.remove('playing', 'loading'); }
}

function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    if (currentAudio.src) URL.revokeObjectURL(currentAudio.src);
  }
  if (currentAudioKey) resetSpeakBtn(currentAudioKey);
  currentAudio = null;
  currentAudioKey = null;
  const stopBtn = document.getElementById('stop-voice');
  if (stopBtn) stopBtn.style.display = 'none';
}

async function toggleSpeak(id, suffix) {
  const key = `${suffix}-${id}`;
  if (currentAudioKey === key) { stopSpeaking(); return; }
  stopSpeaking();

  const source = suffix === '2' ? round2Texts : responseTexts;
  const text = stripPositionLine(source[id] || '');
  if (!text) return;

  const btn = document.getElementById(`tts${key}`);
  btn.textContent = '…';
  btn.classList.add('loading');
  currentAudioKey = key;

  try {
    const res = await api('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ advisorId: id, text }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      alert(err.error || 'Voice playback failed');
      resetSpeakBtn(key);
      currentAudioKey = null;
      return;
    }
    const blob = await res.blob();
    if (currentAudioKey !== key) return; // user moved on while loading
    currentAudio = new Audio(URL.createObjectURL(blob));
    currentAudio.onended = stopSpeaking;
    await currentAudio.play();
    btn.textContent = '■';
    btn.classList.remove('loading');
    btn.classList.add('playing');
    const stopBtn = document.getElementById('stop-voice');
    if (stopBtn) stopBtn.style.display = 'inline-flex';
  } catch (err) {
    alert('Voice playback failed: ' + err.message);
    resetSpeakBtn(key);
    currentAudioKey = null;
  }
}

// ── New Question ─────────────────────────────────────────────────────────────
function newQuestion() {
  document.getElementById('responses-section').style.display = 'none';
  document.getElementById('synthesis-section').style.display = 'none';
  document.getElementById('debate-section').style.display = 'none';
  document.getElementById('quorum-note').style.display = 'none';
  // Guests sit for one question only
  if (guests.length) {
    for (const g of guests) selectedIds.delete(g.id);
    guests = [];
    renderChips();
  }
  document.getElementById('question').value = '';
  document.getElementById('question').focus();
  renderEpigraph();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Profile Modal ────────────────────────────────────────────────────────────
const PROFILE_FIELDS = [
  'name', 'pronouns', 'lifeStage', 'location', 'profession', 'industry',
  'linkedin', 'x', 'instagram', 'website',
  'values', 'strengths', 'weaknesses',
  'habits', 'topConcerns', 'goals', 'challenges',
  'pastMistakes', 'boardPurpose', 'boardNotes', 'personalContext',
];

function openProfileModal() {
  for (const f of PROFILE_FIELDS) {
    const el = document.getElementById(`p-${f}`);
    if (el) el.value = userProfile[f] || '';
  }
  document.getElementById('profile-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeProfileModal() {
  document.getElementById('profile-modal').style.display = 'none';
  document.body.style.overflow = '';
}

function profileOverlayClick(e) {
  if (e.target === document.getElementById('profile-modal')) closeProfileModal();
}

function saveProfile() {
  const next = {};
  for (const f of PROFILE_FIELDS) {
    const el = document.getElementById(`p-${f}`);
    if (el && el.value.trim()) next[f] = el.value.trim();
  }
  userProfile = next;
  saveProfileToLS(userProfile);
  closeProfileModal();
  refreshProfileBanner();
}

// ── Outcomes ─────────────────────────────────────────────────────────────────
const OUTCOME_LABELS = [
  'Pending',
  'Followed the board, went well',
  'Followed the board, went badly',
  'Went my own way, glad I did',
  'Went my own way, board was right',
  'Mixed / too early to tell',
];

function outcomeChip(outcome) {
  if (!outcome || !outcome.label || outcome.label === 'Pending') return '';
  const good = /went well|glad/.test(outcome.label);
  const bad = /went badly|board was right/.test(outcome.label);
  const cls = good ? 'outcome-good' : bad ? 'outcome-bad' : 'outcome-mixed';
  return `<span class="outcome-chip ${cls}" title="${escAttr(outcome.note || '')}">${escText(outcome.label)}</span>`;
}

function saveOutcome(i) {
  const s = history[i];
  if (!s) return;
  const label = document.getElementById(`outcome-status-${i}`).value;
  const note = document.getElementById(`outcome-note-${i}`).value.trim();
  s.outcome = label === 'Pending' && !note ? null : { label, note, ts: Date.now() };
  saveHistoryToLS(history);
  const saved = document.getElementById(`outcome-saved-${i}`);
  if (saved) {
    saved.style.display = 'inline';
    setTimeout(() => { saved.style.display = 'none'; }, 1500);
  }
}

// ── Board Review ─────────────────────────────────────────────────────────────
async function runBoardReview() {
  const candidates = history
    .filter(s => s.synthesis || Object.keys(s.responses || {}).length)
    .slice(0, 10);
  if (!candidates.length) {
    alert('Nothing to review yet. Ask the board some questions first.');
    return;
  }
  const btn = document.getElementById('review-btn');
  btn.disabled = true;
  btn.textContent = 'Reviewing…';

  const card = document.getElementById('review-card');
  card.style.display = 'block';
  const body = document.getElementById('review-body');
  body.innerHTML = '<span class="thinking" style="--color:#111">Pulling the old files</span>';
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const sessions = candidates.map(s => {
    const entries = Object.entries(s.responses || {}).map(([advId, text]) => {
      const ad = (s.advisors || []).find(a => a.id === advId) || { name: advId, color: '#999' };
      return { name: ad.name, color: ad.color, pos: parsePosition(text) };
    });
    const verdictSource = (s.round2 && s.round2.synthesis) || s.synthesis || '';
    return {
      question: s.question,
      date: new Date(s.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      ballot: tallyString(entries),
      verdict: stripAdvisorRelevanceBlock(verdictSource).slice(0, 900),
      outcome: s.outcome || null,
    };
  });

  try {
    const res = await api('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessions, userProfile }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      body.innerHTML = `<span class="error-text">Error: ${escText(err.error)}</span>`;
    } else {
      body.innerHTML = '';
      await streamInto(body, res);
    }
  } catch (err) {
    body.innerHTML = `<span class="error-text">Error: ${escText(err.message)}</span>`;
  }
  btn.disabled = false;
  btn.textContent = 'Board Review';
}

// ── History View ─────────────────────────────────────────────────────────────
function openHistoryView() {
  switchMain('main-history');
  document.getElementById('history-detail').style.display = 'none';
  document.getElementById('history-list').style.display = 'block';
  renderHistoryList();
}

function closeHistoryView() {
  switchMain('main-ask');
}

function renderHistoryList() {
  const list = document.getElementById('history-list');
  if (!history.length) {
    list.innerHTML = `<div class="history-empty">No sessions yet. Ask your board a question and it will show up here.</div>`;
    return;
  }
  list.innerHTML = history.map((s, i) => {
    const date = new Date(s.ts);
    const ds = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const ts = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const advisorPills = (s.advisors || []).map(a =>
      `<span class="hist-pill" style="background:${a.color}1a;color:${a.color};border-color:${a.color}33">${escText(a.name.split(' ').slice(0, 2).join(' '))}</span>`
    ).join('');
    return `
      <div class="history-card" onclick="openHistoryDetail(${i})">
        <div class="history-card-top">
          <div class="history-card-meta">${ds} · ${ts}${s.round2 ? ' · went to debate' : ''}</div>
          <div>
            ${outcomeChip(s.outcome)}
            <button class="btn-remove history-delete" onclick="event.stopPropagation(); deleteHistorySession(${i})">Delete</button>
          </div>
        </div>
        <div class="history-card-question">${escText(s.question)}</div>
        <div class="history-card-pills">${advisorPills}</div>
      </div>
    `;
  }).join('');
}

function historyResponseCard(ad, advId, text) {
  const photo = effectivePhoto({ id: advId, photo: ad.photo });
  const bioClick = `onclick="openBioModal('${escAttr(advId)}')" title="About ${escAttr(ad.name)}"`;
  const avatarHTML = photo
    ? `<span class="card-avatar card-avatar-photo" style="background-image:url('${photo}')" ${bioClick}></span>`
    : `<span class="card-avatar" style="background:${ad.color}" ${bioClick}>${escText(ad.avatar || ad.name.slice(0, 2).toUpperCase())}</span>`;
  const pos = parsePosition(text);
  return `
    <div class="response-card" style="--color:${ad.color}">
      <div class="card-header">
        ${avatarHTML}
        <div>
          <div class="card-name name-link" onclick="openBioModal('${escAttr(advId)}')" title="About ${escAttr(ad.name)}">${escText(ad.name)}</div>
          <div class="card-role">${escText(ad.title || '')}</div>
        </div>
        ${positionBadgeHTML(pos)}
      </div>
      <div class="card-body">${renderAnswerHTML(pos ? stripPositionLine(text) : (text || ''))}</div>
    </div>
  `;
}

function historyVerdictCard(title, subtitle, ballotHTML, bodyHTML) {
  return `
    <div class="synthesis-section" style="display:block">
      <div class="synthesis-card">
        <div class="synthesis-header">
          <div>
            <div class="synthesis-title">${title}</div>
            <div class="synthesis-subtitle">${subtitle}</div>
          </div>
        </div>
        ${ballotHTML}
        <div class="synthesis-body">${bodyHTML}</div>
      </div>
    </div>`;
}

function openHistoryDetail(i) {
  const s = history[i];
  if (!s) return;
  const detail = document.getElementById('history-detail');
  const date = new Date(s.ts);
  const ds = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const ts = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const advisorById = id => advisors.find(a => a.id === id) || (s.advisors || []).find(a => a.id === id) || { name: id, title: '', color: '#999' };

  const responsesHTML = Object.entries(s.responses || {}).map(([advId, text]) => {
    let cardHTML = historyResponseCard(advisorById(advId), advId, text);
    // Follow-up thread, if the owner pushed back on this advisor
    const th = (s.threads || {})[advId];
    if (Array.isArray(th) && th.length) {
      const fuHTML = th.map(t => t.role === 'user'
        ? `<div class="followup-q">${escText(t.content)}</div>`
        : `<div class="followup-a">${renderMarkdown(t.content)}</div>`
      ).join('');
      cardHTML = cardHTML.replace('</div>\n    </div>\n  ', `</div><div class="followups">${fuHTML}</div></div>`);
    }
    return cardHTML;
  }).join('');

  const ballotHTML = renderBallotHTML(Object.entries(s.responses || {}).map(([advId, text]) => {
    const ad = advisorById(advId);
    return { name: ad.name, color: ad.color, pos: parsePosition(text) };
  }));

  let synthesisHTML = '';
  if (s.synthesis) {
    const weights = parseAdvisorWeights(s.synthesis);
    let bodyHTML;
    if (weights && weights.length) {
      const votePanel = renderVotePanel(weights, s.advisors || []);
      bodyHTML = votePanel + renderAnswerHTML(stripAdvisorRelevanceBlock(s.synthesis));
    } else {
      bodyHTML = renderAnswerHTML(s.synthesis);
    }
    synthesisHTML = historyVerdictCard('Board Verdict', 'From this session', ballotHTML, bodyHTML);
  }

  // Round 2, if the session went to debate
  let round2HTML = '';
  if (s.round2 && s.round2.responses) {
    const r2cards = Object.entries(s.round2.responses).map(([advId, text]) =>
      historyResponseCard(advisorById(advId), advId, text)
    ).join('');
    const r2ballot = renderBallotHTML(Object.entries(s.round2.responses).map(([advId, text]) => {
      const ad = advisorById(advId);
      return { name: ad.name, color: ad.color, pos: parsePosition(text) };
    }));
    round2HTML = `
      <div class="responses-header" style="margin-top:40px">
        <div class="section-label">Round Two <span class="label-hint">open debate</span></div>
      </div>
      <div class="responses-grid">${r2cards}</div>
      ${s.round2.synthesis ? historyVerdictCard('Final Verdict', 'After open debate', r2ballot, renderAnswerHTML(s.round2.synthesis)) : ''}
    `;
  }

  // Outcome editor
  const outcomeOptions = OUTCOME_LABELS.map(l =>
    `<option value="${escAttr(l)}" ${s.outcome && s.outcome.label === l ? 'selected' : ''}>${escText(l)}</option>`
  ).join('');
  const outcomeHTML = `
    <div class="outcome-box">
      <div class="outcome-title">What happened?</div>
      <p class="outcome-hint">Record the outcome. The Board Review uses this to audit its own calls.</p>
      <div class="outcome-controls">
        <select id="outcome-status-${i}">${outcomeOptions}</select>
        <button class="btn-primary outcome-save" onclick="saveOutcome(${i})">Save outcome</button>
        <span class="outcome-saved" id="outcome-saved-${i}" style="display:none">Saved</span>
      </div>
      <textarea id="outcome-note-${i}" rows="2" placeholder="What actually happened, in a sentence or two…">${escText(s.outcome ? s.outcome.note || '' : '')}</textarea>
    </div>
  `;

  detail.innerHTML = `
    <div class="history-detail-header">
      <button class="btn-link" onclick="closeHistoryDetail()">← Back to history</button>
      <div style="display:flex; align-items:center; gap:16px;">
        <button class="btn-link" onclick="openMinutes(${i})">Minutes (PDF)</button>
        <div class="history-detail-meta">${ds} · ${ts}</div>
      </div>
    </div>
    <div class="question-echo">"${escText(s.question)}"</div>
    ${outcomeHTML}
    <div class="responses-grid">${responsesHTML}</div>
    ${synthesisHTML}
    ${round2HTML}
  `;
  document.getElementById('history-list').style.display = 'none';
  detail.style.display = 'block';
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Minutes (optional printable record of a session) ─────────────────────────
function minutesResponseHTML(name, title, text) {
  const pos = parsePosition(text);
  return `
    <div style="margin-top:28px; border-top:1px solid #E6E3D8; padding-top:18px; break-inside:avoid-page;">
      <div style="display:flex; align-items:baseline; justify-content:space-between; gap:12px;">
        <div>
          <span style="font-size:19px; font-weight:500;">${escText(name)}</span>
          <span style="font-family:'Instrument Sans',sans-serif; font-size:10px; font-weight:600; letter-spacing:0.14em; text-transform:uppercase; color:#A5A292; margin-left:10px;">${escText(title || '')}</span>
        </div>
        ${pos ? `<span style="font-family:'Instrument Sans',sans-serif; font-size:10px; font-weight:700; letter-spacing:0.1em;">${pos.vote}</span>` : ''}
      </div>
      <div style="font-size:14.5px; line-height:1.7; margin-top:10px;">${renderAnswerHTML(pos ? stripPositionLine(text) : (text || ''))}</div>
    </div>`;
}

function openMinutes(i) {
  const s = history[i];
  if (!s) return;
  const date = new Date(s.ts).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  const advisorById = id => (s.advisors || []).find(a => a.id === id) || findMember(id) || { name: id, title: '' };

  const bench = (s.advisors || []).map(a => a.name).join(', ');
  const entries = Object.entries(s.responses || {}).map(([advId, text]) => {
    const ad = advisorById(advId);
    return { name: ad.name, color: '#17170F', pos: parsePosition(text) };
  });
  const responsesHTML = Object.entries(s.responses || {}).map(([advId, text]) => {
    const ad = advisorById(advId);
    return minutesResponseHTML(ad.name, ad.title, text);
  }).join('');

  let round2HTML = '';
  if (s.round2 && s.round2.responses) {
    round2HTML = `<h2 style="font-size:22px; font-weight:500; margin:44px 0 0;">Round Two — open debate</h2>` +
      Object.entries(s.round2.responses).map(([advId, text]) => {
        const ad = advisorById(advId);
        return minutesResponseHTML(ad.name, ad.title, text);
      }).join('') +
      (s.round2.synthesis ? `<h2 style="font-size:22px; font-weight:500; margin:44px 0 0;">Final Verdict</h2><div style="font-size:14.5px; line-height:1.7; margin-top:14px;">${renderAnswerHTML(s.round2.synthesis)}</div>` : '');
  }

  const verdictSource = s.synthesis ? stripAdvisorRelevanceBlock(s.synthesis) : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Minutes — ${escText(date)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Instrument+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
      body { font-family: 'Newsreader', Georgia, serif; color: #17170F; margin: 48px 56px; }
      p { margin: 0 0 0.8em; }
      .tldr { background: #F5F4EC; padding: 12px 14px; margin: 0 0 14px; }
      .tldr-label { font-family: 'Instrument Sans', sans-serif; font-size: 9px; font-weight: 700; letter-spacing: 0.2em; color: #8B887A; margin-bottom: 5px; }
      .tldr-text { font-size: 14px; line-height: 1.55; }
      h3 { font-family: 'Instrument Sans', sans-serif; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; margin: 1.2em 0 0.5em; }
      @media print { body { margin: 12mm 14mm; } }
    </style></head><body>
    <div style="font-family:'Instrument Sans',sans-serif; font-size:10px; font-weight:700; letter-spacing:0.22em; color:#A5A292;">MTA ADVISORY BOARD — MINUTES</div>
    <div style="font-size:15px; color:#5C594A; margin-top:6px;">${escText(date)} · Members present: ${escText(bench)}</div>
    <h1 style="font-size:30px; font-weight:500; font-style:italic; line-height:1.25; margin:22px 0 6px;">&ldquo;${escText(s.question)}&rdquo;</h1>
    <div style="font-family:'Instrument Sans',sans-serif; font-size:12px; color:#5C594A; margin-bottom:8px;">The ballot: ${escText(tallyString(entries))}</div>
    ${responsesHTML}
    ${verdictSource ? `<h2 style="font-size:22px; font-weight:500; margin:44px 0 0;">Board Verdict</h2><div style="font-size:14.5px; line-height:1.7; margin-top:14px;">${renderAnswerHTML(verdictSource)}</div>` : ''}
    ${round2HTML}
    ${s.outcome && s.outcome.label !== 'Pending' ? `<div style="margin-top:40px; border-top:1px solid #17170F; padding-top:14px;"><span style="font-family:'Instrument Sans',sans-serif; font-size:10px; font-weight:700; letter-spacing:0.16em;">OUTCOME</span><div style="font-size:14.5px; margin-top:8px;">${escText(s.outcome.label)}${s.outcome.note ? ' — ' + escText(s.outcome.note) : ''}</div></div>` : ''}
    <script>window.onload = () => setTimeout(() => window.print(), 400);<\/script>
    </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups to export the minutes.'); return; }
  w.document.write(html);
  w.document.close();
}

function closeHistoryDetail() {
  document.getElementById('history-detail').style.display = 'none';
  document.getElementById('history-list').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteHistorySession(i) {
  if (!confirm('Delete this session permanently?')) return;
  history.splice(i, 1);
  saveHistoryToLS(history);
  renderHistoryList();
}

function clearHistoryAll() {
  if (!confirm('Clear ALL session history? This cannot be undone.')) return;
  history = [];
  saveHistoryToLS(history);
  renderHistoryList();
}

// ── Edit Modal ───────────────────────────────────────────────────────────────
function openEditModal() {
  editAdvisors = JSON.parse(JSON.stringify(advisors));
  renderEditList();
  document.getElementById('edit-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
  document.body.style.overflow = '';
}

function overlayClick(e) {
  if (e.target === document.getElementById('edit-modal')) closeEditModal();
}

function renderEditList() {
  const list = document.getElementById('edit-list');
  // Render in alphabetical order, but preserve original indices so update/remove
  // still target the correct entries in editAdvisors.
  const sortedWithIdx = editAdvisors
    .map((a, i) => ({ a, i }))
    .sort((x, y) => x.a.name.localeCompare(y.a.name, 'en', { sensitivity: 'base' }));
  list.innerHTML = sortedWithIdx.map(({ a, i }) => {
    const photo = photoOverrides[a.id] || a.photo || '';
    const previewHTML = photo
      ? `<div class="edit-avatar-preview edit-avatar-photo" style="background-image:url('${photo}')"></div>`
      : `<div class="edit-avatar-preview" style="background:${a.color}">${escText(a.avatar)}</div>`;
    return `
    <div class="edit-card" id="ecard-${i}">
      <div class="edit-card-header" onclick="toggleEditCard(${i})">
        <div class="edit-card-left">
          ${previewHTML}
          <div>
            <div class="edit-card-name">${escText(a.name)}</div>
            <div class="edit-card-title-small">${escText(a.title)}</div>
          </div>
        </div>
        <div class="edit-card-actions">
          <button class="toggle-active ${a.active ? 'on' : ''}"
                  title="${a.active ? 'Active' : 'Hidden'}"
                  onclick="toggleActive(event, ${i})"></button>
          <button class="btn-remove" onclick="removeAdvisor(event, ${i})">Remove</button>
          <span class="chevron" id="chev-${i}">▾</span>
        </div>
      </div>
      <div class="edit-card-body" id="ebody-${i}">
        <div class="form-row">
          <div class="form-group">
            <label>Full Name</label>
            <input type="text" value="${escAttr(a.name)}"
                   oninput="updateField(${i},'name',this.value)" />
          </div>
          <div class="form-group">
            <label>Title / Role</label>
            <input type="text" value="${escAttr(a.title)}"
                   oninput="updateField(${i},'title',this.value)" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Avatar Initials (fallback when no photo)</label>
            <input type="text" maxlength="2" value="${escAttr(a.avatar)}"
                   oninput="updateField(${i},'avatar',this.value); updateAvatarPreview(${i})" />
          </div>
          <div class="form-group">
            <label>Accent Color</label>
            <div class="color-row">
              <input type="color" value="${a.color}" id="color-${i}"
                     oninput="updateField(${i},'color',this.value); updateAvatarPreview(${i})" />
              <input type="text" value="${a.color}" id="colorhex-${i}"
                     style="width:90px"
                     oninput="syncColorHex(${i}, this.value)" />
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>Voice (ElevenLabs voice ID)</label>
          <div class="color-row">
            <input type="text" value="${escAttr(a.voiceId || '')}" placeholder="Paste a voice ID from elevenlabs.io/voice-library"
                   oninput="updateField(${i},'voiceId',this.value.trim())" />
            <button type="button" class="btn-secondary" onclick="testVoice(${i})">Test</button>
          </div>
        </div>
        <div class="form-group">
          <label>Photo</label>
          <div class="photo-row">
            <div class="photo-preview ${photo ? 'has-photo' : ''}" id="photo-preview-${i}"
                 style="${photo ? `background-image:url('${photo}')` : `background:${a.color}`}">
              ${photo ? '' : escText(a.avatar)}
            </div>
            <div class="photo-actions">
              <input type="file" accept="image/*" id="photo-file-${i}"
                     style="display:none" onchange="onPhotoFile(event, ${i})" />
              <button type="button" class="btn-secondary"
                      onclick="document.getElementById('photo-file-${i}').click()">Upload Photo</button>
              <input type="text" placeholder="…or paste image URL" value="${escAttr(a.photo || '')}"
                     oninput="onPhotoUrl(${i}, this.value)" />
              ${photo ? `<button type="button" class="btn-link photo-clear" onclick="clearPhoto(${i})">Remove photo</button>` : ''}
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>Persona Prompt — How this advisor thinks, speaks, and advises</label>
          <textarea rows="10"
                    oninput="updateField(${i},'persona',this.value)">${escText(a.persona || '')}</textarea>
        </div>
      </div>
    </div>
  `;
  }).join('');
}

function escAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escText(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Audition a voice ID before saving it
async function testVoice(i) {
  const v = (editAdvisors[i].voiceId || '').trim();
  if (!v) { alert('Paste an ElevenLabs voice ID first.'); return; }
  stopSpeaking();
  try {
    const res = await api('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceId: v, text: `The board is in session. I'm ${editAdvisors[i].name}, and this is how I will sound when I read you my answers.` }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      alert(err.error || 'Voice test failed');
      return;
    }
    const blob = await res.blob();
    currentAudio = new Audio(URL.createObjectURL(blob));
    currentAudio.onended = stopSpeaking;
    await currentAudio.play();
  } catch (err) {
    alert('Voice test failed: ' + err.message);
  }
}

function toggleEditCard(i) {
  const body = document.getElementById(`ebody-${i}`);
  const chev = document.getElementById(`chev-${i}`);
  body.classList.toggle('open');
  chev.classList.toggle('open');
}

function toggleActive(e, i) {
  e.stopPropagation();
  editAdvisors[i].active = !editAdvisors[i].active;
  renderEditList();
}

function removeAdvisor(e, i) {
  e.stopPropagation();
  if (confirm(`Remove "${editAdvisors[i].name}" from your board?`)) {
    editAdvisors.splice(i, 1);
    renderEditList();
  }
}

function updateField(i, field, value) {
  editAdvisors[i][field] = value;
}

function updateAvatarPreview(i) {
  const card = document.getElementById(`ecard-${i}`);
  const preview = card.querySelector('.edit-avatar-preview');
  const a = editAdvisors[i];
  const photo = photoOverrides[a.id] || a.photo || '';
  if (photo) {
    preview.style.backgroundImage = `url('${photo}')`;
    preview.classList.add('edit-avatar-photo');
    preview.textContent = '';
  } else {
    preview.style.background = a.color;
    preview.style.backgroundImage = '';
    preview.classList.remove('edit-avatar-photo');
    preview.textContent = a.avatar;
  }
}

function syncColorHex(i, value) {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    editAdvisors[i].color = value;
    document.getElementById(`color-${i}`).value = value;
    updateAvatarPreview(i);
  }
}

function onPhotoFile(event, i) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    alert('Photo too large (max 5 MB). Please pick a smaller file.');
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUri = ev.target.result;
    editAdvisors[i].photo = dataUri;
    photoOverrides[editAdvisors[i].id] = dataUri;
    renderEditList();
    // re-open the same card after re-render
    setTimeout(() => {
      const body = document.getElementById(`ebody-${i}`);
      const chev = document.getElementById(`chev-${i}`);
      if (body) { body.classList.add('open'); chev?.classList.add('open'); }
    }, 0);
  };
  reader.readAsDataURL(file);
}

function onPhotoUrl(i, value) {
  editAdvisors[i].photo = value.trim();
  // For URL paste, also stage as override so visuals update without full save
  if (value.trim()) {
    photoOverrides[editAdvisors[i].id] = value.trim();
  } else {
    delete photoOverrides[editAdvisors[i].id];
  }
  updateAvatarPreview(i);
  // refresh photo preview block
  const preview = document.getElementById(`photo-preview-${i}`);
  if (preview) {
    if (value.trim()) {
      preview.style.backgroundImage = `url('${value.trim()}')`;
      preview.classList.add('has-photo');
      preview.textContent = '';
    } else {
      preview.style.backgroundImage = '';
      preview.classList.remove('has-photo');
      preview.style.background = editAdvisors[i].color;
      preview.textContent = editAdvisors[i].avatar;
    }
  }
}

function clearPhoto(i) {
  editAdvisors[i].photo = '';
  delete photoOverrides[editAdvisors[i].id];
  renderEditList();
  setTimeout(() => {
    const body = document.getElementById(`ebody-${i}`);
    const chev = document.getElementById(`chev-${i}`);
    if (body) { body.classList.add('open'); chev?.classList.add('open'); }
  }, 0);
}

function addAdvisor() {
  editAdvisors.push({
    id: 'advisor_' + Date.now(),
    name: 'New Advisor',
    title: 'Title',
    avatar: 'NA',
    photo: '',
    color: '#555555',
    active: true,
    expertise: [],
    persona: 'Describe how this advisor thinks, what frameworks they use, their communication style, and how they approach giving advice.',
  });
  renderEditList();
  const newIdx = editAdvisors.length - 1;
  setTimeout(() => {
    const body = document.getElementById(`ebody-${newIdx}`);
    const chev = document.getElementById(`chev-${newIdx}`);
    if (body) { body.classList.add('open'); chev.classList.add('open'); }
    document.getElementById(`ecard-${newIdx}`)?.scrollIntoView({ behavior: 'smooth' });
  }, 50);
}

async function saveAdvisors() {
  const btn = document.querySelector('#edit-modal .btn-primary');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  // Persist any new photoOverrides (covers deployed mode too)
  for (const a of editAdvisors) {
    if (a.photo) photoOverrides[a.id] = a.photo;
  }
  // Drop overrides for advisors no longer in the list
  const ids = new Set(editAdvisors.map(a => a.id));
  for (const k of Object.keys(photoOverrides)) {
    if (!ids.has(k)) delete photoOverrides[k];
  }
  savePhotoOverridesToLS(photoOverrides);

  try {
    const res = await api('/api/advisors', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editAdvisors),
    });

    // 403 (deployed mode) — that's OK, photoOverrides handle it
    if (!res.ok && res.status !== 403) throw new Error('Save failed');

    advisors = JSON.parse(JSON.stringify(editAdvisors));
    const activeIds = new Set(advisors.filter(a => a.active).map(a => a.id));
    selectedIds = new Set([...selectedIds].filter(id => activeIds.has(id)));
    for (const id of activeIds) selectedIds.add(id);

    renderChips();
    closeEditModal();
    if (res.status === 403) {
      // Surface a small note for awareness
      console.info('Running in deployed mode — persona changes not persisted server-side. Photos saved to this browser.');
    }
  } catch (err) {
    alert('Could not save: ' + err.message);
  } finally {
    btn.textContent = 'Save Changes';
    btn.disabled = false;
  }
}

// ── Utility ──────────────────────────────────────────────────────────────────
function highlight(el) {
  el.style.outline = '2px solid #C43D2F';
  setTimeout(() => el.style.outline = '', 1200);
}

// ── Boot ─────────────────────────────────────────────────────────────────────
init();
