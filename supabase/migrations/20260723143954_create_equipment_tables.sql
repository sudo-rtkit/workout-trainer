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
