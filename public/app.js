// ── State ────────────────────────────────────────────────────────────────────
let advisors = [];
let selectedIds = new Set();
let editAdvisors = []; // working copy for edit modal
let responseTexts = {}; // stores full text of each advisor response for synthesis

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  advisors = await fetchAdvisors();
  selectedIds = new Set(advisors.filter(a => a.active).map(a => a.id));
  renderChips();
}

async function fetchAdvisors() {
  const res = await fetch('/api/advisors');
  return res.json();
}

// ── Chip rendering ────────────────────────────────────────────────────────────
function renderChips() {
  const container = document.getElementById('advisor-chips');
  container.innerHTML = advisors
    .filter(a => a.active)
    .map(a => `
      <div class="advisor-chip ${selectedIds.has(a.id) ? 'selected' : ''}"
           style="--color:${a.color}"
           data-id="${a.id}"
           onclick="toggleChip('${a.id}')"
           title="${a.name} — ${a.title}">
        <span class="chip-avatar">${a.avatar}</span>
        <div>
          <div class="chip-name">${a.name.split(' ').slice(0, 2).join(' ')}</div>
        </div>
      </div>
    `).join('');
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

// ── Keyboard shortcut ─────────────────────────────────────────────────────────
function handleKey(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    askBoard();
  }
}

// ── Ask the Board ─────────────────────────────────────────────────────────────
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

  const selected = advisors.filter(a => selectedIds.has(a.id) && a.active);

  // Show response section
  const section = document.getElementById('responses-section');
  section.style.display = 'block';
  document.getElementById('question-echo').textContent = `"${question}"`;

  // Build cards
  const grid = document.getElementById('responses');
  grid.innerHTML = '';
  for (const advisor of selected) {
    const card = document.createElement('div');
    card.className = 'response-card';
    card.style.setProperty('--color', advisor.color);
    card.innerHTML = `
      <div class="card-header">
        <span class="card-avatar" style="background:${advisor.color}">${advisor.avatar}</span>
        <div>
          <div class="card-name">${advisor.name}</div>
          <div class="card-role">${advisor.title}</div>
        </div>
      </div>
      <div class="card-body" id="body-${advisor.id}">
        <span class="thinking" style="--color:${advisor.color}">Thinking</span>
      </div>
    `;
    grid.appendChild(card);
  }

  // Smooth scroll to responses
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Reset response storage
  responseTexts = {};
  document.getElementById('synthesis-section').style.display = 'none';

  // Fire all advisor streams in parallel
  await Promise.all(selected.map(a => streamResponse(a, question)));

  // Synthesize board recommendation (only if multiple advisors)
  if (selected.length > 1) {
    await synthesizeBoard(question, selected);
  }

  btn.disabled = false;
  btn.innerHTML = 'Ask the Board <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
}

async function streamResponse(advisor, question) {
  const bodyEl = document.getElementById(`body-${advisor.id}`);
  bodyEl.innerHTML = '';
  let fullText = '';

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, advisorId: advisor.id }),
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
  } catch (err) {
    bodyEl.innerHTML = `<span style="color:#c0392b">Error: ${err.message}</span>`;
  }
}

// ── Markdown renderer (minimal but clean) ────────────────────────────────────
function renderMarkdown(text) {
  // Escape HTML first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr>');

  // Lists
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

  // Paragraphs (double newline → paragraph break)
  html = html
    .split(/\n{2,}/)
    .map(para => {
      const t = para.trim();
      if (!t) return '';
      if (t.startsWith('<h3>') || t.startsWith('<ul>') || t.startsWith('<li>')) return t;
      return `<p>${t.replace(/\n/g, '<br>')}</p>`;
    })
    .join('');

  return html;
}

