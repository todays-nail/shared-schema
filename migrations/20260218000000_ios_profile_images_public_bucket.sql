begin;

insert into storage.buckets (id, name, public)
values ('profile-images-public', 'profile-images-public', true)
on conflict (id) do update
set public = excluded.public;

commit;
