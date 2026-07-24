create extension if not exists moddatetime schema extensions;

create trigger exercises_set_updated_at
before update on exercises
for each row
execute function extensions.moddatetime(updated_at);
