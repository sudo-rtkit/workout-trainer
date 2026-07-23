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
