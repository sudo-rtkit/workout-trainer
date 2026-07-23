# Workout Trainer — M0–M2 Implementation Plan (Scaffold, Schema+Seed, Rule Engine)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo scaffold, the full multi-user database schema (with RLS and
the PR trigger), the seeded exercise library, and a complete, unit-tested rule-based
workout generation engine — with nothing built yet for the mobile UI or the import/auth
milestones (M3–M7, planned separately once this lands).

**Architecture:** pnpm/Turborepo monorepo. `apps/mobile` (Expo, scaffolded but inert until
M3), `apps/api` (Fastify, health-check only until M6 adds import parsing), `packages/rule-engine`
(pure TypeScript, zero HTTP/DB deps, becomes the real generation engine in M2).
Supabase (local CLI-managed Postgres) holds all schema, RLS policies, and the PR trigger.

**Tech Stack:** TypeScript 5, pnpm 9 + Turborepo 2, Fastify 5, Vitest 3 (api + rule-engine),
Expo + jest-expo (mobile), Supabase CLI (local Postgres/Auth/Storage + pgTAP for DB tests),
ESLint 9 flat config + typescript-eslint 8, GitHub Actions CI.

## Global Constraints

- TypeScript everywhere; strict mode on (`tsconfig.base.json`).
- Monorepo layout: `apps/*` for deployables, `packages/*` for shared libraries.
- `packages/rule-engine` has **zero** HTTP or DB dependencies — pure functions only. It
  must be importable by both `apps/mobile` and `apps/api` without either dragging in the
  other's dependencies.
- `apps/api` (Fastify) has exactly one long-term responsibility: import parsing (built in
  M6). Do not add any other endpoints in M0–M2 beyond the `/health` check used to prove the
  scaffold works.
- All user-owned Postgres tables carry `user_id` and RLS scoped to `auth.uid()`, enforced
  from day one even though no login UI exists until M7.
- `exercises`: OR-variants (e.g. "Barbell Bench Press" vs "Dumbbell Bench Press") are
  separate rows; `exercise_equipment` is a pure-AND join (an exercise requires *all* linked
  equipment). `movement_pattern` is a plain text column, not a taxonomy table.
  `primary_muscles`/`secondary_muscles` are arrays, not a singular `muscle_group`.
  `source` is `seed`/`import`/`user`; seed rows are readable by everyone via RLS, `import`/
  `user` rows are scoped to their owner.
- `sets.id` and `session_exercises.id` are **client-generated UUIDs** with no DB default —
  every other table's `id` defaults to `gen_random_uuid()`.
- `sessions.status` is `active` / `completed` / `abandoned`.
- `is_pr` is computed by a Postgres trigger using the Epley formula
  (`weight * (1 + reps/30.0)`), applied **only to sets of ≤12 reps**; higher-rep sets never
  get `is_pr = true`. The flag is a chronological "was this a new best at the time" marker,
  recomputed for the full history of a (user, exercise) pair on every insert/update/delete.

---

## M0 — Scaffold

