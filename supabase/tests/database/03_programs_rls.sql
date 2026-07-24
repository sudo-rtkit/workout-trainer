begin;
select plan(6);

select has_table('public', 'programs', 'programs table exists');
select has_table('public', 'program_days', 'program_days table exists');
select has_table('public', 'program_day_exercises', 'program_day_exercises table exists');

select tests.create_test_user('carol@example.com') as carol_id \gset
select tests.create_test_user('dave@example.com') as dave_id \gset

-- Seed exercise inserted as postgres (superuser), before switching role.
insert into exercises (id, name, source, primary_muscles)
values ('dddddddd-0000-0000-0000-000000000001'::uuid, 'Test Overhead Press', 'seed', array['shoulders']);

select tests.authenticate_as(:'carol_id'::uuid);
insert into programs (id, user_id, name, days_per_week)
values ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, :'carol_id'::uuid, 'Carol PPL', 6);

insert into program_days (id, program_id, "order", day_type, muscle_groups, goal)
values ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 1, 'push', array['shoulders'], 'strength');

insert into program_day_exercises (id, program_day_id, exercise_id, "order", target_sets, target_reps, rest_seconds)
values ('aaaaaaaa-0000-0000-0000-000000000003'::uuid, 'aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'dddddddd-0000-0000-0000-000000000001'::uuid, 1, 3, 5, 180);

select tests.authenticate_as(:'dave_id'::uuid);
select is(
  (select count(*)::int from programs),
  0,
  'dave cannot see carol''s program'
);

select is(
  (select count(*)::int from program_days),
  0,
  'dave cannot see carol''s program_days'
);

select is(
  (select count(*)::int from program_day_exercises),
  0,
  'dave cannot see carol''s program_day_exercises'
);

select * from finish();
rollback;
