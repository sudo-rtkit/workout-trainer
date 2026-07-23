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
