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
