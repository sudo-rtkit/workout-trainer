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
