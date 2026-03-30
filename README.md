# Personal Advisory Board

A private web app where you can ask questions and receive responses from your curated board of advisors — each one grounded in their real public thinking, frameworks, and voice.

**Current Board:**
- Naval Ravikant — Entrepreneur & Philosopher
- Bill Gurley — General Partner, Benchmark Capital
- Chamath Palihapitiya — Founder, Social Capital
- Daniela Amodei — President & Co-Founder, Anthropic
- Dario Amodei — CEO & Co-Founder, Anthropic
- Stanford SEP Faculty — GSB Executive Program Collective Wisdom
- Michelle Obama — Author, Leader & Former First Lady

---

## First-Time Setup

**Step 1 — Run the setup script** (installs Node.js and dependencies):
```bash
cd "/Users/mtazevedo/Documents/Advisory Board"
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
cd "/Users/mtazevedo/Documents/Advisory Board"
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
MODEL=claude-opus-4-6     ← highest quality (default)
MODEL=claude-sonnet-4-6   ← faster, slightly less depth
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
