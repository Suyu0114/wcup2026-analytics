# World Cup 2026 Analytics — Web (P5)

Next.js (App Router) + Tailwind frontend, bilingual **zh-TW / en**. Surfaces the existing
P1/P2/P3 outputs; it adds **no model and no ETL**, and never writes to the DB.

> Spec / contract: [../docs/P5-spec.md](../docs/P5-spec.md). Engineering guide: [../CLAUDE.md](../CLAUDE.md).

## Quick start

```bash
npm install --prefix web
cp web/.env.example web/.env.local   # fill SUPABASE_URL / SUPABASE_SERVICE_KEY
npm run dev --prefix web             # http://localhost:3000 → /zh-TW
```

| Task | Command |
|---|---|
| Dev | `npm run dev --prefix web` |
| Test (vitest, offline) | `npm test --prefix web` |
| Build (incl. TS type-check) | `npm run build --prefix web` |
| Regenerate golden vectors | `python web/tests/fixtures/gen_golden.py` (with repo root on `PYTHONPATH`) |

The app builds **without** Supabase credentials — data helpers return a graceful "unavailable"
state (spec §6.6), so pages render empty states instead of crashing.

## Architecture (spec §2)

- **Data access is server-only.** `SUPABASE_SERVICE_KEY` is read in `lib/supabaseServer.ts`
  (guarded by `import 'server-only'`) and **must never** be exposed to the client — do not
  prefix it with `NEXT_PUBLIC_` (TU11). Server Components and `app/api/*` route handlers read
  the DB; the browser only calls our own API.
- **Model is always shown alongside the market** de-vig probability and tagged *experimental*,
  never as a standalone "answer" (`components/ModelVsMarket.tsx`; spec D5 / trap #7).
- **EV value path is isolated from the model.** The user-odds arithmetic lives in `lib/value.ts`
  (a port of `engine/value.py`, model-free, no `novig`). De-vig happens server-side in
  `lib/devig.ts`. The value verdict consumes only the Pinnacle de-vig probability (TV4 / D5).

## i18n

`next-intl` with locale routing (`/zh-TW` default, `/en`). UI strings live in
`messages/{zh-TW,en}.json` (keys must stay one-to-one — enforced by `tests/i18n.test.ts`).
Team names come from the curated `teams.name_zh` / `name_en` columns — **never machine-translated**
(spec §3.2); `name_zh` null falls back to `name_en` with a banner.

## Deploy

Vercel, **Root Directory = `web`**. Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` as project
secrets (service key server-only). Data pages use time-based ISR (`revalidate = 1800`); on-demand
revalidation after ETL is deferred to v1.1 (spec §2 / Issue 2).
