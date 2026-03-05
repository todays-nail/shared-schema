-- Extend provider check constraint for Apple social login support.

do $$
begin
  if to_regclass('public.user_identities') is null then
    return;
  end if;

  alter table public.user_identities
    drop constraint if exists user_identities_provider_check;

  alter table public.user_identities
    add constraint user_identities_provider_check
    check (provider in ('kakao', 'google', 'apple'));
end
$$;
