-- Store discounted display price directly on references.
-- final_price is the source of truth for customer-visible price.

alter table public.references
  add column if not exists final_price integer;

update public.references
set final_price = coalesce(base_price, 0)
where final_price is null;

alter table public.references
  alter column final_price set default 0;

alter table public.references
  alter column final_price set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'references_final_price_range_check'
      and conrelid = 'public.references'::regclass
  ) then
    alter table public.references
      add constraint references_final_price_range_check
      check (
        final_price >= 0
        and (base_price is null or final_price <= base_price)
      );
  end if;
end
$$;
