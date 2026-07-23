begin;
select plan(5);

select has_table('public', 'equipment_catalog', 'equipment_catalog table exists');
select has_table('public', 'equipment_profiles', 'equipment_profiles table exists');
select has_table('public', 'equipment_profile_items', 'equipment_profile_items table exists');

select tests.create_test_user('alice@example.com') as alice_id \gset
select tests.create_test_user('bob@example.com') as bob_id \gset

select tests.authenticate_as(:'alice_id'::uuid);
insert into equipment_profiles (user_id, name) values (:'alice_id'::uuid, 'Alice Home Gym');

select tests.authenticate_as(:'bob_id'::uuid);
select is(
  (select count(*)::int from equipment_profiles),
  0,
  'bob sees zero equipment profiles despite alice having one'
);

select tests.authenticate_as(:'alice_id'::uuid);
select is(
  (select count(*)::int from equipment_profiles),
  1,
  'alice sees exactly her own equipment profile'
);

select * from finish();
rollback;
