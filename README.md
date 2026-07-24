# Workout Trainer

Equipment-aware workout generation and tracking. Tell it what equipment you have and what you're training today — it builds the session, tracks your sets at the gym, and knows when you hit a PR.

> **Status: early development.** The foundation is built and tested — schema with RLS, seeded exercise library, PR-detection trigger, and the full generation engine (M0–M2 complete). The first real screens (M3: equipment setup → generate → log) are in progress. Not yet usable end-to-end. Nutrition/meal planning and Spotify playback are planned as later phases.

## What it does (and will do)

- **Equipment-aware generation** — define equipment profiles ("Home Gym", "Work Gym"), pick target muscle groups and a goal, and a deterministic rule engine assembles the session from a ~870-exercise library: strict equipment matching (all required equipment, not "close enough"), movement-pattern dedup (never three bench variants in one session), compounds first, and a graceful degradation ladder when your equipment is sparse.
- **Session logging built for real gyms** — per-set logging with rest timers, previous-performance display ("what to beat"), and mid-workout exercise swaps when a machine is taken. Generation and swaps run entirely on-device; full offline logging with sync is a planned milestone (M4).
- **PR detection** — Epley estimated-1RM comparison computed in the database itself (Postgres trigger), with a high-rep guard so endurance sets don't produce nonsense PRs.
- **Programs without staleness** — a program is a schedule of day *templates* (muscle groups + goal), and concrete exercises are generated at session time against your current equipment. Imported plans (PDF/photo → LLM extraction → your review) will be stored as fixed exercise lists instead, preserved exactly as written.
- **Planned:** progress charts and adherence tracking, plan import, nutrition/meal generation tied to training data, Spotify playback.

## Architecture

```
apps/
  mobile/        Expo (React Native, TypeScript) — the app
  api/           Fastify — one job: PDF/image plan import (server-side LLM key)
packages/
  rule-engine/   Pure TypeScript generation engine — no HTTP, no DB.
                 Imported by the mobile app (on-device generation & swaps)
                 and shared with the backend.
supabase/
  migrations/    Schema, RLS policies, PR trigger (pgTAP-tested)
scripts/         Seed (free-exercise-db import) + one-off LLM tagging pass
docs/            Design docs and implementation plans
```

- **Supabase** provides Postgres, storage, and (later) auth. Every user-owned table is scoped by `user_id` with row-level security from day one — development runs against a real signed-in dev user, never a service-role bypass.
- **The rule engine is a pure package** — deterministic, unit-tested, and runs identically on-device and in Node. Generation and mid-workout swaps never require a network round-trip.
- **Offline sync (planned)** is designed around client-generated UUIDs and append-only set logging, so replay is idempotent by construction.

## Getting started

Prerequisites: Node 20+, [pnpm](https://pnpm.io), Docker (for local Supabase).

```bash
pnpm install

# Start the local Supabase stack
# Note: ports are shifted +100 from Supabase defaults (API 54421, DB 54422,
# Studio 54423) — see the comments in supabase/config.toml.
pnpm exec supabase start

# Apply migrations + run the pgTAP test suite
pnpm exec supabase db reset
pnpm exec supabase test db
```

### Seeding the exercise library

```bash
# Import ~870 exercises from free-exercise-db (public domain)
pnpm exec tsx scripts/seed-exercises.ts
```

The one-off movement-pattern/compound tagging pass requires an Anthropic API key and a human review step:

```bash
# 1. Generate tags (writes scripts/data/movement-tags-review.json)
ANTHROPIC_API_KEY=... pnpm exec tsx scripts/tag-exercises.ts

# 2. Review and hand-edit the JSON — this file is the source of truth
#    for tags and is committed after review.

# 3. Apply reviewed tags to the database
pnpm exec tsx scripts/apply-movement-tags.ts
```

Environment variables (put them in an untracked `.env`): `SUPABASE_URL` (defaults to the local stack), `SUPABASE_SERVICE_ROLE_KEY` (printed by `supabase start`), `ANTHROPIC_API_KEY` (tagging script only).

## Development

```bash
pnpm turbo run lint test    # lint + unit tests across the monorepo
pnpm exec supabase test db  # database/RLS/trigger tests (pgTAP)
```

CI runs both on every push/PR. The Supabase CLI version is pinned (locally and in CI) to keep `config.toml` behavior identical everywhere.

Design decisions live in [`docs/`](docs/) — the phase-1 design doc covers the data model, the generation engine's degradation ladder, offline sync semantics, and the PR-trigger spec; the M3 design doc covers the core-loop screens, hook architecture, and the `swapExercise()` relaxation ladder.

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| M0 | Monorepo scaffold, CI | ✅ |
| M1 | Schema, RLS, PR trigger, seed + tagging scripts | ✅ |
| M2 | Rule engine (generation, dedup, degradation ladder) | ✅ |
| M3 | Core loop — equipment setup, ad-hoc generate, session logging (PR badge, rest timer, swap) | 🔨 in progress |
| M4 | Offline queue + sync, performance cache | planned |
| M5 | Progress charts, adherence, PR celebrations, programs UI & history | planned |
| M6 | PDF/photo plan import | planned |
| M7 | Auth (Supabase) | planned |
| Later | Nutrition · Spotify | planned |

## License

No license yet — this repository is public for visibility, but all rights are reserved until a license is chosen.

## Credits

Exercise library seeded from [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (public domain).
