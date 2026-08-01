# Board Refresh Playbook

How to refresh the advisory board's knowledge so every member reflects their most recent public thinking. Run this monthly, or whenever you want. In Claude Code, from any directory:

> "Refresh the advisory board following the REFRESH_PLAYBOOK.md in Claude Projects/Advisory Board"

## What a refresh does

1. **Research each board member** (parallel web research, one agent per member). For living members: public appearances, interviews, podcasts, books, essays, LinkedIn/X posts, company results, from the last refresh date forward. For deceased members (Rosa, Lispector, Sakamoto): new editions, translations, adaptations, exhibitions, scholarship. For the Stanford SEP composite: verify the current faculty roster on gsb.stanford.edu.
2. **Update `advisors.json` personas.** Each persona ends with a section marked:

   ```
   --- RECENT VIEWS & ACTIVITY (updated YYYY-MM) ---
   ```

   Replace that section (everything from the marker to the end of the persona) with the new findings. Never touch the base persona above the marker unless something structural changed (job change, death, new book that redefines them). Keep the section under ~300 words, second person ("Where your head is..."), with real dated quotes.
3. **Check for structural changes** and update the base persona + `title` field when someone changes jobs (e.g. Gurley left Benchmark for the P3 Institute in 2026).
4. **Update the SEP faculty list** in BOTH `server.js` and `api/synthesize.js` (search for "SEP 20") if the roster changed.
5. **Refresh `bio` and `picks` fields** if there's a new book, a new signature quote, or a stale fact in the mini-bio.
6. **Rules of evidence:** only include things actually found via search with real sources and dates. Never invent quotes. If nothing new was found for a member, keep the old section and just update the date stamp.
7. **Restart the local server** if it's running (prompt constants load at startup).

## Conventions

- Update marker: `--- RECENT VIEWS & ACTIVITY (updated YYYY-MM) ---` (regex-replaceable, idempotent).
- Headshots live in `public/headshots/<id>.<ext>`, referenced via the `photo` field. New members: try Wikipedia REST API thumbnail first, then the person's company site.
- New members need: id, name, title, avatar initials, photo, color, expertise[], persona (base + RECENT section), bio, picks[].
- Last full refresh: **2026-08-01** (all 12 members refreshed; Bloisi's RECENT VIEWS & ACTIVITY section added for the first time; SEP faculty roster re-verified with no changes).
