# Workout Trainer — Design Doc (Phase 1: Generation & Tracking)

## Overview

This is the first of three planned sub-projects for a personal training app inspired by
LiftOff: **workout generation and tracking**. Nutrition/meal generation (tied to workout
data) and Spotify in-app playback are separate future sub-projects, built in that order,
each with its own design doc.

This phase delivers: equipment-aware workout generation, session logging (sets/reps/weight,
rest timer, exercise swap, PR detection), progress tracking, and importing existing workout
plans from PDF/text/image. Exercise instructional videos are explicitly deferred.

## Scope

**In scope:**
- Multi-user data model (built now), but the app runs against a single hardcoded dev user
  until Supabase Auth is wired in.
- Equipment-aware, rule-based (non-LLM) workout generation.
- Lightweight recurring program templates + ad hoc single-session generation.
- Importing an existing plan from PDF/text/image via LLM extraction, with a user-reviewed
  draft step before anything is saved.
- Session logging: sets/reps/weight, rest timer, previous-performance display, mid-workout
  exercise swap, PR detection.
- Progress tracking: workout history, per-exercise progress charts, streaks.
- Offline logging: sets, swaps, and rest timers work with no connectivity once a session has
  been generated; syncs on reconnect.

**Explicitly out of scope for this phase:**
- Exercise instructional videos.
- Nutrition/meal generation.
- Spotify integration.
- Real Supabase Auth (login/signup) — scheduled as its own small milestone immediately
  before the nutrition sub-project begins.
- Full offline support for starting a brand-new session (see Offline Architecture).
- Multi-device-per-session sync conflict resolution (see Offline Architecture).

## Architecture

- **Mobile app**: React Native (Expo), TypeScript.
- **Data, Storage, Auth: Supabase** — Postgres, file storage (for imported PDFs/images),
  and Auth. Used from day one, including RLS policies scoped to `auth.uid()`, even while
  the app runs against a hardcoded dev user — this means enabling real Supabase Auth later
  is a feature flip, not a schema migration.
- **Rule engine**: a standalone TypeScript package (`packages/rule-engine`) with zero
  HTTP/DB dependencies — pure functions over structured input (equipment tags, muscle
  targets, goal, exercise library subset) producing a structured session plan. Imported by
  both the mobile app and (if ever needed) the backend. This is what makes the engine
  runnable on-device for offline generation and instant local swaps, and what makes any
  future move of backend logic (e.g. Fastify → Edge Functions) a non-event.