// ── Board Synthesis ───────────────────────────────────────────────────────────
async function synthesizeBoard(question, advisors) {
  const synthesisSection = document.getElementById('synthesis-section');
  const synthesisBody = document.getElementById('synthesis-body');
  synthesisSection.style.display = 'block';
  synthesisBody.innerHTML = '<span class="thinking" style="--color:#1A1A1A">Synthesizing board recommendation</span>';

  // Smooth scroll to synthesis
  setTimeout(() => synthesisSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

  const responses = advisors.map(a => ({
    name: a.name,
    title: a.title,
    expertise: a.expertise || [],
    text: responseTexts[a.id] || '',
  }));

  try {
    const res = await fetch('/api/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, responses }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      synthesisBody.innerHTML = `<span style="color:#c0392b">Error: ${err.error}</span>`;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
      synthesisBody.innerHTML = renderMarkdown(fullText);
    }
  } catch (err) {
    synthesisBody.innerHTML = `<span style="color:#c0392b">Error: ${err.message}</span>`;
  }
}

// ── New Question ──────────────────────────────────────────────────────────────
function newQuestion() {
  document.getElementById('responses-section').style.display = 'none';
  document.getElementById('synthesis-section').style.display = 'none';
  document.getElementById('question').value = '';
  document.getElementById('question').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Edit Modal ────────────────────────────────────────────────────────────────
function openEditModal() {
  editAdvisors = JSON.parse(JSON.stringify(advisors)); // deep copy
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
  list.innerHTML = editAdvisors.map((a, i) => `
    <div class="edit-card" id="ecard-${i}">
      <div class="edit-card-header" onclick="toggleEditCard(${i})">
        <div class="edit-card-left">
          <div class="edit-avatar-preview" style="background:${a.color}">${a.avatar}</div>
          <div>
            <div class="edit-card-name">${a.name}</div>
            <div class="edit-card-title-small">${a.title}</div>
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
            <input type="text" value="${esc(a.name)}"
                   oninput="updateField(${i},'name',this.value)" />
          </div>
          <div class="form-group">
            <label>Title / Role</label>
            <input type="text" value="${esc(a.title)}"
                   oninput="updateField(${i},'title',this.value)" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Avatar Initials</label>
            <input type="text" maxlength="2" value="${esc(a.avatar)}"
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
          <label>Persona Prompt — How this advisor thinks, speaks, and advises</label>
          <textarea rows="8"
                    oninput="updateField(${i},'persona',this.value)">${esc(a.persona)}</textarea>
        </div>
      </div>
    </div>
  `).join('');
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
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
  preview.style.background = a.color;
  preview.textContent = a.avatar;
}

function syncColorHex(i, value) {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    editAdvisors[i].color = value;
    document.getElementById(`color-${i}`).value = value;
    updateAvatarPreview(i);
  }
}

function addAdvisor() {
  editAdvisors.push({
    id: 'advisor_' + Date.now(),
    name: 'New Advisor',
    title: 'Title',
    avatar: 'NA',
    color: '#555555',
    active: true,
    persona: 'Describe how this advisor thinks, what frameworks they use, their communication style, and how they approach giving advice.',
  });
  renderEditList();
  // Auto-open the new card
  const newIdx = editAdvisors.length - 1;
  setTimeout(() => {
    const body = document.getElementById(`ebody-${newIdx}`);
    const chev = document.getElementById(`chev-${newIdx}`);
    if (body) { body.classList.add('open'); chev.classList.add('open'); }
    document.getElementById(`ecard-${newIdx}`)?.scrollIntoView({ behavior: 'smooth' });
  }, 50);
}

async function saveAdvisors() {
  const btn = document.querySelector('.btn-primary');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  try {
    const res = await fetch('/api/advisors', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editAdvisors),
    });
    if (!res.ok) throw new Error('Save failed');

    advisors = JSON.parse(JSON.stringify(editAdvisors));
    // Re-sync selectedIds — remove any that no longer exist or are inactive
    const activeIds = new Set(advisors.filter(a => a.active).map(a => a.id));
    selectedIds = new Set([...selectedIds].filter(id => activeIds.has(id)));
    // Add newly active advisors
    for (const id of activeIds) selectedIds.add(id);

    renderChips();
    closeEditModal();
  } catch (err) {
    alert('Could not save: ' + err.message);
  } finally {
    btn.textContent = 'Save Changes';
    btn.disabled = false;
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────
function highlight(el) {
  el.style.outline = '2px solid #e74c3c';
  setTimeout(() => el.style.outline = '', 1200);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