### Task 1: Root workspace, TypeScript, and tooling config

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore` (append to existing)
- Create: `.prettierrc.json`
- Create: `eslint.config.js`

**Interfaces:**
- Produces: the `pnpm` workspace root that every later task's `apps/*`/`packages/*` package
  registers into, and the `turbo run <task>` pipeline (`build`, `lint`, `test`) every later
  task's `package.json` scripts must implement.

- [ ] **Step 1: Create the root `package.json`**

```json
{
  "name": "trainer-app",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "build": "turbo run build",
    "lint": "turbo run lint",
    "test": "turbo run test"
  },
  "devDependencies": {
    "@eslint/js": "^9.12.0",
    "eslint": "^9.12.0",
    "prettier": "^3.3.0",
    "supabase": "^1.219.0",
    "turbo": "^2.1.0",
    "typescript": "^5.6.0",
    "typescript-eslint": "^8.8.0"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "lint": {},
    "test": {
      "dependsOn": ["^build"]
    }
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 5: Append to `.gitignore`**

```
node_modules
dist
.turbo
.expo
.env
.env.local
supabase/.branches
supabase/.temp
```

- [ ] **Step 6: Create `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 7: Create `eslint.config.js`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  ignores: ['**/dist/**', '**/.expo/**', '**/.turbo/**'],
});
```

- [ ] **Step 8: Install root dependencies**

Run: `pnpm install`
Expected: lockfile `pnpm-lock.yaml` created, no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json .gitignore .prettierrc.json eslint.config.js pnpm-lock.yaml
git commit -m "chore: initialize pnpm/turborepo workspace"
```

---

### Task 2: `apps/api` Fastify stub with a health check

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/index.ts`
- Test: `apps/api/src/server.test.ts`

**Interfaces:**
- Consumes: root `tsconfig.base.json` (Task 1).
- Produces: `buildServer(): FastifyInstance` from `apps/api/src/server.ts`, imported by
  `apps/api/src/index.ts` and by `apps/api/src/server.test.ts`. This is the only exported
  symbol later import-parsing work (M6) will extend.

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@app/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "eslint ."
  },
  "dependencies": {
    "fastify": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/api/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: Write the failing test — `apps/api/src/server.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { buildServer } from './server.js';

describe('GET /health', () => {
  it('returns status ok', async () => {
    const app = buildServer();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 5: Install and run the test to verify it fails**

Run: `pnpm install && pnpm --filter @app/api test`
Expected: FAIL — `Cannot find module './server.js'` (or similar), since `server.ts` doesn't exist yet.

- [ ] **Step 6: Create `apps/api/src/server.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get('/health', async () => {
    return { status: 'ok' };
  });

  return app;
}
```

- [ ] **Step 7: Create `apps/api/src/index.ts`**

```ts
import { buildServer } from './server.js';

const app = buildServer();

app.listen({ port: 3000, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @app/api test`
Expected: PASS — 1 test passed.

- [ ] **Step 9: Commit**

```bash
git add apps/api
git commit -m "feat(api): scaffold fastify app with health check"
```

---

### Task 3: `packages/rule-engine` scaffold with a smoke test

**Files:**
- Create: `packages/rule-engine/package.json`
- Create: `packages/rule-engine/tsconfig.json`
- Create: `packages/rule-engine/vitest.config.ts`
- Create: `packages/rule-engine/src/index.ts`
- Test: `packages/rule-engine/src/index.test.ts`

**Interfaces:**
- Produces: `RULE_ENGINE_VERSION: string` — a smoke-test-only export proving the package's
  build/test harness works. M2 replaces this file's contents with the real engine's public
  API (`generate`, `filterByEquipment`, etc.) while keeping the package wiring from this
  task unchanged.

- [ ] **Step 1: Create `packages/rule-engine/package.json`**

```json
{
  "name": "@app/rule-engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "eslint ."
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/rule-engine/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/rule-engine/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: Write the failing test — `packages/rule-engine/src/index.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { RULE_ENGINE_VERSION } from './index.js';

describe('rule-engine package', () => {
  it('exposes a version string, proving the build/test harness is wired up', () => {
    expect(typeof RULE_ENGINE_VERSION).toBe('string');
  });
});
```

- [ ] **Step 5: Install and run the test to verify it fails**

Run: `pnpm install && pnpm --filter @app/rule-engine test`
Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 6: Create `packages/rule-engine/src/index.ts`**

```ts
export const RULE_ENGINE_VERSION = '0.1.0';
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @app/rule-engine test`
Expected: PASS — 1 test passed.

- [ ] **Step 8: Commit**

```bash
git add packages/rule-engine
git commit -m "feat(rule-engine): scaffold pure package with smoke test"
```

---

### Task 4: `apps/mobile` Expo scaffold with a smoke test

**Files:**
- Create: `apps/mobile/` (via Expo CLI scaffold)
- Modify: `apps/mobile/package.json`
- Test: `apps/mobile/App.test.tsx`

**Interfaces:**
- Produces: `apps/mobile` as a registered pnpm workspace package (`@app/mobile`), with a
  working Jest test harness. No app logic is built here — this is scaffold-only; M3 is the
  first milestone that adds real screens.

- [ ] **Step 1: Scaffold the Expo app**

Run: `npx create-expo-app@latest apps/mobile --template blank-typescript`
Expected: `apps/mobile/` created with `App.tsx`, `package.json`, `app.json`, `tsconfig.json`.

- [ ] **Step 2: Rename the package for the workspace and mark it private**

Edit `apps/mobile/package.json` — change the `"name"` field to `"@app/mobile"` and ensure
`"private": true` is present (Expo's default scaffold already sets `private: true`).

- [ ] **Step 3: Add test dependencies**

Run: `pnpm --filter @app/mobile add -D jest-expo jest @types/jest react-test-renderer @testing-library/react-native`

- [ ] **Step 4: Add the Jest config and test script to `apps/mobile/package.json`**

Add these fields to the existing `apps/mobile/package.json` (alongside Expo's generated
`scripts`/`dependencies`):

```json
{
  "scripts": {
    "test": "jest",
    "lint": "eslint ."
  },
  "jest": {
    "preset": "jest-expo"
  }
}
```

- [ ] **Step 5: Write the failing test — `apps/mobile/App.test.tsx`**

```tsx
import { render } from '@testing-library/react-native';
import App from './App';

test('renders without crashing', () => {
  const { toJSON } = render(<App />);
  expect(toJSON()).not.toBeNull();
});
```

- [ ] **Step 6: Run the test to verify it fails or passes**

Run: `pnpm --filter @app/mobile test`
Expected: if this fails because of missing Jest setup, install the missing peer dependency
it names and re-run. Once dependencies resolve, the test should PASS immediately since
`App.tsx` already exists from the Expo scaffold — this step exists to prove the harness
works, not to drive new implementation.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): scaffold expo app with jest smoke test"
```

---

### Task 5: Supabase local project init

**Files:**
- Create: `supabase/config.toml` (generated)
- Create: `supabase/.gitignore` (generated)

**Interfaces:**
- Produces: the local Supabase CLI project that Task 6 (CI) and all of M1's migrations/
  tests run against.

- [ ] **Step 1: Add the Supabase CLI as a root dev dependency**

Already added in Task 1's root `package.json` (`"supabase": "^1.219.0"`). Confirm it's
installed: run `pnpm exec supabase --version` and expect a version string, not an error.

- [ ] **Step 2: Initialize the Supabase project**

Run: `pnpm exec supabase init`
Expected: `supabase/config.toml` and `supabase/.gitignore` created; when prompted about VS
Code settings, answer as you prefer (does not affect the plan).

- [ ] **Step 3: Start the local stack (requires Docker Desktop running)**

Run: `pnpm exec supabase start`
Expected: after downloading images (first run only), prints a table with `API URL`,
`anon key`, `service_role key`. Copy the `service_role key` and `API URL` — you'll need
them as `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env vars in M1's seed scripts. Do not
commit these values; they're local-only local-stack secrets, not production ones.

- [ ] **Step 4: Commit**

```bash
git add supabase/config.toml supabase/.gitignore
git commit -m "chore: initialize local supabase project"
```

---

### Task 6: CI — lint and test via Turborepo

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `turbo run lint test` (Task 1), and every package's `lint`/`test` scripts
  (Tasks 2–4).

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main, master]
  pull_request:

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run lint test
```

- [ ] **Step 2: Verify locally**

Run: `pnpm turbo run lint test`
Expected: all three packages' lint and test tasks pass (0 errors).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run lint and test via turborepo on push/PR"
```

**M0 exit check:** `pnpm turbo run lint test` passes locally, and the same command is green
in GitHub Actions on the pushed branch.

---

## M1 — Schema + Seed

### Task 7: pgTAP test helpers for simulating authenticated users

**Files:**
- Create: `supabase/tests/database/00_setup.sql`

**Interfaces:**
- Produces: `tests.create_test_user(email text) returns uuid`,
  `tests.authenticate_as(user_id uuid) returns void`,
  `tests.clear_authentication() returns void` — every subsequent RLS test in this plan
  calls these three functions.

This task has no separate "failing test first" step — it defines the *test infrastructure*
itself, which Task 8 immediately exercises and verifies.

- [ ] **Step 1: Create `supabase/tests/database/00_setup.sql`**

```sql
create schema if not exists tests;

-- Inserts a minimal row into auth.users so a real FK-valid user exists for RLS tests.
-- Runs as the postgres superuser (the default role for supabase CLI test connections),
-- so it is unaffected by RLS.
create or replace function tests.create_test_user(user_email text)
returns uuid
language plpgsql
as $$
declare
  new_user_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
  values (new_user_id, user_email, 'test-password-hash', now(), 'authenticated', 'authenticated');
  return new_user_id;
end;
$$;

-- Simulates "logged in as this user" for the rest of the current transaction:
-- sets the JWT claim auth.uid() reads, AND switches the Postgres role away from
-- postgres/superuser (which bypasses RLS) to `authenticated` (which does not).
create or replace function tests.authenticate_as(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function tests.clear_authentication()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', null, true);
  perform set_config('role', 'postgres', true);
end;
$$;
```

- [ ] **Step 2: Apply and run**

Run: `pnpm exec supabase db reset` (applies all migrations, currently none, fresh DB), then
`pnpm exec supabase test db`
Expected: no test files matched yet other than this setup file having no `plan()` — if the
CLI complains about a file with no tests, that's fine; Task 8 adds the first real assertions
against these helpers.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/00_setup.sql
git commit -m "test(db): add pgTAP helpers for simulating authenticated users"
```

---

### Task 8: Equipment tables + RLS

**Files:**
- Create: `supabase/migrations/<timestamp>_create_equipment_tables.sql` (generate via
  `supabase migration new create_equipment_tables`, then fill in the SQL below)
- Create: `supabase/tests/database/01_equipment_rls.sql`

**Interfaces:**
- Produces: `equipment_catalog(id, name, category)`, `equipment_profiles(id, user_id, name, created_at)`,
  `equipment_profile_items(equipment_profile_id, equipment_catalog_id)` — referenced by
  every later table that needs an equipment profile (`sessions.equipment_profile_id`) or an
  equipment link (`exercise_equipment.equipment_catalog_id`).
- Consumes: `tests.create_test_user`/`tests.authenticate_as` (Task 7).

- [ ] **Step 1: Write the failing pgTAP test — `supabase/tests/database/01_equipment_rls.sql`**

```sql
begin;
select plan(5);

select has_table('public', 'equipment_catalog', 'equipment_catalog table exists');
select has_table('public', 'equipment_profiles', 'equipment_profiles table exists');
select has_table('public', 'equipment_profile_items', 'equipment_profile_items table exists');

select tests.create_test_user('alice@example.com') as alice_id \gset
select tests.create_test_user('bob@example.com') as bob_id \gset

select tests.authenticate_as(:'alice_id'::uuid);
insert into equipment_profiles (user_id, name) values (:'alice_id'::uuid, 'Alice Home Gym');

select tests.authenticate_as(:'bob_id'::uuid);
select is(
  (select count(*)::int from equipment_profiles),
  0,
  'bob sees zero equipment profiles despite alice having one'
);

select tests.authenticate_as(:'alice_id'::uuid);
select is(
  (select count(*)::int from equipment_profiles),
  1,
  'alice sees exactly her own equipment profile'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec supabase test db`
Expected: FAIL — `has_table` assertions fail because none of the three tables exist yet.

- [ ] **Step 3: Generate and write the migration**

Run: `pnpm exec supabase migration new create_equipment_tables`
Expected: creates `supabase/migrations/<timestamp>_create_equipment_tables.sql`. Fill it
with:

```sql
create table equipment_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null
);

create table equipment_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table equipment_profiles enable row level security;

create policy "equipment_profiles_owner_all"
  on equipment_profiles
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table equipment_profile_items (
  equipment_profile_id uuid not null references equipment_profiles(id) on delete cascade,
  equipment_catalog_id uuid not null references equipment_catalog(id) on delete cascade,
  primary key (equipment_profile_id, equipment_catalog_id)
);

alter table equipment_profile_items enable row level security;

create policy "equipment_profile_items_owner_all"
  on equipment_profile_items
  for all
  using (
    exists (
      select 1 from equipment_profiles ep
      where ep.id = equipment_profile_id and ep.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from equipment_profiles ep
      where ep.id = equipment_profile_id and ep.user_id = auth.uid()
    )
  );
```

- [ ] **Step 4: Apply the migration and run the test to verify it passes**

Run: `pnpm exec supabase db reset && pnpm exec supabase test db`
Expected: PASS — 5/5.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/database/01_equipment_rls.sql
git commit -m "feat(db): add equipment_catalog/profiles/profile_items with RLS"
```

---

### Task 9: `exercises` + `exercise_equipment` tables + RLS

**Files:**
- Create: `supabase/migrations/<timestamp>_create_exercises_tables.sql`
- Create: `supabase/tests/database/02_exercises_rls.sql`

**Interfaces:**
- Consumes: `equipment_catalog` (Task 8), `tests.*` helpers (Task 7).
- Produces: `exercises(id, name, primary_muscles, secondary_muscles, movement_pattern,
  is_compound, instructions, source, user_id, updated_at)` and
  `exercise_equipment(exercise_id, equipment_catalog_id)` — referenced by
  `program_day_exercises.exercise_id` and `session_exercises.exercise_id` (Tasks 10–11).

- [ ] **Step 1: Write the failing pgTAP test — `supabase/tests/database/02_exercises_rls.sql`**

```sql
begin;
select plan(5);

select has_table('public', 'exercises', 'exercises table exists');
select has_table('public', 'exercise_equipment', 'exercise_equipment table exists');

select tests.create_test_user('alice2@example.com') as alice_id \gset
select tests.create_test_user('bob2@example.com') as bob_id \gset

-- Seed row inserted as postgres (superuser), before switching role — RLS does not apply.
insert into exercises (name, source, primary_muscles)
values ('Barbell Bench Press', 'seed', array['chest']);

select tests.authenticate_as(:'alice_id'::uuid);
insert into exercises (name, source, user_id, primary_muscles)
values ('Alice Custom Curl', 'user', :'alice_id'::uuid, array['biceps']);

select ok(
  (select count(*)::int from exercises where name = 'Barbell Bench Press') = 1,
  'alice can see the seed exercise'
);

select tests.authenticate_as(:'bob_id'::uuid);

select ok(
  (select count(*)::int from exercises where name = 'Barbell Bench Press') = 1,
  'bob can also see the seed exercise'
);

select ok(
  (select count(*)::int from exercises where name = 'Alice Custom Curl') = 0,
  'bob cannot see alice''s custom exercise'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec supabase test db`
Expected: FAIL — tables don't exist.

- [ ] **Step 3: Generate and write the migration**

Run: `pnpm exec supabase migration new create_exercises_tables`, fill with:

```sql
create table exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  primary_muscles text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  movement_pattern text,
  is_compound boolean not null default false,
  instructions text,
  source text not null default 'user' check (source in ('seed', 'import', 'user')),
  user_id uuid references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  constraint exercises_user_id_required_unless_seed
    check (source = 'seed' or user_id is not null)
);

create index exercises_movement_pattern_idx on exercises (movement_pattern);
create index exercises_primary_muscles_idx on exercises using gin (primary_muscles);

alter table exercises enable row level security;

create policy "exercises_select_seed_or_own"
  on exercises
  for select
  using (source = 'seed' or user_id = auth.uid());

create policy "exercises_insert_own"
  on exercises
  for insert
  with check (source != 'seed' and user_id = auth.uid());

create policy "exercises_update_own"
  on exercises
  for update
  using (source != 'seed' and user_id = auth.uid())
  with check (source != 'seed' and user_id = auth.uid());

create policy "exercises_delete_own"
  on exercises
  for delete
  using (source != 'seed' and user_id = auth.uid());

create table exercise_equipment (
  exercise_id uuid not null references exercises(id) on delete cascade,
  equipment_catalog_id uuid not null references equipment_catalog(id) on delete cascade,
  primary key (exercise_id, equipment_catalog_id)
);

alter table exercise_equipment enable row level security;

create policy "exercise_equipment_select_seed_or_own"
  on exercise_equipment
  for select
  using (
    exists (
      select 1 from exercises e
      where e.id = exercise_id and (e.source = 'seed' or e.user_id = auth.uid())
    )
  );

create policy "exercise_equipment_insert_own"
  on exercise_equipment
  for insert
  with check (
    exists (
      select 1 from exercises e
      where e.id = exercise_id and e.source != 'seed' and e.user_id = auth.uid()
    )
  );

create policy "exercise_equipment_delete_own"
  on exercise_equipment
  for delete
  using (
    exists (
      select 1 from exercises e
      where e.id = exercise_id and e.source != 'seed' and e.user_id = auth.uid()
    )
  );
```

- [ ] **Step 4: Apply and verify the test passes**

Run: `pnpm exec supabase db reset && pnpm exec supabase test db`
Expected: PASS — 5/5.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/database/02_exercises_rls.sql
git commit -m "feat(db): add exercises/exercise_equipment with source-scoped RLS"
```

---

### Task 10: `programs` / `program_days` / `program_day_exercises` tables + RLS

**Files:**
- Create: `supabase/migrations/<timestamp>_create_program_tables.sql`
- Create: `supabase/tests/database/03_programs_rls.sql`

**Interfaces:**
- Consumes: `exercises` (Task 9).
- Produces: `programs(id, user_id, name, days_per_week)`,
  `program_days(id, program_id, "order", day_type, muscle_groups, goal)`,
  `program_day_exercises(id, program_day_id, exercise_id, "order", target_sets,
  target_reps, rest_seconds)` — referenced by `sessions.program_day_id` (Task 11).

- [ ] **Step 1: Write the failing pgTAP test — `supabase/tests/database/03_programs_rls.sql`**

```sql
begin;
select plan(4);

select has_table('public', 'programs', 'programs table exists');
select has_table('public', 'program_days', 'program_days table exists');
select has_table('public', 'program_day_exercises', 'program_day_exercises table exists');

select tests.create_test_user('carol@example.com') as carol_id \gset
select tests.create_test_user('dave@example.com') as dave_id \gset

select tests.authenticate_as(:'carol_id'::uuid);
insert into programs (id, user_id, name, days_per_week)
values ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, :'carol_id'::uuid, 'Carol PPL', 6);

select tests.authenticate_as(:'dave_id'::uuid);
select is(
  (select count(*)::int from programs),
  0,
  'dave cannot see carol''s program'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec supabase test db`
Expected: FAIL.

- [ ] **Step 3: Generate and write the migration**

Run: `pnpm exec supabase migration new create_program_tables`, fill with:

```sql
create table programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  days_per_week integer not null check (days_per_week between 1 and 7),
  created_at timestamptz not null default now()
);

alter table programs enable row level security;

create policy "programs_owner_all"
  on programs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table program_days (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id) on delete cascade,
  "order" integer not null,
  day_type text not null,
  muscle_groups text[] not null default '{}',
  goal text not null check (goal in ('strength', 'hypertrophy', 'endurance', 'fat_loss'))
);

alter table program_days enable row level security;

create policy "program_days_owner_all"
  on program_days for all
  using (exists (select 1 from programs p where p.id = program_id and p.user_id = auth.uid()))
  with check (exists (select 1 from programs p where p.id = program_id and p.user_id = auth.uid()));

create table program_day_exercises (
  id uuid primary key default gen_random_uuid(),
  program_day_id uuid not null references program_days(id) on delete cascade,
  exercise_id uuid not null references exercises(id),
  "order" integer not null,
  target_sets integer not null check (target_sets > 0),
  target_reps integer not null check (target_reps > 0),
  rest_seconds integer
);

alter table program_day_exercises enable row level security;

create policy "program_day_exercises_owner_all"
  on program_day_exercises for all
  using (
    exists (
      select 1 from program_days pd
      join programs p on p.id = pd.program_id
      where pd.id = program_day_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from program_days pd
      join programs p on p.id = pd.program_id
      where pd.id = program_day_id and p.user_id = auth.uid()
    )
  );
```

- [ ] **Step 4: Apply and verify the test passes**

Run: `pnpm exec supabase db reset && pnpm exec supabase test db`
Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/database/03_programs_rls.sql
git commit -m "feat(db): add programs/program_days/program_day_exercises with RLS"
```

---

### Task 11: `sessions` / `session_exercises` / `sets` tables + RLS

**Files:**
- Create: `supabase/migrations/<timestamp>_create_session_tables.sql`
- Create: `supabase/tests/database/04_sessions_rls.sql`

**Interfaces:**
- Consumes: `equipment_profiles` (Task 8), `program_days` (Task 10), `exercises` (Task 9).
- Produces: `sessions(id, user_id, program_day_id, equipment_profile_id, date, status)`,
  `session_exercises(id, session_id, exercise_id, "order", target_sets, target_reps,
  rest_seconds)` (client-generated `id`), `sets(id, session_exercise_id, set_number,
  weight, reps, completed_at, is_pr)` (client-generated `id`) — Task 12's trigger fires on
  `sets`.

- [ ] **Step 1: Write the failing pgTAP test — `supabase/tests/database/04_sessions_rls.sql`**

```sql
begin;
select plan(4);

select has_table('public', 'sessions', 'sessions table exists');
select has_table('public', 'session_exercises', 'session_exercises table exists');
select has_table('public', 'sets', 'sets table exists');

select tests.create_test_user('erin@example.com') as erin_id \gset
select tests.create_test_user('frank@example.com') as frank_id \gset

select tests.authenticate_as(:'erin_id'::uuid);
insert into equipment_profiles (id, user_id, name)
values ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, :'erin_id'::uuid, 'Erin Gym');
insert into sessions (id, user_id, equipment_profile_id, status)
values ('bbbbbbbb-0000-0000-0000-000000000002'::uuid, :'erin_id'::uuid, 'bbbbbbbb-0000-0000-0000-000000000001'::uuid, 'active');

select tests.authenticate_as(:'frank_id'::uuid);
select is(
  (select count(*)::int from sessions),
  0,
  'frank cannot see erin''s session'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec supabase test db`
Expected: FAIL.

- [ ] **Step 3: Generate and write the migration**

Run: `pnpm exec supabase migration new create_session_tables`, fill with:

```sql
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_day_id uuid references program_days(id),
  equipment_profile_id uuid not null references equipment_profiles(id),
  date date not null default current_date,
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned'))
);

alter table sessions enable row level security;

create policy "sessions_owner_all"
  on sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- id is CLIENT-GENERATED: no default. The app always supplies a UUID (generation runs
-- on-device), so an offline-created row and its later sync are the same idempotent upsert.
create table session_exercises (
  id uuid primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  exercise_id uuid not null references exercises(id),
  "order" integer not null,
  target_sets integer not null check (target_sets > 0),
  target_reps integer not null check (target_reps > 0),
  rest_seconds integer not null
);

alter table session_exercises enable row level security;

create policy "session_exercises_owner_all"
  on session_exercises for all
  using (exists (select 1 from sessions s where s.id = session_id and s.user_id = auth.uid()))
  with check (exists (select 1 from sessions s where s.id = session_id and s.user_id = auth.uid()));

-- id is CLIENT-GENERATED: no default, same reasoning as session_exercises.id above.
create table sets (
  id uuid primary key,
  session_exercise_id uuid not null references session_exercises(id) on delete cascade,
  set_number integer not null check (set_number > 0),
  weight numeric not null check (weight >= 0),
  reps integer not null check (reps > 0),
  completed_at timestamptz not null default now(),
  is_pr boolean not null default false
);

alter table sets enable row level security;

create policy "sets_owner_all"
  on sets for all
  using (
    exists (
      select 1 from session_exercises se
      join sessions s on s.id = se.session_id
      where se.id = session_exercise_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from session_exercises se
      join sessions s on s.id = se.session_id
      where se.id = session_exercise_id and s.user_id = auth.uid()
    )
  );
```

- [ ] **Step 4: Apply and verify the test passes**

Run: `pnpm exec supabase db reset && pnpm exec supabase test db`
Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/database/04_sessions_rls.sql
git commit -m "feat(db): add sessions/session_exercises/sets with client-generated set/exercise IDs"
```

---

### Task 12: PR detection trigger (Epley formula, ≤12-rep guard, full recompute)

**Files:**
- Create: `supabase/migrations/<timestamp>_create_pr_trigger.sql`
- Create: `supabase/tests/database/05_pr_trigger.sql`

**Interfaces:**
- Consumes: `sets`, `session_exercises`, `sessions` (Task 11).
- Produces: `recompute_is_pr_for_exercise(p_user_id uuid, p_exercise_id uuid) returns void`
  and the `sets_recompute_pr` trigger — no other task calls these directly; they run
  automatically on every `sets` insert/update/delete.

- [ ] **Step 1: Write the failing pgTAP test — `supabase/tests/database/05_pr_trigger.sql`**

```sql
begin;
select plan(4);

select tests.create_test_user('pruser@example.com') as user_id \gset

-- Seed exercise inserted as postgres (superuser), before switching role.
insert into exercises (id, name, source, primary_muscles)
values ('cccccccc-0000-0000-0000-000000000001'::uuid, 'Test Squat', 'seed', array['legs']);

select tests.authenticate_as(:'user_id'::uuid);

insert into equipment_profiles (id, user_id, name)
values ('cccccccc-0000-0000-0000-000000000002'::uuid, :'user_id'::uuid, 'Test Gym');

insert into sessions (id, user_id, equipment_profile_id, status)
values ('cccccccc-0000-0000-0000-000000000003'::uuid, :'user_id'::uuid, 'cccccccc-0000-0000-0000-000000000002'::uuid, 'active');

insert into session_exercises (id, session_id, exercise_id, "order", target_sets, target_reps, rest_seconds)
values ('cccccccc-0000-0000-0000-000000000004'::uuid, 'cccccccc-0000-0000-0000-000000000003'::uuid, 'cccccccc-0000-0000-0000-000000000001'::uuid, 1, 3, 5, 120);

-- Set 1: 100kg x 5 -> e1RM ~116.7, first set for this exercise, should be a PR.
insert into sets (id, session_exercise_id, set_number, weight, reps, completed_at)
values ('cccccccc-0000-0000-0000-000000000005'::uuid, 'cccccccc-0000-0000-0000-000000000004'::uuid, 1, 100, 5, now());

select ok(
  (select is_pr from sets where id = 'cccccccc-0000-0000-0000-000000000005'::uuid),
  'first set at 100kg x5 is flagged as a PR'
);

-- Set 2: 90kg x 5 -> lower e1RM, not a PR.
insert into sets (id, session_exercise_id, set_number, weight, reps, completed_at)
values ('cccccccc-0000-0000-0000-000000000006'::uuid, 'cccccccc-0000-0000-0000-000000000004'::uuid, 2, 90, 5, now() + interval '1 minute');

select ok(
  not (select is_pr from sets where id = 'cccccccc-0000-0000-0000-000000000006'::uuid),
  'lighter second set is not flagged as a PR'
);

-- Set 3: 20kg x 20 (endurance range) -> numerically huge e1RM, must NEVER be a PR.
insert into sets (id, session_exercise_id, set_number, weight, reps, completed_at)
values ('cccccccc-0000-0000-0000-000000000007'::uuid, 'cccccccc-0000-0000-0000-000000000004'::uuid, 3, 20, 20, now() + interval '2 minutes');

select ok(
  not (select is_pr from sets where id = 'cccccccc-0000-0000-0000-000000000007'::uuid),
  'high-rep set (20 reps) is never flagged as a PR regardless of numeric e1RM'
);

-- Deleting the original PR set should retroactively promote the 90kg x5 set to PR.
delete from sets where id = 'cccccccc-0000-0000-0000-000000000005'::uuid;

select ok(
  (select is_pr from sets where id = 'cccccccc-0000-0000-0000-000000000006'::uuid),
  'deleting the original PR set promotes the next-best eligible set to PR'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec supabase test db`
Expected: FAIL — `is_pr` stays `false` for everything (default), since no trigger exists yet.

- [ ] **Step 3: Generate and write the migration**

Run: `pnpm exec supabase migration new create_pr_trigger`, fill with:

```sql
create or replace function recompute_is_pr_for_exercise(p_user_id uuid, p_exercise_id uuid)
returns void
language plpgsql
as $$
declare
  running_max numeric := 0;
  rec record;
  e1rm numeric;
begin
  for rec in
    select st.id, st.weight, st.reps
    from sets st
    join session_exercises se on se.id = st.session_exercise_id
    join sessions s on s.id = se.session_id
    where s.user_id = p_user_id
      and se.exercise_id = p_exercise_id
    order by st.completed_at asc, st.id asc
  loop
    if rec.reps <= 12 then
      e1rm := rec.weight * (1 + rec.reps / 30.0);
      if e1rm > running_max then
        update sets set is_pr = true where id = rec.id;
        running_max := e1rm;
      else
        update sets set is_pr = false where id = rec.id;
      end if;
    else
      update sets set is_pr = false where id = rec.id;
    end if;
  end loop;
end;
$$;

create or replace function trg_sets_recompute_pr()
returns trigger
language plpgsql
as $$
declare
  affected_user_id uuid;
  affected_exercise_id uuid;
begin
  select s.user_id, se.exercise_id
  into affected_user_id, affected_exercise_id
  from session_exercises se
  join sessions s on s.id = se.session_id
  where se.id = coalesce(new.session_exercise_id, old.session_exercise_id);

  perform recompute_is_pr_for_exercise(affected_user_id, affected_exercise_id);

  return null;
end;
$$;

-- Column-scoped on (weight, reps, completed_at): an update that touches only is_pr
-- (which is exactly what recompute_is_pr_for_exercise does) does not re-fire this
-- trigger, so there is no infinite recursion.
create trigger sets_recompute_pr
after insert or delete or update of weight, reps, completed_at on sets
for each row
execute function trg_sets_recompute_pr();
```

- [ ] **Step 4: Apply and verify the test passes**

Run: `pnpm exec supabase db reset && pnpm exec supabase test db`
Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations supabase/tests/database/05_pr_trigger.sql
git commit -m "feat(db): add PR detection trigger with Epley formula and high-rep guard"
```

**M1 schema/RLS exit check:** `pnpm exec supabase test db` passes end to end (all five test
files, 22 assertions total).

---

### Task 13: Seed script — free-exercise-db import with equipment normalization

**Files:**
- Create: `scripts/data/.gitkeep`
- Modify: root `package.json` (add `@supabase/supabase-js` dependency and `tsx`)
- Create: `scripts/seed-exercises.ts`

**Interfaces:**
- Consumes: `equipment_catalog`, `exercises`, `exercise_equipment` (Tasks 8–9), a running
  local Supabase instance (Task 5).
- Produces: populated `equipment_catalog` and `exercises`/`exercise_equipment` rows with
  `source = 'seed'`. Task 14's tagging script reads these rows back out.

This is a one-off data script, not covered by an automated test — its correctness is
verified by inspection of the row counts it prints and a manual spot-check in Supabase
Studio.

- [ ] **Step 1: Add dependencies for the script**

Run: `pnpm add -D -w tsx && pnpm add -w @supabase/supabase-js`

- [ ] **Step 2: Download the dataset**

Run: `mkdir -p scripts/data && curl -o scripts/data/free-exercise-db.json https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json`
Expected: a JSON file of ~870 exercise objects. If this URL 404s (the repo has reorganized
before), browse https://github.com/yuhonas/free-exercise-db for the current path to the
combined exercises JSON file and adjust the URL accordingly.

- [ ] **Step 3: Write `scripts/seed-exercises.ts`**

```ts
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY env var is required (see `supabase start` output)');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface FreeExerciseDbEntry {
  name: string;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
}

const EQUIPMENT_NORMALIZATION: Record<string, { name: string; category: string }> = {
  barbell: { name: 'Barbell', category: 'free_weight' },
  dumbbell: { name: 'Dumbbell', category: 'free_weight' },
  'body only': { name: 'Bodyweight', category: 'bodyweight' },
  cable: { name: 'Cable Machine', category: 'machine' },
  machine: { name: 'Machine', category: 'machine' },
  kettlebells: { name: 'Kettlebell', category: 'free_weight' },
  bands: { name: 'Resistance Band', category: 'accessory' },
  'medicine ball': { name: 'Medicine Ball', category: 'accessory' },
  'exercise ball': { name: 'Exercise Ball', category: 'accessory' },
  'e-z curl bar': { name: 'EZ Curl Bar', category: 'free_weight' },
  'foam roll': { name: 'Foam Roller', category: 'accessory' },
  other: { name: 'Other', category: 'accessory' },
};

async function main() {
  const raw = readFileSync(new URL('./data/free-exercise-db.json', import.meta.url), 'utf-8');
  const entries: FreeExerciseDbEntry[] = JSON.parse(raw);

  const equipmentValues = new Set(
    entries
      .map((e) => e.equipment?.toLowerCase())
      .filter((v): v is string => Boolean(v)),
  );

  for (const value of equipmentValues) {
    if (!EQUIPMENT_NORMALIZATION[value]) {
      throw new Error(`Unmapped equipment value in dataset: "${value}" — add it to EQUIPMENT_NORMALIZATION`);
    }
  }

  const catalogRows = Array.from(equipmentValues).map((v) => EQUIPMENT_NORMALIZATION[v]);
  const { data: insertedCatalog, error: catalogError } = await supabase
    .from('equipment_catalog')
    .upsert(catalogRows, { onConflict: 'name' })
    .select('id, name');

  if (catalogError) throw catalogError;

  const catalogIdByName = new Map(insertedCatalog!.map((row) => [row.name as string, row.id as string]));

  let exerciseCount = 0;
  for (const entry of entries) {
    const { data: insertedExercise, error: exerciseError } = await supabase
      .from('exercises')
      .insert({
        name: entry.name,
        primary_muscles: entry.primaryMuscles,
        secondary_muscles: entry.secondaryMuscles,
        instructions: entry.instructions.join('\n'),
        source: 'seed',
      })
      .select('id')
      .single();

    if (exerciseError) throw exerciseError;
    exerciseCount += 1;

    if (entry.equipment) {
      const normalized = EQUIPMENT_NORMALIZATION[entry.equipment.toLowerCase()];
      const catalogId = catalogIdByName.get(normalized.name);
      if (!catalogId) throw new Error(`Missing catalog id for ${normalized.name}`);

      const { error: linkError } = await supabase
        .from('exercise_equipment')
        .insert({ exercise_id: insertedExercise!.id, equipment_catalog_id: catalogId });

      if (linkError) throw linkError;
    }
  }

  console.log(`Seeded ${exerciseCount} exercises and ${catalogRows.length} equipment catalog entries.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Run the seed script against local Supabase**

Run: `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<from supabase start> pnpm exec tsx scripts/seed-exercises.ts`
Expected: prints `Seeded ~870 exercises and ~11 equipment catalog entries.` with no errors.

- [ ] **Step 5: Spot-check in Supabase Studio**

Open the Studio URL printed by `supabase start` (usually `http://127.0.0.1:54323`), browse
the `exercises` table, and confirm rows look sane (non-empty `primary_muscles`, `source =
'seed'`, `user_id` null).

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-exercises.ts scripts/data/.gitkeep package.json pnpm-lock.yaml
git commit -m "feat(seed): import free-exercise-db into equipment_catalog/exercises"
```

Note: `scripts/data/free-exercise-db.json` itself is a large generated/downloaded file —
add `scripts/data/*.json` to `.gitignore` in this same commit so it isn't checked in; the
download command in Step 2 is how any future environment reproduces it.

---

### Task 14: One-off LLM tagging pass (`movement_pattern`, `is_compound`) with human review

**Files:**
- Create: `scripts/tag-exercises.ts`
- Create: `scripts/apply-movement-tags.ts`

**Interfaces:**
- Consumes: `exercises` rows with `source = 'seed'` (Task 13 output).
- Produces: updates `exercises.movement_pattern` and `exercises.is_compound` for all seed
  rows — this is what Task 8's degradation-ladder consumers (M2) rely on for movement-based
  deduplication.

- [ ] **Step 1: Add the Anthropic SDK dependency**

Run: `pnpm add -w @anthropic-ai/sdk`

- [ ] **Step 2: Write `scripts/tag-exercises.ts`**

```ts
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync } from 'node:fs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY env var is required');
if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY env var is required');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

interface SourceExercise {
  id: string;
  name: string;
  primary_muscles: string[];
}

interface TagResult {
  id: string;
  movement_pattern: string;
  is_compound: boolean;
}

const BATCH_SIZE = 40;

async function tagBatch(batch: SourceExercise[]): Promise<TagResult[]> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `For each exercise below, assign:
- movement_pattern: a short lowercase-with-hyphens label grouping equipment variants of the same movement (e.g. "bench-press", "barbell-row", "back-squat"). Equipment variants of the same movement must share the same label.
- is_compound: true if the exercise works multiple major muscle groups/joints at once (e.g. squat, bench press, deadlift, row), false for single-joint isolation exercises (e.g. bicep curl, leg extension).

Respond with ONLY a JSON array of {"id": "...", "movement_pattern": "...", "is_compound": true|false}, one entry per exercise, no other text.

Exercises:
${batch.map((e) => `- id: ${e.id}, name: "${e.name}", primary_muscles: ${e.primary_muscles.join(', ')}`).join('\n')}`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text response from Claude');

  return JSON.parse(textBlock.text) as TagResult[];
}

async function main() {
  const { data: exercises, error } = await supabase
    .from('exercises')
    .select('id, name, primary_muscles')
    .eq('source', 'seed');

  if (error) throw error;
  if (!exercises || exercises.length === 0) throw new Error('No seed exercises found — run scripts/seed-exercises.ts first');

  const allResults: TagResult[] = [];
  for (let i = 0; i < exercises.length; i += BATCH_SIZE) {
    const batch = exercises.slice(i, i + BATCH_SIZE);
    const results = await tagBatch(batch);
    allResults.push(...results);
    console.log(`Tagged ${allResults.length}/${exercises.length}`);
  }

  writeFileSync('scripts/data/movement-tags-review.json', JSON.stringify(allResults, null, 2));
  console.log(
    'Wrote scripts/data/movement-tags-review.json — review and hand-edit this file, then run scripts/apply-movement-tags.ts',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Write `scripts/apply-movement-tags.ts`**

```ts
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY env var is required');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface TagResult {
  id: string;
  movement_pattern: string;
  is_compound: boolean;
}

async function main() {
  const raw = readFileSync('scripts/data/movement-tags-review.json', 'utf-8');
  const tags: TagResult[] = JSON.parse(raw);

  for (const tag of tags) {
    const { error } = await supabase
      .from('exercises')
      .update({ movement_pattern: tag.movement_pattern, is_compound: tag.is_compound })
      .eq('id', tag.id);

    if (error) throw error;
  }

  console.log(`Applied movement_pattern/is_compound to ${tags.length} exercises.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Run the tagging pass**

Run: `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<key> ANTHROPIC_API_KEY=<key> pnpm exec tsx scripts/tag-exercises.ts`
Expected: `scripts/data/movement-tags-review.json` written with ~870 entries.

- [ ] **Step 5: Human review (budget an evening for this)**

Open `scripts/data/movement-tags-review.json` and skim it. Look specifically for: obviously
wrong `is_compound` flags (isolation exercises marked compound or vice versa), and
`movement_pattern` labels that should match but don't (e.g. "Barbell Bench Press" tagged
`bench-press` but "Incline Dumbbell Bench Press" tagged `incline-bench-press` — these
should usually share a pattern unless the incline genuinely changes the movement enough to
matter for your swap feature). Hand-edit the JSON file directly to fix.

- [ ] **Step 6: Apply the reviewed tags**

Run: `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<key> pnpm exec tsx scripts/apply-movement-tags.ts`
Expected: `Applied movement_pattern/is_compound to ~870 exercises.`

- [ ] **Step 7: Commit**

```bash
git add scripts/tag-exercises.ts scripts/apply-movement-tags.ts package.json pnpm-lock.yaml
git commit -m "feat(seed): add one-off LLM movement-pattern/is_compound tagging pass"
```

Note: `scripts/data/movement-tags-review.json` is a generated-then-hand-edited artifact of
this one-off process, not source of truth (the database is) — add `scripts/data/*.json` to
`.gitignore` alongside the raw dataset file from Task 13, rather than committing it.

---

### Task 15: CI — add Supabase DB test job

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `supabase/migrations/*` and `supabase/tests/database/*` (Tasks 7–12).

- [ ] **Step 1: Add a `db-tests` job to `.github/workflows/ci.yml`**

```yaml
  db-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: supabase start
      - run: supabase test db
```

The full file now has two jobs (`lint-and-test` and `db-tests`) under `jobs:`. This job
intentionally does not run the seed/tagging scripts from Tasks 13–14 — those depend on an
external network fetch and an LLM API key, which would make CI flaky and costly. CI only
proves the schema/RLS/trigger are correct; seeding is a one-time local/deploy-time step.

- [ ] **Step 2: Verify locally**

Run: `pnpm exec supabase test db`
Expected: PASS (same as Task 12's final check — this step just confirms nothing regressed).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run supabase db tests (migrations + pgTAP) on push/PR"
```

**M1 exit check:** `pnpm exec supabase test db` is green locally and in CI; `exercises` and
`equipment_catalog` are populated via Tasks 13–14 in your local dev database (not required
in CI).

---

## M2 — Rule Engine

### Task 16: Shared types

**Files:**
- Create: `packages/rule-engine/src/types.ts`

**Interfaces:**
- Produces: `Goal`, `Exercise`, `GenerationInput`, `GoalTemplate`, `GeneratedExercise`,
  `GenerationResult` — every subsequent M2 task imports from this file.

No test for this task — it's pure type declarations, exercised indirectly by every later
task's tests.

- [ ] **Step 1: Create `packages/rule-engine/src/types.ts`**

```ts
export type Goal = 'strength' | 'hypertrophy' | 'endurance' | 'fat_loss';

export interface Exercise {
  id: string;
  name: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  movementPattern: string;
  isCompound: boolean;
  requiredEquipmentIds: string[];
}

export interface GenerationInput {
  exerciseLibrary: Exercise[];
  availableEquipmentIds: string[];
  targetMuscleGroups: string[];
  goal: Goal;
  targetExerciseCount: number;
}

export interface GoalTemplate {
  sets: number;
  reps: number;
  restSeconds: number;
}

export interface GeneratedExercise {
  exerciseId: string;
  order: number;
  targetSets: number;
  targetReps: number;
  restSeconds: number;
}

export interface GenerationResult {
  exercises: GeneratedExercise[];
  shortfall: number;
}
```

- [ ] **Step 2: Run the build to verify it compiles**

Run: `pnpm --filter @app/rule-engine build`
Expected: succeeds, `packages/rule-engine/dist/types.js` and `.d.ts` produced.

- [ ] **Step 3: Commit**

```bash
git add packages/rule-engine/src/types.ts
git commit -m "feat(rule-engine): add shared generation types"
```

---

### Task 17: Equipment filter (pure AND)

**Files:**
- Create: `packages/rule-engine/src/filterByEquipment.ts`
- Test: `packages/rule-engine/src/filterByEquipment.test.ts`

**Interfaces:**
- Consumes: `Exercise` (Task 16).
- Produces: `filterByEquipment(exercises: Exercise[], availableEquipmentIds: string[]):
  Exercise[]` — used by `generate()` (Task 21).

- [ ] **Step 1: Write the failing test — `packages/rule-engine/src/filterByEquipment.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { filterByEquipment } from './filterByEquipment.js';
import type { Exercise } from './types.js';

const bodyweightPushup: Exercise = {
  id: 'ex-pushup',
  name: 'Push-up',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['triceps'],
  movementPattern: 'push-up',
  isCompound: true,
  requiredEquipmentIds: [],
};

const barbellBenchPress: Exercise = {
  id: 'ex-bench',
  name: 'Barbell Bench Press',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['triceps'],
  movementPattern: 'bench-press',
  isCompound: true,
  requiredEquipmentIds: ['eq-barbell', 'eq-bench'],
};

describe('filterByEquipment', () => {
  it('includes exercises requiring no equipment regardless of availability', () => {
    const result = filterByEquipment([bodyweightPushup], []);
    expect(result).toEqual([bodyweightPushup]);
  });

  it('excludes an exercise when only some of its required equipment is available (AND, not OR)', () => {
    const result = filterByEquipment([barbellBenchPress], ['eq-barbell']);
    expect(result).toEqual([]);
  });

  it('includes an exercise when all of its required equipment is available', () => {
    const result = filterByEquipment([barbellBenchPress], ['eq-barbell', 'eq-bench', 'eq-rack']);
    expect(result).toEqual([barbellBenchPress]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @app/rule-engine test`
Expected: FAIL — `Cannot find module './filterByEquipment.js'`.

- [ ] **Step 3: Create `packages/rule-engine/src/filterByEquipment.ts`**

```ts
import type { Exercise } from './types.js';

export function filterByEquipment(exercises: Exercise[], availableEquipmentIds: string[]): Exercise[] {
  const available = new Set(availableEquipmentIds);
  return exercises.filter((exercise) =>
    exercise.requiredEquipmentIds.every((id) => available.has(id)),
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @app/rule-engine test`
Expected: PASS — 3 tests passed (plus Task 3's smoke test, still passing).

- [ ] **Step 5: Commit**

```bash
git add packages/rule-engine/src/filterByEquipment.ts packages/rule-engine/src/filterByEquipment.test.ts
git commit -m "feat(rule-engine): add pure-AND equipment filter"
```

---

### Task 18: Muscle-group selection with movement-pattern dedup and compound-first ordering

**Files:**
- Create: `packages/rule-engine/src/selectByMuscleGroup.ts`
- Test: `packages/rule-engine/src/selectByMuscleGroup.test.ts`

**Interfaces:**
- Consumes: `Exercise` (Task 16).
- Produces: `selectByMuscleGroup(candidates: Exercise[], targetMuscleGroups: string[],
  count: number): Exercise[]` — used directly by Task 19's degradation ladder as its first
  rung.

- [ ] **Step 1: Write the failing test — `packages/rule-engine/src/selectByMuscleGroup.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { selectByMuscleGroup } from './selectByMuscleGroup.js';
import type { Exercise } from './types.js';

function makeExercise(overrides: Partial<Exercise> & Pick<Exercise, 'id' | 'movementPattern'>): Exercise {
  return {
    name: overrides.id,
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    isCompound: false,
    requiredEquipmentIds: [],
    ...overrides,
  };
}

describe('selectByMuscleGroup', () => {
  it('never selects two exercises with the same movement pattern', () => {
    const benchA = makeExercise({ id: 'a', movementPattern: 'bench-press' });
    const benchB = makeExercise({ id: 'b', movementPattern: 'bench-press' });
    const flye = makeExercise({ id: 'c', movementPattern: 'chest-flye' });

    const result = selectByMuscleGroup([benchA, benchB, flye], ['chest'], 3);

    const patterns = result.map((e) => e.movementPattern);
    expect(new Set(patterns).size).toBe(patterns.length);
    expect(result.length).toBe(2); // only 2 distinct patterns exist
  });

  it('orders compound exercises before isolation exercises', () => {
    const isolation = makeExercise({ id: 'iso', movementPattern: 'chest-flye', isCompound: false });
    const compound = makeExercise({ id: 'comp', movementPattern: 'bench-press', isCompound: true });

    const result = selectByMuscleGroup([isolation, compound], ['chest'], 2);

    expect(result.map((e) => e.id)).toEqual(['comp', 'iso']);
  });

  it('only includes exercises matching a target muscle group', () => {
    const chestExercise = makeExercise({ id: 'chest-ex', movementPattern: 'bench-press', primaryMuscles: ['chest'] });
    const backExercise = makeExercise({ id: 'back-ex', movementPattern: 'row', primaryMuscles: ['back'] });

    const result = selectByMuscleGroup([chestExercise, backExercise], ['chest'], 2);

    expect(result.map((e) => e.id)).toEqual(['chest-ex']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @app/rule-engine test`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `packages/rule-engine/src/selectByMuscleGroup.ts`**

```ts
import type { Exercise } from './types.js';

export function selectByMuscleGroup(
  candidates: Exercise[],
  targetMuscleGroups: string[],
  count: number,
): Exercise[] {
  const matching = candidates.filter((exercise) =>
    exercise.primaryMuscles.some((muscle) => targetMuscleGroups.includes(muscle)),
  );

  const sorted = [...matching].sort((a, b) => Number(b.isCompound) - Number(a.isCompound));

  const seenPatterns = new Set<string>();
  const selected: Exercise[] = [];

  for (const exercise of sorted) {
    if (selected.length >= count) break;
    if (seenPatterns.has(exercise.movementPattern)) continue;
    seenPatterns.add(exercise.movementPattern);
    selected.push(exercise);
  }

  return selected;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @app/rule-engine test`
Expected: PASS — 3 new tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/rule-engine/src/selectByMuscleGroup.ts packages/rule-engine/src/selectByMuscleGroup.test.ts
git commit -m "feat(rule-engine): select by muscle group with movement-pattern dedup"
```

---

### Task 19: Degradation ladder

**Files:**
- Create: `packages/rule-engine/src/degradationLadder.ts`
- Test: `packages/rule-engine/src/degradationLadder.test.ts`

**Interfaces:**
- Consumes: `Exercise` (Task 16), `selectByMuscleGroup` (Task 18).
- Produces: `selectWithDegradationLadder(candidates: Exercise[], targetMuscleGroups:
  string[], count: number): { exercises: Exercise[]; shortfall: number }` — used by
  `generate()` (Task 21). This is the function the M2 exit test targets directly.

- [ ] **Step 1: Write the failing test — `packages/rule-engine/src/degradationLadder.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { selectWithDegradationLadder } from './degradationLadder.js';
import type { Exercise } from './types.js';

function makeExercise(overrides: Partial<Exercise> & Pick<Exercise, 'id' | 'movementPattern'>): Exercise {
  return {
    name: overrides.id,
    primaryMuscles: [],
    secondaryMuscles: [],
    isCompound: false,
    requiredEquipmentIds: [],
    ...overrides,
  };
}

describe('selectWithDegradationLadder', () => {
  it('rung 1: fully satisfies the target using only primary-muscle matches when enough exist', () => {
    const a = makeExercise({ id: 'a', movementPattern: 'squat', primaryMuscles: ['quads'] });
    const b = makeExercise({ id: 'b', movementPattern: 'lunge', primaryMuscles: ['quads'] });

    const result = selectWithDegradationLadder([a, b], ['quads'], 2);

    expect(result.shortfall).toBe(0);
    expect(result.exercises.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });

  it('rung 2: falls back to secondary-muscle matches when primary matches run out', () => {
    const primaryMatch = makeExercise({ id: 'primary', movementPattern: 'squat', primaryMuscles: ['quads'] });
    const secondaryMatch = makeExercise({
      id: 'secondary',
      movementPattern: 'lunge',
      primaryMuscles: ['glutes'],
      secondaryMuscles: ['quads'],
    });

    const result = selectWithDegradationLadder([primaryMatch, secondaryMatch], ['quads'], 2);

    expect(result.shortfall).toBe(0);
    expect(result.exercises.map((e) => e.id).sort()).toEqual(['primary', 'secondary']);
  });

  it('rung 3: repeats a movement pattern when no distinct pattern remains, reporting no shortfall if count is met', () => {
    const squatA = makeExercise({ id: 'squat-a', movementPattern: 'squat', primaryMuscles: ['quads'] });
    const squatB = makeExercise({ id: 'squat-b', movementPattern: 'squat', primaryMuscles: ['quads'] });

    const result = selectWithDegradationLadder([squatA, squatB], ['quads'], 2);

    expect(result.shortfall).toBe(0);
    expect(result.exercises.map((e) => e.id).sort()).toEqual(['squat-a', 'squat-b']);
  });

  it('reports a shortfall and returns what it could find when the library is too sparse', () => {
    const onlyOption = makeExercise({ id: 'only', movementPattern: 'squat', primaryMuscles: ['quads'] });

    const result = selectWithDegradationLadder([onlyOption], ['quads'], 3);

    expect(result.shortfall).toBe(2);
    expect(result.exercises.map((e) => e.id)).toEqual(['only']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @app/rule-engine test`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `packages/rule-engine/src/degradationLadder.ts`**

```ts
import type { Exercise } from './types.js';
import { selectByMuscleGroup } from './selectByMuscleGroup.js';

export interface DegradationResult {
  exercises: Exercise[];
  shortfall: number;
}

export function selectWithDegradationLadder(
  candidates: Exercise[],
  targetMuscleGroups: string[],
  count: number,
): DegradationResult {
  // Rung 1: primary-muscle match, one exercise per movement pattern.
  const selected = selectByMuscleGroup(candidates, targetMuscleGroups, count);
  if (selected.length >= count) {
    return { exercises: selected.slice(0, count), shortfall: 0 };
  }

  // Rung 2: also allow secondary-muscle matches, still one per movement pattern.
  const selectedIds = new Set(selected.map((e) => e.id));
  const secondaryMatches = candidates.filter(
    (exercise) =>
      !selectedIds.has(exercise.id) &&
      exercise.secondaryMuscles.some((muscle) => targetMuscleGroups.includes(muscle)),
  );
  const sortedSecondary = [...secondaryMatches].sort(
    (a, b) => Number(b.isCompound) - Number(a.isCompound),
  );
  const seenPatterns = new Set(selected.map((e) => e.movementPattern));
  for (const exercise of sortedSecondary) {
    if (selected.length >= count) break;
    if (seenPatterns.has(exercise.movementPattern)) continue;
    seenPatterns.add(exercise.movementPattern);
    selected.push(exercise);
    selectedIds.add(exercise.id);
  }
  if (selected.length >= count) {
    return { exercises: selected.slice(0, count), shortfall: 0 };
  }

  // Rung 3: allow repeated movement patterns among any primary-or-secondary match.
  const primaryOrSecondary = candidates.filter(
    (exercise) =>
      exercise.primaryMuscles.some((m) => targetMuscleGroups.includes(m)) ||
      exercise.secondaryMuscles.some((m) => targetMuscleGroups.includes(m)),
  );
  const sortedAll = [...primaryOrSecondary].sort(
    (a, b) => Number(b.isCompound) - Number(a.isCompound),
  );
  for (const exercise of sortedAll) {
    if (selected.length >= count) break;
    if (selectedIds.has(exercise.id)) continue;
    selectedIds.add(exercise.id);
    selected.push(exercise);
  }

  const shortfall = Math.max(0, count - selected.length);
  return { exercises: selected.slice(0, count), shortfall };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @app/rule-engine test`
Expected: PASS — 4 new tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/rule-engine/src/degradationLadder.ts packages/rule-engine/src/degradationLadder.test.ts
git commit -m "feat(rule-engine): add equipment/muscle-group degradation ladder"
```

---

### Task 20: Goal templates

**Files:**
- Create: `packages/rule-engine/src/goalTemplates.ts`
- Test: `packages/rule-engine/src/goalTemplates.test.ts`

**Interfaces:**
- Consumes: `Goal`, `GoalTemplate` (Task 16).
- Produces: `getGoalTemplate(goal: Goal): GoalTemplate` — used by `generate()` (Task 21).

- [ ] **Step 1: Write the failing test — `packages/rule-engine/src/goalTemplates.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { getGoalTemplate } from './goalTemplates.js';

describe('getGoalTemplate', () => {
  it('returns a low-rep, long-rest template for strength', () => {
    const template = getGoalTemplate('strength');
    expect(template.reps).toBeLessThanOrEqual(6);
    expect(template.restSeconds).toBeGreaterThanOrEqual(180);
  });

  it('returns a high-rep, short-rest template for endurance', () => {
    const template = getGoalTemplate('endurance');
    expect(template.reps).toBeGreaterThanOrEqual(15);
    expect(template.restSeconds).toBeLessThanOrEqual(60);
  });

  it('returns a template for every goal', () => {
    for (const goal of ['strength', 'hypertrophy', 'endurance', 'fat_loss'] as const) {
      const template = getGoalTemplate(goal);
      expect(template.sets).toBeGreaterThan(0);
      expect(template.reps).toBeGreaterThan(0);
      expect(template.restSeconds).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @app/rule-engine test`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `packages/rule-engine/src/goalTemplates.ts`**

```ts
import type { Goal, GoalTemplate } from './types.js';

const GOAL_TEMPLATES: Record<Goal, GoalTemplate> = {
  strength: { sets: 4, reps: 4, restSeconds: 240 },
  hypertrophy: { sets: 3, reps: 10, restSeconds: 75 },
  endurance: { sets: 3, reps: 18, restSeconds: 40 },
  fat_loss: { sets: 3, reps: 12, restSeconds: 60 },
};

export function getGoalTemplate(goal: Goal): GoalTemplate {
  return GOAL_TEMPLATES[goal];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @app/rule-engine test`
Expected: PASS — 3 new tests passed.

- [ ] **Step 5: Commit**

```bash
git add packages/rule-engine/src/goalTemplates.ts packages/rule-engine/src/goalTemplates.test.ts
git commit -m "feat(rule-engine): add goal-based sets/reps/rest templates"
```

---

### Task 21: `generate()` composition and the M2 exit test

**Files:**
- Create: `packages/rule-engine/src/generate.ts`
- Test: `packages/rule-engine/src/generate.test.ts`
- Modify: `packages/rule-engine/src/index.ts`
- Modify: `packages/rule-engine/src/index.test.ts` (replaces Task 3's smoke assertion, which
  targeted the now-removed `RULE_ENGINE_VERSION` export)

**Interfaces:**
- Consumes: `filterByEquipment` (Task 17), `selectWithDegradationLadder` (Task 19),
  `getGoalTemplate` (Task 20), `GenerationInput`/`GenerationResult` (Task 16).
- Produces: `generate(input: GenerationInput): GenerationResult` — this is the engine's
  public entry point; M3's mobile app and M6's import materialization both call this
  function (and nothing else in this package) once built.

- [ ] **Step 1: Write the failing exit test — `packages/rule-engine/src/generate.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { generate } from './generate.js';
import type { Exercise } from './types.js';

const bodyweightSquat: Exercise = {
  id: 'ex-bw-squat',
  name: 'Bodyweight Squat',
  primaryMuscles: ['quads'],
  secondaryMuscles: ['glutes'],
  movementPattern: 'squat',
  isCompound: true,
  requiredEquipmentIds: [],
};

const bodyweightLunge: Exercise = {
  id: 'ex-bw-lunge',
  name: 'Bodyweight Lunge',
  primaryMuscles: ['quads'],
  secondaryMuscles: ['glutes'],
  movementPattern: 'lunge',
  isCompound: true,
  requiredEquipmentIds: [],
};

const barbellBackSquat: Exercise = {
  id: 'ex-bb-squat',
  name: 'Barbell Back Squat',
  primaryMuscles: ['quads'],
  secondaryMuscles: ['glutes'],
  movementPattern: 'squat',
  isCompound: true,
  requiredEquipmentIds: ['eq-barbell', 'eq-rack'],
};

describe('generate', () => {
  it('a sparse home-gym equipment profile still yields a sensible leg day', () => {
    const result = generate({
      exerciseLibrary: [bodyweightSquat, bodyweightLunge, barbellBackSquat],
      availableEquipmentIds: [], // no equipment at all
      targetMuscleGroups: ['quads'],
      goal: 'hypertrophy',
      targetExerciseCount: 3,
    });

    // Barbell squat is filtered out entirely (equipment unavailable). Only 2 bodyweight
    // leg exercises exist in the library, so the target of 3 can't be fully met.
    expect(result.exercises.map((e) => e.exerciseId).sort()).toEqual(
      ['ex-bw-lunge', 'ex-bw-squat'].sort(),
    );
    expect(result.shortfall).toBe(1);
    expect(result.exercises.every((e) => e.targetSets === 3 && e.targetReps === 10)).toBe(true);
  });

  it('never repeats a movement pattern when enough distinct patterns exist', () => {
    const anotherSquatVariant: Exercise = {
      id: 'ex-bw-squat-2',
      name: 'Goblet Squat',
      primaryMuscles: ['quads'],
      secondaryMuscles: ['glutes'],
      movementPattern: 'squat',
      isCompound: true,
      requiredEquipmentIds: [],
    };
    const library = [bodyweightSquat, bodyweightLunge, anotherSquatVariant];

    const result = generate({
      exerciseLibrary: library,
      availableEquipmentIds: [],
      targetMuscleGroups: ['quads'],
      goal: 'strength',
      targetExerciseCount: 2,
    });

    const patterns = result.exercises.map(
      (e) => library.find((ex) => ex.id === e.exerciseId)?.movementPattern,
    );
    expect(new Set(patterns).size).toBe(patterns.length);
    expect(result.shortfall).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @app/rule-engine test`
Expected: FAIL — `Cannot find module './generate.js'`.

- [ ] **Step 3: Create `packages/rule-engine/src/generate.ts`**

```ts
import type { GenerationInput, GenerationResult } from './types.js';
import { filterByEquipment } from './filterByEquipment.js';
import { selectWithDegradationLadder } from './degradationLadder.js';
import { getGoalTemplate } from './goalTemplates.js';

export function generate(input: GenerationInput): GenerationResult {
  const equipmentFiltered = filterByEquipment(input.exerciseLibrary, input.availableEquipmentIds);
  const { exercises, shortfall } = selectWithDegradationLadder(
    equipmentFiltered,
    input.targetMuscleGroups,
    input.targetExerciseCount,
  );

  const template = getGoalTemplate(input.goal);

  return {
    exercises: exercises.map((exercise, index) => ({
      exerciseId: exercise.id,
      order: index + 1,
      targetSets: template.sets,
      targetReps: template.reps,
      restSeconds: template.restSeconds,
    })),
    shortfall,
  };
}
```

- [ ] **Step 4: Replace the M0 smoke-test export in `packages/rule-engine/src/index.ts`**

```ts
export * from './types.js';
export * from './filterByEquipment.js';
export * from './selectByMuscleGroup.js';
export * from './degradationLadder.js';
export * from './goalTemplates.js';
export * from './generate.js';
```

- [ ] **Step 5: Update the now-obsolete smoke test**

`packages/rule-engine/src/index.test.ts` (from Task 3) asserted on `RULE_ENGINE_VERSION`,
which no longer exists. Replace its contents:

```ts
import { describe, expect, it } from 'vitest';
import { generate } from './index.js';

describe('rule-engine package public API', () => {
  it('exports generate from the package root', () => {
    expect(typeof generate).toBe('function');
  });
});
```

- [ ] **Step 6: Run the full package test suite to verify everything passes**

Run: `pnpm --filter @app/rule-engine test`
Expected: PASS — all tests across every file in this package pass, including the two new
`generate.test.ts` cases.

- [ ] **Step 7: Run the full monorepo lint+test to confirm nothing else regressed**

Run: `pnpm turbo run lint test`
Expected: PASS across `@app/api`, `@app/mobile`, `@app/rule-engine`.

- [ ] **Step 8: Commit**

```bash
git add packages/rule-engine/src/generate.ts packages/rule-engine/src/generate.test.ts packages/rule-engine/src/index.ts packages/rule-engine/src/index.test.ts
git commit -m "feat(rule-engine): compose generate() and expose public API"
```

**M2 exit check:** `pnpm --filter @app/rule-engine test` is green, and specifically the
"sparse home-gym equipment profile still yields a sensible leg day" test in `generate.test.ts`
passes.

---

## Overall M0–M2 Exit Check

- `pnpm turbo run lint test` passes locally and in CI.
- `pnpm exec supabase test db` passes locally and in CI (22 pgTAP assertions across
  equipment, exercises, programs, sessions, and the PR trigger).
- `exercises`/`equipment_catalog` are populated in your local dev Supabase instance via
  Tasks 13–14 (not required in CI).
- `packages/rule-engine` has a complete, independently testable generation engine with no
  HTTP/DB dependencies, ready to be imported by the mobile app in M3.