- **Fastify backend**: down to a single responsibility — **import parsing**. Upload →
  Claude extraction → exercise matching → draft. This is the only part of the system that
  needs a server-held secret (the LLM API key) and a service-role Supabase key (see Import
  Flow and Error Handling for why that key's usage is tightly scoped).
- **Mobile ↔ Supabase**: direct via the Supabase client SDK for CRUD (equipment profiles,
  programs, sessions, sets) and for running generation locally (see Generation Engine).
- **Mobile ↔ Fastify**: only for import parsing.

## Data Model

All user-owned tables carry `user_id` with RLS scoping rows to `auth.uid()`.

- **`equipment_profiles`** (`id`, `user_id`, `name`) — saved locations, e.g. "Home Gym",
  "Work Gym", "Travel". Users can have multiple.
- **`equipment_catalog`** (`id`, `name`, `category`) — master list of equipment types,
  seeded once.
- **`equipment_profile_items`** — join table: which catalog equipment belongs to which
  profile.
- **`exercises`** (`id`, `name`, `primary_muscles[]`, `secondary_muscles[]`,
  `movement_pattern`, `is_compound`, `instructions`, `source` enum(`seed`/`import`/`user`),
  `user_id` nullable, `updated_at`). Seeded from an open exercise dataset
  (e.g. free-exercise-db). OR-variants (e.g. "Barbell Bench Press" vs "Dumbbell Bench
  Press") are separate rows, not one row with alternative equipment — this keeps equipment
  matching pure AND logic. `movement_pattern` (plain text grouping key, not a taxonomy
  table) and `is_compound` (boolean) are populated via a one-off LLM tagging pass over the
  seed data, human-skimmed once. RLS: seed rows (`source: 'seed'`) readable by everyone;
  `import`/`user` rows scoped to their owner.
- **`exercise_equipment`** — join table, pure AND: an exercise requires *all* linked
  equipment rows to be present in a profile.
- **`programs`** (`id`, `user_id`, `name`, `days_per_week`).
- **`program_days`** (`id`, `program_id`, `order`, `day_type`, `muscle_groups[]`, `goal`) —
  a day is a template (target muscle groups + goal), not a concrete workout. `goal` is
  always present, including on fixed days (see below), since it drives rest-timer fallback.
- **`program_day_exercises`** (`id`, `program_day_id`, `exercise_id`, `order`,
  `target_sets`, `target_reps`, `rest_seconds` nullable) — optional. Presence of rows makes
  a day **fixed**; absence makes it **templated**. See "Program Model" below.
- **`sessions`** (`id`, `user_id`, `program_day_id` nullable — null means ad hoc,
  `equipment_profile_id`, `date`, `status`).
- **`session_exercises`** (`id`, `session_id`, `exercise_id`, `order`, `target_sets`,
  `target_reps`, `rest_seconds`) — the concrete plan for one session, populated either by
  the rule engine (templated days, ad hoc sessions) or copied from `program_day_exercises`
  (fixed days).
- **`sets`** (`id` — **client-generated UUID**, `session_exercise_id`, `set_number`,
  `weight`, `reps`, `completed_at`, `is_pr`). See Offline Architecture for why the UUID
  matters.
- **`imports`** (`id`, `user_id`, `file_url`, `status`, `parsed_draft` jsonb,
  `created_program_id` nullable). `parsed_draft` holds the full extracted+matched result;
  nothing is written to `programs`/`program_days`/`program_day_exercises` until the user
  confirms the review screen, at which point the backend materializes those rows and sets
  `created_program_id`. A single imported workout is represented as a one-day program —
  imports never produce a different output shape.

## Program Model: Templated vs. Fixed Days

A `program_day` is one of two kinds, distinguished by whether it has `program_day_exercises`
rows:

- **Templated** (app-generated programs): no fixed exercises. At session time, the rule
  engine generates `session_exercises` fresh from the day's `muscle_groups` + `goal` +
  the session's equipment profile.
- **Fixed** (imported or manually-authored programs): has `program_day_exercises` rows,
  which are copied directly into `session_exercises` at session time — no engine call.

Both kinds flow into the same `sessions` → `session_exercises` → `sets` pipeline, so logging,
rest timers, and swap work identically regardless of origin.

**Swap on a fixed day** mutates only the session's `session_exercises` by default — the
underlying `program_day_exercises` is untouched, so next week's session reverts to the
original exercise. After a swap, the UI offers a secondary "also update the program?"
prompt to propagate the change back to `program_day_exercises` if the user wants it
permanent (e.g. their gym never has that machine). This is a deliberate choice, not an
oversight: swap-as-one-off vs swap-as-permanent-change are both valid intents and the app
shouldn't guess.

## Generation Engine

Pure TypeScript package, runs identically on mobile and (if ever needed) backend:

1. Resolve the session's equipment profile to a set of equipment tags.
2. Filter `exercises` where all required equipment ⊆ profile's tags, and `primary_muscles`
   overlaps the day's target muscle groups.
3. Pick one exercise per `movement_pattern` (avoids programming multiple variants of the
   same movement in one session), ordered compound-first via `is_compound`.
4. **Degradation ladder** if the filtered set can't fill the target exercise count for a
   muscle group (the common case — finding zero matches is rare, finding too few is not):
   a. Relax to include `secondary_muscles` matches.
   b. Relax to allow repeated `movement_pattern`s.
   c. If still short, fill what's possible and report the shortfall with the same
      "broaden your equipment or pick a different muscle group" message used for the
      zero-candidate case — never silently return a thin session without explanation.
   This ladder is exercise-visible engine logic and is covered directly in the unit test
   suite (e.g. "a sparse home-gym equipment profile still yields a sensible leg day").
5. Apply a goal template for sets/reps/rest (e.g. Strength: 3–5 reps, 3–5 sets, 3–5 min
   rest; Hypertrophy: 8–12 reps, 3–4 sets, 60–90s; Endurance: 15–20 reps, 2–3 sets, 30–45s).
6. Write the result as `session_exercises` rows.

**Exercise library cache & sync contract** (mobile): the app keeps a local copy of
`exercises`, `exercise_equipment`, and `equipment_catalog` to run generation and swap
on-device. Freshness is checked via a `library_version` (max `updated_at` across the
tables) compared on app start; a mismatch triggers a re-pull. This check **never blocks**
generation or workout-start — a stale library is always an acceptable state (it's exercise
metadata, not financial data), and the check running in the background is a deliberate
choice to prevent a future blocking-fetch regression on the workout-start path.

Since the engine runs on-device, the mobile app calls `generate()` locally and writes the
resulting `session` + `session_exercises` directly to Supabase — there is no
generation-related Fastify endpoint. The only reason starting a new session still requires
connectivity is that the new `session` row must be written to Supabase; that's a data-sync
requirement, not a compute one.

## Session Logging & Swap

- Rest timer auto-starts after each logged set, duration from `session_exercises.rest_seconds`
  (itself either the parsed import value or the goal template's default).
- Previous performance for an exercise is shown from the most recent prior `sets` for that
  `exercise_id` + user.
- Swap re-runs a narrowed version of the generation filter (same muscle group/movement
  pattern, current equipment) locally, instantly — no backend round trip, online or offline.
- **PR detection**: a set's estimated 1RM (Epley formula: `weight × (1 + reps/30)`) is
  compared against the user's best prior e1RM for that exercise. If a set is later edited
  or deleted, `is_pr` is recomputed for that exercise — this is documented behavior (the
  flag is derived, denormalized data that can go stale on edit/delete), not a bug.

## Offline Architecture

**Scope**: once a session exists (i.e. `session_exercises` has been generated and synced),
logging sets, running the rest timer, and swapping exercises all work with zero
connectivity. Starting a brand-new session still requires connectivity, because writing the
new `session` row to Supabase is a sync operation — the generation *computation* itself
already runs on-device (see Generation Engine), so this is a data-write constraint, not a
capability gap.

- **Local queue**: active-workout writes (`sets`, in-session swaps) are held in a local
  SQLite store and synced to Supabase on reconnect.
- **Sync model — idempotent replay, not conflict resolution**: `sets.id` is a
  client-generated UUID, and set creation is append-only. Combined with the
  single-device-per-session assumption, this means sync conflicts aren't just rare — they're
  structurally impossible for creates: replaying the same insert twice is a no-op upsert by
  UUID. (Edits/deletes of past sets are expected to be rare and are queued the same way —
  idempotent by UUID.) This also simplifies what the sync tests need to prove:
  replay-twice-equals-same-state, not conflict-resolution correctness.
- **PR detection offline**: the PR check needs "this user's best prior e1RM per exercise,"
  which can't depend on whatever history happens to have synced. The mobile app maintains a
  small local cache table — one row per exercise the user has ever logged, holding its best
  known e1RM — refreshed from the server (source of truth, computed from `sets`) on every
  sync and consulted at log time for the instant offline PR check. If an edge case
  misfires offline (e.g. a not-yet-synced better set elsewhere), it self-corrects on the
  next sync since the server recompute remains authoritative.

## Import Flow

1. User uploads a PDF/image/text file to a private Supabase Storage bucket (RLS-scoped to
   the user).
2. Mobile app calls the Fastify `/imports` endpoint with the file reference; backend
   creates an `imports` row (`status: 'processing'`).
3. Backend sends the file to Claude (document/vision input) to extract program name, days,
   and per-day exercise lines (name, sets, reps, rest if stated).
4. **Matching step**: for each extracted line, the backend asks the LLM to pick the best
   match from candidate library exercises (filtered by inferable muscle group) or flag it
   as unmatched. Every line ends up with a real `exercise_id` — matched, or newly created
   with `source: 'import'`, `user_id: owner`. This is the parser's contract: no line is
   ever dropped or left unresolved. The full resolved result, including any parsed
   `rest_seconds`, is written to `imports.parsed_draft` — nothing touches `programs` yet.
5. Mobile app renders a **review screen** from `parsed_draft`: per day, per exercise,
   showing the match with the ability to pick a different library exercise or confirm it's
   genuinely new, plus parsed sets/reps/rest.
6. On confirm, the backend materializes `parsed_draft` into real `programs` /
   `program_days` / `program_day_exercises` rows and sets `imports.created_program_id`. On
   discard, the `imports` row is marked discarded; nothing was ever written to the domain
   tables.
7. Failure handling: a parse failure (bad scan, unsupported content) sets `status: 'failed'`
   with a message and a manual-program-creation fallback. A partial parse (one day garbled)
   still reaches the review screen so the user can fix or delete just that day, rather than
   failing the whole import.

## Auth Plan

- **Now**: real multi-user schema and RLS policies, but the app runs against one hardcoded
  dev user — no login screen yet.
- **Milestone (before nutrition sub-project begins)**: wire in Supabase Auth (login/signup),
  replacing the hardcoded user with real sessions. Because the schema and RLS were built
  user-scoped from day one, this milestone is additive (auth screens + session handling),
  not a data migration.
- **Fastify request verification** (must exist from the very first endpoint, ~20 lines as a
  Fastify hook): every request's `Authorization` header is validated against the Supabase
  JWT secret; `user_id` is derived from the verified token, **never** trusted from the
  request body. Without this, the import endpoint would be an RLS bypass — it writes drafts
  using a Supabase **service-role key** (required to write on behalf of users through
  `parsed_draft` before the row model even involves the user's own session), so the
  service-role key must live only in the Fastify environment (never shipped to any client),
  and every draft/program row it writes must use the JWT-derived `user_id`, not anything
  supplied by the client.

## Error Handling

- Generation shortfall/zero-candidates: handled by the degradation ladder (see Generation
  Engine) — always ends in either a filled session or a clear, actionable message, never a
  silent thin/empty session.
- Import/LLM failures: `status: 'failed'` with retry + manual fallback (see Import Flow).
- Fastify auth failures: missing/invalid/expired JWT → 401 before any handler logic runs.
- Offline sync: idempotent replay means there is no conflict-resolution error case to
  handle for `sets` creation under the single-device-per-session assumption (see Offline
  Architecture).

## Testing Strategy

- **Rule engine** (pure package): unit tests for equipment filtering, movement-pattern
  dedup, the degradation ladder (including the "sparse profile still yields a sensible
  session" property), and goal templates. Since the engine is a shared package, this one
  suite covers both its call sites (mobile now; backend if ever reintroduced).
- **Import matching**: unit tests against fixture LLM responses (mocked), plus one
  integration test against a real sample PDF.
- **RLS policies**: integration tests proving cross-user data isolation — the core
  guarantee the multi-user-from-day-one schema exists to provide.
- **Offline sync**: tests for the queue → reconnect → sync path, specifically
  replay-twice-equals-same-state (per the idempotent-replay design, not general conflict
  resolution).
- **Fastify JWT hook**: tests for missing/expired/malformed tokens, and that `user_id` used
  in writes always comes from the token, never the request body.

## Future Phases (not designed here)

- Exercise instructional videos.
- Nutrition/meal generation, tied to workout data.
- Spotify in-app playback.
- Progressive overload auto-suggestions (e.g. "add 2.5kg when you hit the top of the rep
  range") — noted as a natural extension of the generation engine's goal-template step,
  since it slots in as a per-exercise rule at generation time with no schema change needed.
