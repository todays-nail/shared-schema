-- Fix broken trigger function and unblock reference create flow.
-- Current client flow inserts references first, then reference_style_tags in later requests,
-- so deferred constraint trigger on references is not compatible.

create or replace function public.ensure_reference_has_style_tag()
returns trigger
language plpgsql
as $$
declare
  ref_id uuid;
  tag_count int;
begin
  if tg_table_name = 'references' then
    ref_id := new.id;
  else
    ref_id := new.reference_id;
  end if;

  select count(*)
    into tag_count
  from public.reference_style_tags
  where reference_id = ref_id;

  if tag_count = 0 then
    raise exception 'Reference % must have at least one style tag.', ref_id;
  end if;

  return new;
end;
$$;
drop trigger if exists trg_reference_style_tag_check on public.references;
