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
