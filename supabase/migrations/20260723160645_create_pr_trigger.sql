create or replace function recompute_is_pr_for_exercise(p_user_id uuid, p_exercise_id uuid)
returns void
language plpgsql
as $$
declare
  running_max numeric := 0;
  rec record;
  e1rm numeric;
begin
  for rec in
    select st.id, st.weight, st.reps
    from sets st
    join session_exercises se on se.id = st.session_exercise_id
    join sessions s on s.id = se.session_id
    where s.user_id = p_user_id
      and se.exercise_id = p_exercise_id
    order by st.completed_at asc, st.id asc
  loop
    if rec.reps <= 12 then
      e1rm := rec.weight * (1 + rec.reps / 30.0);
      if e1rm > running_max then
        update sets set is_pr = true where id = rec.id;
        running_max := e1rm;
      else
        update sets set is_pr = false where id = rec.id;
      end if;
    else
      update sets set is_pr = false where id = rec.id;
    end if;
  end loop;
end;
$$;

create or replace function trg_sets_recompute_pr()
returns trigger
language plpgsql
as $$
declare
  affected_user_id uuid;
  affected_exercise_id uuid;
begin
  select s.user_id, se.exercise_id
  into affected_user_id, affected_exercise_id
  from session_exercises se
  join sessions s on s.id = se.session_id
  where se.id = coalesce(new.session_exercise_id, old.session_exercise_id);

  perform recompute_is_pr_for_exercise(affected_user_id, affected_exercise_id);

  return null;
end;
$$;

-- Column-scoped on (weight, reps, completed_at): an update that touches only is_pr
-- (which is exactly what recompute_is_pr_for_exercise does) does not re-fire this
-- trigger, so there is no infinite recursion.
create trigger sets_recompute_pr
after insert or delete or update of weight, reps, completed_at on sets
for each row
execute function trg_sets_recompute_pr();
