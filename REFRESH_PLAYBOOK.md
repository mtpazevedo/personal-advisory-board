# Board Refresh Playbook

How to refresh the advisory board's knowledge so every member reflects their most recent public thinking. Run this monthly, or whenever you want. In Claude Code, from any directory:

> "Refresh the advisory board following the REFRESH_PLAYBOOK.md in Claude Projects/Advisory Board"

## What a refresh does

1. **Research each board member** (parallel web research, one agent per member). For living members: public appearances, interviews, podcasts, books, essays, LinkedIn/X posts, company results, from the last refresh date forward. For deceased members (Rosa, Lispector, Sakamoto): new editions, translations, adaptations, exhibitions, scholarship. For the Stanford SEP composite: verify the current faculty roster on gsb.stanford.edu.
2. **Update `advisors.json` personas.** Each persona ends with a section marked:

   ```
   --- RECENT VIEWS & ACTIVITY (updated YYYY-MM) ---
   ```

   Replace that section (everything from the marker to the end of the persona) with the new findings. Never touch the base persona above the marker unless something structural changed (job change, death, new book that redefines them). In particular, NEVER modify the `--- HOW YOU THINK (YOUR SHAPE ON THE PAGE) ---` section: it defines each advisor's unique cognitive style and answer shape, and it is deliberately different for every member. Keep the RECENT section under ~300 words, second person ("Where your head is..."), with real dated quotes.
3. **Check for structural changes** and update the base persona + `title` field when someone changes jobs (e.g. Gurley left Benchmark for the P3 Institute in 2026).
4. **Update the SEP faculty list** in `lib/prompts.js` (search for "SEP 20") if the roster changed. It is the single source of prompts for both the local server and the Vercel functions.
5. **Refresh `bio` and `picks` fields** if there's a new book, a new signature quote, or a stale fact in the mini-bio.
6. **Rules of evidence:** only include things actually found via search with real sources and dates. Never invent quotes. If nothing new was found for a member, keep the old section and just update the date stamp.
7. **Restart the local server** if it's running (prompt constants load at startup).

## Weekly Reading Room refresh

Separate from the monthly persona refresh. The Reading Room page is fed by `reading.json` at the repo root and should be refreshed WEEKLY by the cloud routine "Board weekly reading refresh" (or manually with: "Refresh the Reading Room following REFRESH_PLAYBOOK.md").

1. Research each member's last 1-2 weeks: new essays, podcast episodes, interviews, videos, posts, book mentions. For the deceased members: new editions, performances, exhibitions, tributes. 2-4 items per member; fewer or zero if nothing verifiable was found.
2. Rewrite `reading.json`:

   ```json
   {
     "updatedAt": "YYYY-MM-DD",
     "items": [
       { "advisorId": "naval", "type": "podcast", "title": "…", "url": "https://…", "note": "1-2 sentences.", "date": "YYYY-MM" }
     ]
   }
   ```

   Types: book, article, essay, podcast, video, interview, music, exhibition, quote. Keep items from previous weeks if still recent (drop anything older than ~2 months, except for the deceased members where a slower cultural cadence is fine). Order newest first. Validate the JSON parses.
3. Rules of evidence are the same as the persona refresh: only real items found via search, with real URLs. Never invent. No em dashes in notes.
4. Commit and push to main so the deployed app picks it up.

## Conventions

- Update marker: `--- RECENT VIEWS & ACTIVITY (updated YYYY-MM) ---` (regex-replaceable, idempotent).
- Headshots live in `public/headshots/<id>.<ext>`, referenced via the `photo` field. New members: try Wikipedia REST API thumbnail first, then the person's company site.
- New members need: id, name, title, avatar initials, photo, color, expertise[], persona (base + RECENT section), bio, picks[].
- Last full refresh: **2026-08-01** (all 12 members refreshed; Bloisi's RECENT VIEWS & ACTIVITY section added for the first time; SEP faculty roster re-verified with no changes).
