# Workout Trainer — M3 Design: Core Loop (Setup → Generate → Log)

## Overview

M3 is the first milestone that puts real screens on the M0–M2 foundation (schema, RLS,
rule engine) and proves the whole stack works end to end: a user picks their equipment,
generates a session on-device, and logs a workout with PR detection, previous-performance
display, a rest timer, and mid-workout exercise swap. It runs against a real (but
hardcoded-credentials) dev user — not the service-role key, not an unauthenticated client —
so RLS is exercised for real from the first screen.

## Scope

**In scope:**
- Equipment profile setup (create/select from `equipment_catalog`).
- Ad hoc session generation: pick target muscle groups + goal, call `generate()`, persist
  the result.
- Session logging: sets (weight/reps), PR detection display, previous-performance display
  (live query, not cached), rest timer, mid-workout exercise swap.
- A real dev-user sign-in (email/password against local Supabase Auth), auto-triggered
  behind a dev flag — never a service-role key in the mobile app.
- A new `swapExercise()` function in `packages/rule-engine`.

**Explicitly out of scope for M3:**
- Programs UI (recurring program creation/editing) — ad hoc generation only.
- Workout history / progress charts.
- Offline support (queueing, local SQLite, sync) — every screen assumes connectivity.
- Real login/signup screens (M7).
- Import flow (M6).

## Global Constraints

- Screens are thin render layers. Any logic (state transitions, computed display values,
  timers, data mapping) lives in plain hooks or functions that run in Node with no
  rendering — those get full TDD/behavioral test coverage. Screens themselves get only
  mount-and-elements smoke tests (jest-expo render, confirms no crash, key elements present).
- Mock at the repository boundary (`apps/mobile/src/data/`) in hook tests, never at the
  raw Supabase client — no deep-mocked query-builder chains.
- `packages/rule-engine` remains zero-HTTP/zero-DB: `swapExercise()` is a pure function
  over the same kind of structured input as `generate()`, no persistence knowledge.
- The repository layer has zero generation knowledge: `createSession()` accepts the
  engine's `GenerationResult` shape and persists it — the hook is the only place that
  calls `generate()`/`swapExercise()` *and* the repository.
- Every fetch-shaped hook returns the shape `{ data, isLoading, error, refetch }` — cheap
  to swap for TanStack Query later if cross-screen cache invalidation ever justifies it;
  zero screen churn if so, since screens only ever see this shape.
- `useEffect`-based fetches use the ignore-flag cleanup pattern to guard against
  state updates after unmount (e.g. navigating away from `LoggingScreen` mid-fetch).

## Architecture

### Screens (`apps/mobile/src/screens/`)

1. **`EquipmentSetupScreen`** — checkbox list from `equipment_catalog`, saves an
   `equipment_profiles` + `equipment_profile_items` row set via the repository.
2. **`GenerateScreen`** — form: target muscle groups (multi-select), goal (single-select
   from the four `Goal` values), equipment profile picker. On submit: calls `useActiveSession`'s
   `startSession()`, which runs `generate()` then `createSession()`, then navigates to
   `LoggingScreen`.
