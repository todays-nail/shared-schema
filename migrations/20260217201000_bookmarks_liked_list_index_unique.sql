begin;

with ranked as (
  select
    ctid,
    row_number() over (
      partition by user_id, reference_id
      order by created_at desc, reference_id desc
    ) as rn
  from public.bookmarks
)
delete from public.bookmarks b
using ranked r
where b.ctid = r.ctid
  and r.rn > 1;

do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    join pg_class tbl on tbl.oid = i.indrelid
    join pg_namespace ns on ns.oid = tbl.relnamespace
    where ns.nspname = 'public'
      and tbl.relname = 'bookmarks'
      and i.indisunique
      and pg_get_indexdef(i.indexrelid) like '%(user_id, reference_id)%'
  ) then
    create unique index bookmarks_user_reference_unique_idx
      on public.bookmarks (user_id, reference_id);
  end if;
end $$;

create index if not exists bookmarks_user_created_reference_desc_idx
  on public.bookmarks (user_id, created_at desc, reference_id desc);

commit;
