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
