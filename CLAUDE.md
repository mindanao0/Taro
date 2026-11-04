# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Gothic Ivory Rose Tarot: a 78-card RWS-structured deck plus a static Thai-language card-reading website. Content (UI copy, card meanings, docs) is Thai; keep new user-facing text in Thai. Production is GitHub Pages at `ivoryrosetarot.online` (`CNAME`); pushing to `main` deploys.

## Commands

Python: Pillow only (`pip install -r requirements.txt`). Node >=22.13: `npm install` (dev deps: wrangler, playwright, axe-core). The site itself still has no build step.

- Serve locally: `python3 -m http.server 8000` (opening `index.html` via `file://` fails because it fetches JSON and uses ES modules)
- All fast tests (node + python, one line each): `npm test` (= `node scripts/test-all.mjs`); a single test is run directly, e.g. `node scripts/reading-core.test.mjs`, `node api/test/auth.test.mjs`
- Validate deck data/images/checksums: `python3 scripts/package_deck.py --check-only`
- Real Workers runtime + local D1: `npm run test:workerd`
- Browser tests (need `npx playwright install chromium` once): `npm run test:e2e`, `npm run test:a11y`
- What is still open before launch: `npm run launch-check` (`docs/NEXT_STEPS_TH.md` is the ordered checklist)
- CI: `.github/workflows/test.yml` (fast tests, workerd, wrangler `--dry-run` bundles, then e2e + a11y)
- Deploy: `docs/DEPLOY_API_TH.md` (member API), `docs/DEPLOY_TH.md` (question log / click sequences), `docs/RUNBOOK_TH.md` (operations)

## Architecture

**Frontend** is a single file, `index.html` (~700 lines, inline CSS and one `<script type="module">`). It fetches `data/cards.public.json`, `data/spreads.json` and `data/position_meanings_major.json` (the last is optional; a failed load is tolerated), and imports logic from `scripts/reading-core.mjs` (shuffling/drawing without repeats via `randomBelow`/`shuffled`, `meaningFor`) and `scripts/reading-guide.mjs` (spread framing, card-pair readings, `POSITIONS`). Card art is served from `assets/web/` (WebP); `assets/cards/` holds the PNG originals. These `.mjs` modules are shared by the site and the tests, so keep them DOM-free.

**Data pipeline** (`scripts/*.py`): the data files are generated, and several are derived from others:
- `build_data.py` → `data/cards.json` (source of truth, includes generation prompts), `suits.json`, `generation_jobs.json`
- `enrich_data.py`, `finalize_editorial.py`, `add_thai_symbols.py` → post-process `cards.json` and regenerate `cards.public.json` (the trimmed copy the site loads), `art_revisions.json`, `sources.json`
- `package_deck.py` → `manifest.json`, `cards.csv`, `docs/02_CARD_MEANINGS_TH.md`, `previews/catalog.html`, `SHA256SUMS.txt`; `--check-only` only validates (78 unique IDs, 22 major / 56 minor, image sizes, checksums)
- `build_guide.py` → `START_HERE.html`

If you edit `data/cards.json` or any card image, `cards.public.json` and `SHA256SUMS.txt` must be regenerated, otherwise the site and the check go out of sync. Card IDs look like `major-13`; `major-13` and `major-18` are excluded from `generation_jobs.json` (they are the approved reference cards).

**Member API (optional, off while `API_URL` in `scripts/config.mjs` is empty)**: `api/` is a separate Cloudflare Worker (`api/wrangler.toml`, D1 migrations in `api/migrations/`, handlers in `api/lib/`) for email/Google/LINE/Facebook login, saved readings, favourites, card of the day and LINE reminders. It must be served from a subdomain of the site (cookies). The browser side is `scripts/api-client.mjs`, `account.html`, and `privacy.html`/`terms.html` (still drafts with `[placeholders]`, see `launch-check`). Design docs: `docs/07_AUTH_BACKEND_PLAN_TH.md`, `docs/08_BACKEND_ARCHITECTURE_TH.md`.

**Question log (optional)**: `worker/index.js` is a Cloudflare Worker (config in `wrangler.toml`, migrations in `migrations/`) that stores only the question text and spread id in D1, with no IP or user agent. It accepts POST only, from origins in its `ORIGINS` set (`https://ivoryrosetarot.online` and `www.`), and caps the question at 300 chars. `index.html` posts to it only when `const LOG_URL` (near line 624) is non-empty; while empty, the site sends nothing, and the footer privacy text changes depending on that value. Any extra environment (e.g. a UAT domain) must be added to `ORIGINS` or its logging requests will be rejected with 403.

## Conventions worth knowing

- Meaning text is original modern editorial Thai, not a translation of Waite; don't claim predictive certainty in copy (see README scope section and `docs/05_SOURCES_AND_PROVENANCE.md`).
- Licensing is split: code (`index.html`, `scripts/`) is MIT; card images and `data/`/`docs/` text are not covered by that license.
- `docs/04_WEB_HANDOFF_TH.md` documents the data schema (`data/types.ts` has the types).
