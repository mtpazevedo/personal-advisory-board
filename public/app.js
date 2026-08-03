// ── Storage keys ─────────────────────────────────────────────────────────────
const LS_PROFILE = 'advisoryBoard.userProfile';
const LS_HISTORY = 'advisoryBoard.history';
const LS_PHOTOS  = 'advisoryBoard.photoOverrides';

// ── State ────────────────────────────────────────────────────────────────────
let advisors = [];
let selectedIds = new Set();
let editAdvisors = [];
let responseTexts = {};
let userProfile = loadProfile();
let history = loadHistory();
let photoOverrides = loadPhotoOverrides();

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  advisors = await fetchAdvisors();
  selectedIds = new Set(advisors.filter(a => a.active).map(a => a.id));
  renderChips();
  refreshProfileBanner();
}

async function fetchAdvisors() {
  const res = await fetch('/api/advisors');
  return res.json();
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

// ── Chip rendering ───────────────────────────────────────────────────────────
function renderChips() {
  const container = document.getElementById('advisor-chips');
  container.innerHTML = sortByName(advisors.filter(a => a.active))
    .map(a => {
      const photo = effectivePhoto(a);
      const avatarHTML = photo
        ? `<span class="chip-avatar chip-avatar-photo" style="background-image:url('${photo}')"></span>`
        : `<span class="chip-avatar">${escAttr(a.avatar)}</span>`;
      return `
        <div class="advisor-chip ${selectedIds.has(a.id) ? 'selected' : ''}"
             style="--color:${a.color}"
             data-id="${a.id}"
             onclick="toggleChip('${a.id}')"
             title="${escAttr(a.name)} — ${escAttr(a.title)}">
          ${avatarHTML}
          <div>
            <div class="chip-name name-link" onclick="event.stopPropagation(); openBioModal('${a.id}')" title="About ${escAttr(a.name)}">${escText(a.name.split(' ').slice(0, 2).join(' '))}</div>
          </div>
        </div>
      `;
    }).join('');
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

  const selected = sortByName(advisors.filter(a => selectedIds.has(a.id) && a.active));

  const section = document.getElementById('responses-section');
  section.style.display = 'block';
  document.getElementById('question-echo').textContent = `"${question}"`;

  const grid = document.getElementById('responses');
  grid.innerHTML = '';
  for (const advisor of selected) {
    const card = document.createElement('div');
    card.className = 'response-card';
    card.style.setProperty('--color', advisor.color);
    const photo = effectivePhoto(advisor);
    const avatarHTML = photo
      ? `<span class="card-avatar card-avatar-photo" style="background-image:url('${photo}')"></span>`
      : `<span class="card-avatar" style="background:${advisor.color}">${escText(advisor.avatar)}</span>`;
    card.innerHTML = `
      <div class="card-header">
        ${avatarHTML}
        <div>
          <div class="card-name name-link" onclick="openBioModal('${advisor.id}')" title="About ${escAttr(advisor.name)}">${escText(advisor.name)}</div>
          <div class="card-role">${escText(advisor.title)}</div>
        </div>
        <span class="position-badge" id="pos-${advisor.id}" style="display:none"></span>
      </div>
      <div class="card-body" id="body-${advisor.id}">
        <span class="thinking" style="--color:${advisor.color}">Thinking</span>
      </div>
    `;
    grid.appendChild(card);
  }

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  responseTexts = {};
  document.getElementById('synthesis-section').style.display = 'none';

  await Promise.all(selected.map(a => streamResponse(a, question)));

  let synthesisText = '';
  if (selected.length > 1) {
    synthesisText = await synthesizeBoard(question, selected);
  }

  // Save session to history
  const session = {
    id: 'sess_' + Date.now(),
    ts: Date.now(),
    question,
    advisors: selected.map(a => ({ id: a.id, name: a.name, title: a.title, color: a.color })),
    responses: { ...responseTexts },
    synthesis: synthesisText || '',
  };
  history.unshift(session);
  if (history.length > 100) history = history.slice(0, 100);
  saveHistoryToLS(history);

  btn.disabled = false;
  btn.innerHTML = 'Ask the Board <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
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

function renderBallotHTML(entries) {
  const voted = entries.filter(e => e.pos);
  if (!voted.length) return '';
  const counts = { YES: 0, NO: 0, CONDITIONAL: 0 };
  voted.forEach(e => counts[e.pos.vote]++);
  const abstained = entries.length - voted.length;
  const parts = [];
  if (counts.YES) parts.push(`${counts.YES} YES`);
  if (counts.NO) parts.push(`${counts.NO} NO`);
  if (counts.CONDITIONAL) parts.push(`${counts.CONDITIONAL} CONDITIONAL`);
  if (abstained) parts.push(`${abstained} no vote`);
  const chips = voted.map(e => `
    <span class="ballot-chip pos-${e.pos.vote.toLowerCase()}" style="--color:${e.color}" title="${escAttr(e.pos.reason)}">
      ${escText(e.name.split(' ').slice(0, 2).join(' '))} · ${e.pos.vote}
    </span>
  `).join('');
  return `
    <div class="ballot">
      <div class="ballot-title">Board ballot <span class="ballot-summary">${parts.join(' · ')}</span></div>
      <div class="ballot-chips">${chips}</div>
    </div>
  `;
}

async function streamResponse(advisor, question) {
  const bodyEl = document.getElementById(`body-${advisor.id}`);
  bodyEl.innerHTML = '';
  let fullText = '';

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        advisorId: advisor.id,
        userProfile,
        history: history.slice(0, 5),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      bodyEl.innerHTML = `<span style="color:#c0392b">Error: ${err.error}</span>`;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
      bodyEl.innerHTML = renderMarkdown(fullText);
    }
    responseTexts[advisor.id] = fullText;

    // Formal vote: strip the POSITION line from the body, show it as a badge
    const pos = parsePosition(fullText);
    if (pos) {
      bodyEl.innerHTML = renderMarkdown(stripPositionLine(fullText));
      const badge = document.getElementById(`pos-${advisor.id}`);
      if (badge) {
        badge.textContent = pos.vote;
        badge.className = `position-badge pos-${pos.vote.toLowerCase()}`;
        badge.title = pos.reason;
        badge.style.display = 'inline-flex';
      }
    }
  } catch (err) {
    bodyEl.innerHTML = `<span style="color:#c0392b">Error: ${err.message}</span>`;
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
  synthesisBody.innerHTML = '<span class="thinking" style="--color:#1A1A1A">Tallying the board verdict</span>';

  // Render the formal ballot from the independently cast POSITION lines
  document.getElementById('ballot').innerHTML = renderBallotHTML(
    selected.map(a => ({ name: a.name, color: a.color, pos: parsePosition(responseTexts[a.id]) }))
  );

  setTimeout(() => synthesisSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

  const responses = selected.map(a => ({
    name: a.name,
    title: a.title,
    expertise: a.expertise || [],
    text: responseTexts[a.id] || '',
  }));

  let fullText = '';
  try {
    const res = await fetch('/api/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, responses, userProfile }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      synthesisBody.innerHTML = `<span style="color:#c0392b">Error: ${err.error}</span>`;
      return '';
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
      synthesisBody.innerHTML = renderMarkdown(fullText);
    }

    // After streaming completes: parse weights, render the vote panel,
    // and re-render the prose with the Advisor Relevance block stripped out.
    const weights = parseAdvisorWeights(fullText);
    if (weights && weights.length) {
      const votePanel = renderVotePanel(weights, selected);
      const stripped = stripAdvisorRelevanceBlock(fullText);
      synthesisBody.innerHTML = votePanel + renderMarkdown(stripped);
    }
  } catch (err) {
    synthesisBody.innerHTML = `<span style="color:#c0392b">Error: ${err.message}</span>`;
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

// ── Member Bio & Board Picks ─────────────────────────────────────────────────
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
  const a = advisors.find(x => x.id === id);
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

function openPicksModal() {
  const body = document.getElementById('picks-body');
  const withPicks = sortByName(advisors.filter(a => a.active && a.picks && a.picks.length));
  if (!withPicks.length) {
    body.innerHTML = '<p class="bio-text">No picks yet.</p>';
  } else {
    body.innerHTML = withPicks.map(a => {
      const photo = effectivePhoto(a);
      const avatarHTML = photo
        ? `<span class="card-avatar card-avatar-photo" style="background-image:url('${photo}')"></span>`
        : `<span class="card-avatar" style="background:${a.color}">${escText(a.avatar)}</span>`;
      return `
        <div class="picks-advisor" style="--color:${a.color}">
          <div class="picks-advisor-header name-link" onclick="closePicksModal(); openBioModal('${a.id}')" title="About ${escAttr(a.name)}">
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
  document.getElementById('picks-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closePicksModal() {
  document.getElementById('picks-modal').style.display = 'none';
  document.body.style.overflow = '';
}

function picksOverlayClick(e) {
  if (e.target === document.getElementById('picks-modal')) closePicksModal();
}

// ── New Question ─────────────────────────────────────────────────────────────
function newQuestion() {
  document.getElementById('responses-section').style.display = 'none';
  document.getElementById('synthesis-section').style.display = 'none';
  document.getElementById('question').value = '';
  document.getElementById('question').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Profile Modal ────────────────────────────────────────────────────────────
const PROFILE_FIELDS = [
  'name', 'pronouns', 'lifeStage', 'location', 'profession', 'industry',
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

// ── History View ─────────────────────────────────────────────────────────────
function openHistoryView() {
  document.getElementById('main-ask').style.display = 'none';
  document.getElementById('main-history').style.display = 'block';
  document.getElementById('history-detail').style.display = 'none';
  renderHistoryList();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function closeHistoryView() {
  document.getElementById('main-history').style.display = 'none';
  document.getElementById('main-ask').style.display = 'flex';
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
          <div class="history-card-meta">${ds} · ${ts}</div>
          <button class="btn-remove history-delete" onclick="event.stopPropagation(); deleteHistorySession(${i})">Delete</button>
        </div>
        <div class="history-card-question">${escText(s.question)}</div>
        <div class="history-card-pills">${advisorPills}</div>
      </div>
    `;
  }).join('');
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
    const ad = advisorById(advId);
    const photo = effectivePhoto({ id: advId, photo: ad.photo });
    const avatarHTML = photo
      ? `<span class="card-avatar card-avatar-photo" style="background-image:url('${photo}')"></span>`
      : `<span class="card-avatar" style="background:${ad.color}">${escText(ad.avatar || ad.name.slice(0,2).toUpperCase())}</span>`;
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
        <div class="card-body">${renderMarkdown(pos ? stripPositionLine(text) : (text || ''))}</div>
      </div>
    `;
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
      bodyHTML = votePanel + renderMarkdown(stripAdvisorRelevanceBlock(s.synthesis));
    } else {
      bodyHTML = renderMarkdown(s.synthesis);
    }
    synthesisHTML = `
      <div class="synthesis-section" style="display:block">
        <div class="synthesis-card">
          <div class="synthesis-header">
            <div class="synthesis-icon-wrap">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18"/><path d="M3 12h18"/><circle cx="12" cy="12" r="10"/></svg>
            </div>
            <div>
              <div class="synthesis-title">Board Verdict</div>
              <div class="synthesis-subtitle">From this session</div>
            </div>
          </div>
          ${ballotHTML}
          <div class="synthesis-body">${bodyHTML}</div>
        </div>
      </div>`;
  }

  detail.innerHTML = `
    <div class="history-detail-header">
      <button class="btn-link" onclick="closeHistoryDetail()">← Back to history</button>
      <div class="history-detail-meta">${ds} · ${ts}</div>
    </div>
    <div class="question-echo">"${escText(s.question)}"</div>
    <div class="responses-grid">${responsesHTML}</div>
    ${synthesisHTML}
  `;
  document.getElementById('history-list').style.display = 'none';
  detail.style.display = 'block';
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    const res = await fetch('/api/advisors', {
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
  el.style.outline = '2px solid #e74c3c';
  setTimeout(() => el.style.outline = '', 1200);
}

// ── Boot ─────────────────────────────────────────────────────────────────────
init();
