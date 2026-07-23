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
