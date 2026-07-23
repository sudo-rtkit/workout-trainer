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
