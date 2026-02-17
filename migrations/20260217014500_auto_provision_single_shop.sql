-- Ensure every owner account has exactly one shop membership.
-- - Auto-provision owner/shop/membership on auth.users insert
-- - Backfill all existing auth.users
-- - Enforce one membership per user
-- - Fix references membership RLS predicates

create or replace function public.ensure_owner_shop_for_user(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_contact_name text;
  v_contact_phone text;

  v_verification_status text;
  v_verification_shop_name text;
  v_verification_owner_name text;
  v_verification_phone text;
  v_verification_address1 text;
  v_verification_address2 text;
  v_verification_business_no text;

  v_owner_name text;
  v_shop_phone text;
  v_shop_name text;
  v_shop_address text;
  v_shop_address_detail text;
  v_business_no text;
  v_candidate_business_no text;
  v_shop_status text;

  v_shop_id uuid;
begin
  if p_user_id is null then
    return null;
  end if;

  select
    u.email,
    nullif(trim(u.raw_user_meta_data ->> 'contact_name'), ''),
    nullif(trim(u.raw_user_meta_data ->> 'contact_phone'), '')
  into
    v_email,
    v_contact_name,
    v_contact_phone
  from auth.users u
  where u.id = p_user_id;

  if v_email is null then
    return null;
  end if;

  select
    ov.status,
    nullif(trim(ov.shop_name), ''),
    nullif(trim(ov.owner_name), ''),
    nullif(trim(ov.contact_phone), ''),
    nullif(trim(ov.shop_address1), ''),
    nullif(trim(ov.shop_address2), ''),
    nullif(regexp_replace(coalesce(ov.business_number, ''), '[^0-9]', '', 'g'), '')
  into
    v_verification_status,
    v_verification_shop_name,
    v_verification_owner_name,
    v_verification_phone,
    v_verification_address1,
    v_verification_address2,
    v_verification_business_no
  from public.owner_verifications ov
  where ov.user_id = p_user_id;

  v_owner_name := coalesce(
    v_verification_owner_name,
    v_contact_name,
    nullif(split_part(v_email, '@', 1), ''),
    '대표자'
  );

  v_shop_phone := coalesce(v_verification_phone, v_contact_phone, '010-0000-0000');

  insert into public.owners (id, manager_name, phone)
  values (p_user_id, v_owner_name, v_shop_phone)
  on conflict (id) do update
  set
    manager_name = excluded.manager_name,
    phone = excluded.phone,
    updated_at = now();

  -- Prefer already-linked shop if membership already exists.
  select sm.shop_id
  into v_shop_id
  from public.shop_members sm
  where sm.user_id = p_user_id
  order by sm.created_at asc, sm.shop_id asc
  limit 1;

  if v_shop_id is null then
    select s.id
    into v_shop_id
    from public.shops s
    where s.owner_id = p_user_id
    order by s.created_at asc, s.id asc
    limit 1;
  end if;

  if v_shop_id is null then
    v_shop_name := coalesce(v_verification_shop_name, '내 샵');
    v_shop_address := coalesce(v_verification_address1, '주소 미입력');
    v_shop_address_detail := v_verification_address2;

    v_business_no := coalesce(
      v_verification_business_no,
      format('TEMP-%s', replace(p_user_id::text, '-', ''))
    );

    v_candidate_business_no := v_business_no;

    if exists (
      select 1
      from public.shops s
      where s.business_registration_no = v_candidate_business_no
    ) then
      v_candidate_business_no := format('TEMP-%s', replace(p_user_id::text, '-', ''));

      if exists (
        select 1
        from public.shops s
        where s.business_registration_no = v_candidate_business_no
      ) then
        v_candidate_business_no := format(
          'TEMP-%s-%s',
          replace(p_user_id::text, '-', ''),
          substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
        );
      end if;
    end if;

    v_shop_status := case coalesce(v_verification_status, 'UNSUBMITTED')
      when 'APPROVED' then 'VERIFIED'
      when 'PENDING' then 'PENDING_VERIFY'
      when 'REJECTED' then 'REJECTED'
      else 'DRAFT'
    end;

    insert into public.shops (
      owner_id,
      name,
      representative_name,
      business_registration_no,
      phone,
      address,
      address_detail,
      status
    )
    values (
      p_user_id,
      v_shop_name,
      v_owner_name,
      v_candidate_business_no,
      v_shop_phone,
      v_shop_address,
      v_shop_address_detail,
      v_shop_status
    )
    returning id into v_shop_id;
  end if;

  insert into public.shop_members (user_id, shop_id, role)
  values (p_user_id, v_shop_id, 'owner')
  on conflict (user_id, shop_id) do update
  set role = 'owner';

  return v_shop_id;
end;
$$;
create or replace function public.handle_auth_user_created_provision_shop()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  perform public.ensure_owner_shop_for_user(new.id);
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_provision_shop on auth.users;
create trigger on_auth_user_created_provision_shop
after insert on auth.users
for each row
execute function public.handle_auth_user_created_provision_shop();
-- Backfill all existing auth users.
do $$
declare
  v_user_id uuid;
begin
  for v_user_id in
    select u.id
    from auth.users u
  loop
    perform public.ensure_owner_shop_for_user(v_user_id);
  end loop;
end
$$;
-- Keep only one membership per user (oldest created_at, then smallest shop_id).
with ranked as (
  select
    sm.user_id,
    sm.shop_id,
    row_number() over (
      partition by sm.user_id
      order by sm.created_at asc, sm.shop_id asc
    ) as rn
  from public.shop_members sm
)
delete from public.shop_members sm
using ranked r
where sm.user_id = r.user_id
  and sm.shop_id = r.shop_id
  and r.rn > 1;
create unique index if not exists shop_members_user_id_unique
  on public.shop_members (user_id);
-- Fix references policies to avoid ambiguous column resolution.
drop policy if exists references_select_by_membership on public.references;
create policy references_select_by_membership
on public.references
for select
to authenticated
using (
  shop_id in (
    select sm.shop_id
    from public.shop_members sm
    where sm.user_id = auth.uid()
  )
);
drop policy if exists references_insert_by_membership on public.references;
create policy references_insert_by_membership
on public.references
for insert
to authenticated
with check (
  shop_id in (
    select sm.shop_id
    from public.shop_members sm
    where sm.user_id = auth.uid()
  )
);
drop policy if exists references_delete_by_membership on public.references;
create policy references_delete_by_membership
on public.references
for delete
to authenticated
using (
  shop_id in (
    select sm.shop_id
    from public.shop_members sm
    where sm.user_id = auth.uid()
  )
);