3. **`LoggingScreen`** — current exercise, target sets/reps/rest, weight/reps input per set,
   PR badge (from `lastLoggedSetWasPr`), previous-performance line (from a live
   `getPreviousPerformance` fetch), rest timer (from `useRestTimer`), swap button (opens a
   candidate list from `useActiveSession`'s `swap()`).

Each screen imports its hook(s), renders from the hook's returned state, and calls hook
methods on interaction. No Supabase calls and no business logic live in a screen file.

### Repository (`apps/mobile/src/data/repository.ts`)

Plain async functions, one per operation, each a thin wrapper over the Supabase client:
`getEquipmentCatalog`, `createEquipmentProfile`, `getExerciseLibrary`, `createSession`
(accepts a `GenerationResult`-shaped input, persists `session` + `session_exercises`),
`logSet` (persists a `sets` row, returns it including the trigger-computed `is_pr`),
`getPreviousPerformance` (most recent prior `sets` for an `exercise_id` + the dev user),
`updateSessionExercise` (persists a swap's chosen replacement into the session).

### Hooks (`apps/mobile/src/hooks/`)

- **`useExerciseLibrary`** — fetches `exercises` + `exercise_equipment`, maps each row
  through `toEngineExercise` (data-mapping layer, below) before anything touches the rule
  engine. Returns `{ data, isLoading, error, refetch }`.
- **`useActiveSession`** — owns session/exercise progression: `startSession()` (calls
  `generate()` then `createSession()`), `logSet(weight, reps)` (calls `logSet()` repository
  fn, updates `lastLoggedSetWasPr` from the response's `is_pr`, decides when the rest timer
  should start), `swap(targetIndex)` (calls `swapExercise()` then, on a chosen candidate,
  `updateSessionExercise()`).
- **`useRestTimer`** — countdown from a duration, exposes remaining time + completion state;
  tested with fake timers.

### Data-mapping layer (`apps/mobile/src/lib/toEngineExercise.ts`)

Pure function, `(row: ExerciseRow) => Exercise & { isTagged: boolean }`:
- `movementPattern: row.movement_pattern ?? 'untagged:' + row.id` — per-row-unique sentinel,
  so the dedup logic in `selectByMuscleGroup`/`selectWithDegradationLadder` never collapses
  two different untagged exercises into the same bucket.
- `isCompound: row.is_compound ?? false`.
- `isTagged: row.movement_pattern !== null` — an explicit boolean, so
  `swapExercise()` (and anything else) branches on this flag rather than string-matching
  the sentinel's `'untagged:'` prefix.

Directly unit-tested: a null `movement_pattern` maps to a per-row-unique sentinel, never a
shared value across two different rows.

### `swapExercise()` (new, in `packages/rule-engine/src/swapExercise.ts`)

```ts
interface ScoredCandidate {
  exercise: Exercise;
  // rung the candidate was found at, for potential future UI distinction
  rung: 1 | 2;
}

interface SwapResult {
  candidates: ScoredCandidate[];
  reason?: 'no-equipment-match' | 'no-alternatives';
}

function swapExercise(
  library: (Exercise & { isTagged: boolean })[],
  session: { exerciseId: string; movementPattern: string }[], // current session's exercises
  targetIndex: number,
  equipmentProfile: string[],
): SwapResult
```

Ladder (mirrors M2's degradation ladder shape):

1. **Rung 1** — same movement pattern as the target exercise, AND same primary muscle,
   AND equipment-available, excluding every exercise already in the session. **Skipped
   entirely if the target's `isTagged` is `false`** — a sentinel pattern is per-row-unique
   by construction, so "same pattern" can never match anything for an untagged exercise;
   attempting rung 1 for it would always correctly-but-uselessly return empty, and a test
   suite built against that would encode "untagged exercises have no rung-1 alternatives"
   as intended behavior rather than a sentinel artifact.
2. **Rung 2** — same primary muscle, any pattern, equipment-available, excluding exercises
   already in the session AND excluding movement patterns already used by *other* session
   exercises (so a swap never creates a same-session duplicate pattern).
3. **Empty** — if rung 2 also yields nothing, return `{ candidates: [], reason: 'no-alternatives' }`
   (or `'no-equipment-match'` if the equipment filter itself was the blocker — exact
   distinction left to implementation, but the UI must always get a renderable reason,
   never a silent empty list with no explanation).

Candidates are compound-first ordered (same rule as `selectByMuscleGroup`), and the
function always returns a list, never a single auto-picked exercise — a future "top pick
auto-swaps, long-press shows alternatives" UI costs nothing extra if the function already
returns the ranked list.

## Auth Strategy

- `supabase/seed.sql` (new — none exists yet, so `db reset` currently seeds nothing) creates
  one dev user in `auth.users` with a **fixed, known UUID** and a real, sign-in-capable
  password hash (`crypt('<dev-password>', gen_salt('bf'))` via pgcrypto — not the fake
  placeholder hash `tests.create_test_user` uses, which only works for RLS-simulation
  tests that set the JWT claim directly, not real `signInWithPassword` calls).
- **`signInWithPassword` has more prerequisites than a password hash — a raw `auth.users`
  insert that misses any of these fails in ways that look unrelated to auth.** The seed
  must set, in `auth.users`:
  - `instance_id = '00000000-0000-0000-0000-000000000000'` (GoTrue's default instance).
  - `email_confirmed_at` to a non-null timestamp — `NULL` here yields an "email not
    confirmed" sign-in failure even with local email-confirmation disabled.
  - `aud = 'authenticated'`, `role = 'authenticated'`.

  and additionally insert a matching row into **`auth.identities`** — GoTrue does not
  authenticate a user with zero identity rows regardless of `auth.users` state — with
  `provider = 'email'`, `provider_id` equal to the user's id, and `identity_data`
  containing at least `sub` (the user id) and `email`.
- **Verification gate, ordered right after the seed task, before any screen task starts:**
  a small script (or a `curl` against the local GoTrue endpoint) that runs
  `supabase db reset` then calls `signInWithPassword` with the seeded credentials and
  asserts success. This exists specifically so a broken dev-user seed fails loudly at the
  seed task, not as "why is my equipment list empty" three layers later in
  `EquipmentSetupScreen` — the exact compounding-failure shape the per-screen manual
  checkpoints (see Testing Strategy) exist to prevent.
- The mobile app's root bootstrap, gated behind a dev flag (e.g. `__DEV__` or an explicit
  `EXPO_PUBLIC_DEV_AUTO_SIGNIN` env var), calls
  `supabase.auth.signInWithPassword({ email, password })` with the matching hardcoded dev
  credentials before rendering the navigator.
- No service-role key ships in the mobile app at any point. Every table's RLS policy is
  exercised for real starting from `EquipmentSetupScreen`, which is the point of this
  approach: it catches RLS policy bugs during M3 development instead of hiding them behind
  a bypass.
- M7 (real auth) later replaces the auto-sign-in call with an actual login form — additive,
  not a rework, since every screen and hook already only ever sees "the current
  authenticated user," never a hardcoded ID.
- `seed.sql` carries a header comment: `-- local dev seed — never run against a hosted
  project` (hardcoded dev credentials are fine for a local-only seed file; the comment is a
  guard for M7's future self, who will be touching real auth config in the same vicinity).

## Dev-Loop Reset Orchestration

`supabase db reset` alone is no longer sufficient once M3 screens depend on real data:
`equipment_catalog`/`exercises` are empty until `scripts/seed-exercises.ts` runs, and
`movement_pattern`/`is_compound` tags are gone until `scripts/apply-movement-tags.ts`
re-applies the committed, human-reviewed `scripts/data/movement-tags-review.json` — but
`EquipmentSetupScreen` needs the catalog and `GenerateScreen` needs a (tagged, ideally)
library on every dev-loop reset.

Add a root script, `pnpm run db:reset`, that runs in order:

1. `supabase db reset` — migrations + `seed.sql` (dev user).
2. `tsx scripts/seed-exercises.ts` — populates `equipment_catalog`/`exercises`.
3. `tsx scripts/apply-movement-tags.ts` — re-applies `movement-tags-review.json` **if that
   file exists**; if it doesn't (Task 14's live tagging + human review hasn't happened yet),
   skip this step with a warning rather than failing the whole reset — the sentinel
   fallback in `toEngineExercise` means the app functions correctly untagged (just with
   degraded movement-pattern dedup quality), so an incomplete tagging pass must never block
   the dev loop.

This becomes the documented reset path (replacing bare `supabase db reset` in any
onboarding/README instructions), and it's what makes committing the reviewed tagging file
(a decision made during the M0–M2 cleanup batch) actually pay off — otherwise a fresh reset
would silently discard the reviewed tags with no automatic path back.

## Error Handling

- `useExerciseLibrary`/other fetch hooks surface `error` in their return shape; screens
  render a retry affordance calling `refetch()`.
- `swapExercise()`'s empty-with-`reason` result renders as an explicit message in the swap
  UI ("No alternatives available with your current equipment") — never a silently empty
  candidate list.
- `logSet()` failures (network drop mid-log) surface as a toast/inline error with a manual
  retry — M3 has no offline queue, so a failed log is not silently lost, but it is not
  auto-retried either.
- `startSession()`'s underlying `generate()` may return a `shortfall > 0` (per M2's
  degradation ladder) — `LoggingScreen` renders the generated exercises regardless, with a
  non-blocking note if `shortfall > 0` ("couldn't find N more exercises for this muscle
  group — try broadening your equipment").

## Testing Strategy

- **Data-mapping layer** (`toEngineExercise`): direct unit test — null pattern maps to a
  per-row-unique sentinel, never a shared value; `isTagged` reflects the source column
  correctly.
- **`swapExercise()`**: full TDD in `packages/rule-engine`, same pattern as M2's functions —
  rung 1 skip-on-untagged, rung 2 pattern-exclusion-across-session, empty-with-reason cases
  all covered as explicit test scenarios.
- **`useActiveSession`, `useRestTimer`, `useExerciseLibrary`**: full behavioral coverage,
  repository mocked at the boundary, `useRestTimer` using jest fake timers for
  countdown/completion.
- **Screens**: jest-expo smoke tests only — mounts without crashing, key interactive
  elements present. No RTL behavioral suites on screens themselves.
- **Manual per-screen verification**: the sandboxed implementer environment can't run Expo
  Go or a simulator, so "mounts in jest-expo" is the only automated signal available to it.
  Each screen task's review includes a manual checkpoint — the project owner opens the
  screen in Expo Go/simulator and confirms it looks right, navigates correctly, and feels
  usable — budgeted as a short per-task check (same pattern as M1's Docker-dependent pgTAP
  verification), not deferred to one big review at the end, since screen-flow problems
  compound if later screens build on a broken earlier one.

## Future Milestones (not designed here)

- Programs UI, workout history/progress charts (later M-numbered milestone, not yet
  assigned).
- Offline architecture (local SQLite queue, idempotent-replay sync) — per the phase-1
  design doc, scoped separately once the core loop is proven online.
- Exercise-library local cache & `library_version` freshness check (phase-1 design doc
  references this; likely M4, per informal milestone hints from M0–M2 work — not
  formally scoped until its own design pass).
- Real auth (M7), import flow (M6).
