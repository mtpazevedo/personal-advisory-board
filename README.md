# Personal Advisory Board

A private web app where you can ask questions and receive responses from your curated board of advisors — each one grounded in their real public thinking, frameworks, and voice.

**Current Board (12):**
- Naval Ravikant — Entrepreneur & Philosopher
- Bill Gurley — Founder, P3 Institute (fmr. GP, Benchmark)
- Chamath Palihapitiya — Founder, Social Capital
- Daniela Amodei — President & Co-Founder, Anthropic
- Dario Amodei — CEO & Co-Founder, Anthropic
- Fabricio Bloisi — Group CEO, Prosus & Naspers
- Stanford SEP Faculty — GSB Executive Program Collective Wisdom
- Michelle Obama — Author, Leader & Former First Lady
- Joao Guimaraes Rosa — Brazilian Writer & Diplomat
- Clarice Lispector — Brazilian Writer
- Ryuichi Sakamoto — Composer, Musician & Activist
- Yvon Chouinard — Founder, Patagonia

Advisors answer independently, in sealed rooms: no coordinating, no echoing, conflict welcome. Click any member's name for a mini-bio.

**How a session works:**
1. **Round One (sealed rooms).** Each selected member answers alone and casts a formal vote (YES / NO / CONDITIONAL). The Chair issues a weighted **Board Verdict**.
2. **Round Two (open debate, optional).** Click "Open the debate": every member sees the ballot and the others' arguments, and may hold or flip. The Chair rules on the final ballot, naming who moved and why.
3. **Follow-ups.** Push back on any single advisor in a thread under their card.
4. **Quorum mode.** Toggle next to the ask button: the Chair convenes only the 5-6 most relevant members plus one deliberate counterpoint, instead of the full board.
5. **The record.** History keeps every session on your device. Record what actually happened in the "What happened?" box, then run **Board Review** to have the Chair audit which calls aged well.
6. **Reading Room.** What the board is reading, saying, and listening to, fed by `reading.json` and refreshed weekly by a cloud routine (see `REFRESH_PLAYBOOK.md`).

Personas carry a dated `RECENT VIEWS & ACTIVITY` section refreshed monthly by a scheduled cloud agent (see `REFRESH_PLAYBOOK.md`). After either routine runs, `git pull` locally to get the update.

---

## Sharing with friends (deployed mode)

The app deploys to Vercel. Set these environment variables in the Vercel project:

```
ANTHROPIC_API_KEY    required — every question spends your API credits
BOARD_ACCESS_CODE    recommended — the shared code friends type to enter
ELEVENLABS_API_KEY   optional — enables advisor voices
```

With `BOARD_ACCESS_CODE` set, the site shows an access gate; give friends the URL plus the code. Each visitor's profile, history, and outcomes live in their own browser (localStorage), so friends get their own private board sessions on your deployment. Leave `BOARD_ACCESS_CODE` unset locally and the gate stays off.

---

## First-Time Setup

**Step 1 — Run the setup script** (installs Node.js and dependencies):
```bash
cd "/Users/mtazevedo/Documents/Claude/Claude Projects/Advisory Board"
bash setup.sh
```

**Step 2 — Add your Anthropic API key:**
Open the `.env` file and paste your key:
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```
Get a key at https://console.anthropic.com

**Step 3 — Start the app:**
```bash
npm start
```

**Step 4 — Open in browser:**
```
http://localhost:3000
```

---

## Daily Use

```bash
cd "/Users/mtazevedo/Documents/Claude/Claude Projects/Advisory Board"
npm start
```
Then go to http://localhost:3000

---

## Editing Your Board (Monthly Updates)

Click **Edit Board** in the top-right corner to:
- Add or remove advisors
- Update their name, title, and accent color
- Edit their **Persona Prompt** — this is the most important field. It tells the AI how that person thinks, what frameworks they use, and how they communicate.
- Toggle advisors on/off without deleting them

All changes are saved to `advisors.json` — a plain text file you can also edit directly.

---

## Customizing the AI Model

Open `.env` and change the `MODEL` line:
```
MODEL=claude-opus-5     ← highest quality (default)
MODEL=claude-sonnet-5   ← faster, slightly less depth
```

---

## Files

```
Advisory Board/
├── server.js          ← Node.js server
├── advisors.json      ← All advisor personas (edit here)
├── public/
│   ├── index.html     ← Web interface
│   ├── style.css      ← Styles
│   └── app.js         ← Frontend logic
├── .env               ← Your API key (never share this)
├── package.json
└── setup.sh           ← One-time setup script
```
