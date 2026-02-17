drop extension if exists "pg_net";

alter table "public"."reference_style_tags" drop constraint "reference_style_tags_tag_id_fkey";

alter table "public"."user_refresh_tokens" drop constraint "user_refresh_tokens_replaced_by_fkey";

alter table "public"."bookmarks" drop constraint "bookmarks_pkey";

alter table "public"."reference_categories" drop constraint "reference_categories_pkey";

alter table "public"."reference_options" drop constraint "reference_options_pkey";

drop index if exists "public"."bookmarks_reference_id_idx";

drop index if exists "public"."reference_categories_reference_id_idx";

drop index if exists "public"."reference_images_reference_id_idx";

drop index if exists "public"."reference_options_reference_id_idx";

drop index if exists "public"."reference_style_tags_reference_id_idx";

drop index if exists "public"."references_shop_id_idx";

drop index if exists "public"."shops_business_registration_no_key";

drop index if exists "public"."shops_owner_id_idx";

drop index if exists "public"."bookmarks_pkey";

drop index if exists "public"."reference_categories_pkey";

drop index if exists "public"."reference_options_pkey";


  create table "public"."ai_generations" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "reference_id" uuid,
    "reference_image_url" text,
    "external_image_url" text,
    "hand_image_url" text not null,
    "result_image_url" text not null,
    "nail_shape" text,
    "brightness" text not null default 'NORMAL'::text,
    "prompt" text,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."ai_generations" enable row level security;


  create table "public"."categories" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "is_active" boolean not null default true,
    "sort_order" integer not null default 0
      );


alter table "public"."categories" enable row level security;


  create table "public"."options" (
    "id" uuid not null default gen_random_uuid(),
    "shop_id" uuid not null,
    "type" text not null,
    "name" text not null,
    "price" integer not null default 0,
    "unit_price" integer not null default 0,
    "min_qty" integer not null default 0,
    "max_qty" integer,
    "is_active" boolean not null default true,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."options" enable row level security;


  create table "public"."regions" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "parent_id" uuid,
    "level" integer,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."regions" enable row level security;


  create table "public"."reservations" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "shop_id" uuid not null,
    "reference_id" uuid not null,
    "slot_id" uuid not null,
    "status" text not null,
    "selected_options_snapshot" jsonb not null default '{}'::jsonb,
    "attached_image_url" text,
    "ai_generation_id" uuid,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."reservations" enable row level security;


  create table "public"."shop_images" (
    "id" uuid not null default gen_random_uuid(),
    "shop_id" uuid not null,
    "image_url" text not null,
    "kind" text not null default 'ETC'::text,
    "sort_order" integer not null default 0
      );


alter table "public"."shop_images" enable row level security;


  create table "public"."shop_verifications" (
    "id" uuid not null default gen_random_uuid(),
    "shop_id" uuid not null,
    "status" text not null default 'PENDING'::text,
    "business_license_file_url" text not null,
    "note" text,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."shop_verifications" enable row level security;


  create table "public"."slots" (
    "id" uuid not null default gen_random_uuid(),
    "shop_id" uuid not null,
    "start_at" timestamp with time zone not null,
    "duration_min" integer not null,
    "capacity" integer not null default 1,
    "status" text not null default 'OPEN'::text,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."slots" enable row level security;

alter table "public"."bookmarks" drop column "id";

alter table "public"."bookmarks" alter column "user_id" set not null;

alter table "public"."bookmarks" enable row level security;

alter table "public"."reference_categories" drop column "category";

alter table "public"."reference_categories" drop column "created_at";

alter table "public"."reference_categories" drop column "id";

alter table "public"."reference_categories" add column "category_id" uuid not null;

alter table "public"."reference_images" drop column "created_at";

alter table "public"."reference_images" alter column "image_url" drop default;

alter table "public"."reference_options" drop column "created_at";

alter table "public"."reference_options" drop column "id";

alter table "public"."reference_options" drop column "name";

alter table "public"."reference_options" drop column "value";

alter table "public"."reference_options" add column "default_qty" integer not null default 0;

alter table "public"."reference_options" add column "is_default" boolean not null default false;

alter table "public"."reference_options" add column "option_id" uuid not null;

alter table "public"."reference_style_tags" drop column "created_at";

alter table "public"."references" alter column "service_duration_min" drop default;

alter table "public"."references" alter column "title" drop default;

alter table "public"."shops" add column "region_id" uuid;

alter table "public"."shops" alter column "address" set not null;

alter table "public"."shops" alter column "business_registration_no" set not null;

alter table "public"."shops" alter column "name" drop default;

alter table "public"."shops" alter column "owner_id" set not null;

alter table "public"."shops" alter column "phone" set not null;

alter table "public"."shops" alter column "representative_name" set not null;

alter table "public"."style_tags" drop column "created_at";

alter table "public"."style_tags" alter column "name" drop default;

alter table "public"."style_tags" enable row level security;

alter table "public"."user_refresh_tokens" enable row level security;

alter table "public"."users" add column "nickname" text;

alter table "public"."users" add column "phone" text;

alter table "public"."users" alter column "id" set default gen_random_uuid();

alter table "public"."users" alter column "kakao_user_id" set not null;

alter table "public"."users" enable row level security;

CREATE UNIQUE INDEX ai_generations_pkey ON public.ai_generations USING btree (id);

CREATE UNIQUE INDEX categories_name_key ON public.categories USING btree (name);

CREATE UNIQUE INDEX categories_pkey ON public.categories USING btree (id);

CREATE INDEX idx_ai_generations_user ON public.ai_generations USING btree (user_id, created_at DESC);

CREATE INDEX idx_bookmarks_user ON public.bookmarks USING btree (user_id, created_at DESC);

CREATE INDEX idx_options_shop ON public.options USING btree (shop_id);

CREATE INDEX idx_reference_images_ref ON public.reference_images USING btree (reference_id, sort_order);

CREATE INDEX idx_references_shop_active ON public."references" USING btree (shop_id, is_active);

CREATE INDEX idx_refresh_tokens_user_device ON public.user_refresh_tokens USING btree (user_id, device_id);

CREATE INDEX idx_regions_parent ON public.regions USING btree (parent_id);

CREATE INDEX idx_reservations_shop ON public.reservations USING btree (shop_id, created_at DESC);

CREATE INDEX idx_reservations_user ON public.reservations USING btree (user_id, created_at DESC);

CREATE INDEX idx_shop_images_shop ON public.shop_images USING btree (shop_id, sort_order);

CREATE INDEX idx_shop_verifications_shop ON public.shop_verifications USING btree (shop_id, created_at DESC);

CREATE INDEX idx_slots_shop_time ON public.slots USING btree (shop_id, start_at);

CREATE INDEX idx_slots_status ON public.slots USING btree (status);

CREATE UNIQUE INDEX options_pkey ON public.options USING btree (id);

CREATE UNIQUE INDEX regions_pkey ON public.regions USING btree (id);

CREATE UNIQUE INDEX reservations_pkey ON public.reservations USING btree (id);

CREATE UNIQUE INDEX shop_images_pkey ON public.shop_images USING btree (id);

CREATE UNIQUE INDEX shop_verifications_pkey ON public.shop_verifications USING btree (id);

CREATE UNIQUE INDEX slots_pkey ON public.slots USING btree (id);

CREATE UNIQUE INDEX style_tags_name_key ON public.style_tags USING btree (name);

CREATE UNIQUE INDEX uq_reference_primary_image ON public.reference_images USING btree (reference_id) WHERE (is_primary = true);

CREATE UNIQUE INDEX uq_reservations_slot ON public.reservations USING btree (slot_id);

CREATE UNIQUE INDEX uq_shops_business_no ON public.shops USING btree (business_registration_no);

CREATE UNIQUE INDEX bookmarks_pkey ON public.bookmarks USING btree (user_id, reference_id);

CREATE UNIQUE INDEX reference_categories_pkey ON public.reference_categories USING btree (reference_id, category_id);

CREATE UNIQUE INDEX reference_options_pkey ON public.reference_options USING btree (reference_id, option_id);

alter table "public"."ai_generations" add constraint "ai_generations_pkey" PRIMARY KEY using index "ai_generations_pkey";

alter table "public"."categories" add constraint "categories_pkey" PRIMARY KEY using index "categories_pkey";

alter table "public"."options" add constraint "options_pkey" PRIMARY KEY using index "options_pkey";

alter table "public"."regions" add constraint "regions_pkey" PRIMARY KEY using index "regions_pkey";

alter table "public"."reservations" add constraint "reservations_pkey" PRIMARY KEY using index "reservations_pkey";

alter table "public"."shop_images" add constraint "shop_images_pkey" PRIMARY KEY using index "shop_images_pkey";

alter table "public"."shop_verifications" add constraint "shop_verifications_pkey" PRIMARY KEY using index "shop_verifications_pkey";

alter table "public"."slots" add constraint "slots_pkey" PRIMARY KEY using index "slots_pkey";

alter table "public"."bookmarks" add constraint "bookmarks_pkey" PRIMARY KEY using index "bookmarks_pkey";

alter table "public"."reference_categories" add constraint "reference_categories_pkey" PRIMARY KEY using index "reference_categories_pkey";

alter table "public"."reference_options" add constraint "reference_options_pkey" PRIMARY KEY using index "reference_options_pkey";

alter table "public"."ai_generations" add constraint "ai_generations_brightness_check" CHECK ((brightness = ANY (ARRAY['BRIGHTER'::text, 'NORMAL'::text, 'DARKER'::text]))) not valid;

alter table "public"."ai_generations" validate constraint "ai_generations_brightness_check";

alter table "public"."ai_generations" add constraint "ai_generations_reference_id_fkey" FOREIGN KEY (reference_id) REFERENCES public."references"(id) ON DELETE SET NULL not valid;

alter table "public"."ai_generations" validate constraint "ai_generations_reference_id_fkey";

alter table "public"."ai_generations" add constraint "ai_generations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;

alter table "public"."ai_generations" validate constraint "ai_generations_user_id_fkey";

alter table "public"."bookmarks" add constraint "bookmarks_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE not valid;

alter table "public"."bookmarks" validate constraint "bookmarks_user_id_fkey";

alter table "public"."categories" add constraint "categories_name_key" UNIQUE using index "categories_name_key";

alter table "public"."options" add constraint "options_max_qty_check" CHECK (((max_qty IS NULL) OR (max_qty >= 0))) not valid;

alter table "public"."options" validate constraint "options_max_qty_check";

alter table "public"."options" add constraint "options_min_qty_check" CHECK ((min_qty >= 0)) not valid;

alter table "public"."options" validate constraint "options_min_qty_check";

alter table "public"."options" add constraint "options_price_check" CHECK ((price >= 0)) not valid;

alter table "public"."options" validate constraint "options_price_check";

alter table "public"."options" add constraint "options_shop_id_fkey" FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE not valid;

alter table "public"."options" validate constraint "options_shop_id_fkey";

alter table "public"."options" add constraint "options_type_check" CHECK ((type = ANY (ARRAY['ADDON'::text, 'QUANTITY'::text]))) not valid;

alter table "public"."options" validate constraint "options_type_check";

alter table "public"."options" add constraint "options_unit_price_check" CHECK ((unit_price >= 0)) not valid;

alter table "public"."options" validate constraint "options_unit_price_check";

alter table "public"."owners" add constraint "owners_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."owners" validate constraint "owners_id_fkey";

alter table "public"."reference_categories" add constraint "reference_categories_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE RESTRICT not valid;

alter table "public"."reference_categories" validate constraint "reference_categories_category_id_fkey";

alter table "public"."reference_options" add constraint "reference_options_default_qty_check" CHECK ((default_qty >= 0)) not valid;

alter table "public"."reference_options" validate constraint "reference_options_default_qty_check";

alter table "public"."reference_options" add constraint "reference_options_option_id_fkey" FOREIGN KEY (option_id) REFERENCES public.options(id) ON DELETE CASCADE not valid;

alter table "public"."reference_options" validate constraint "reference_options_option_id_fkey";

alter table "public"."references" add constraint "references_base_price_check" CHECK ((base_price >= 0)) not valid;

alter table "public"."references" validate constraint "references_base_price_check";

alter table "public"."references" add constraint "references_service_duration_min_check" CHECK ((service_duration_min > 0)) not valid;

alter table "public"."references" validate constraint "references_service_duration_min_check";

alter table "public"."regions" add constraint "regions_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES public.regions(id) ON DELETE SET NULL not valid;

alter table "public"."regions" validate constraint "regions_parent_id_fkey";

alter table "public"."reservations" add constraint "reservations_ai_generation_id_fkey" FOREIGN KEY (ai_generation_id) REFERENCES public.ai_generations(id) ON DELETE SET NULL not valid;

alter table "public"."reservations" validate constraint "reservations_ai_generation_id_fkey";

alter table "public"."reservations" add constraint "reservations_reference_id_fkey" FOREIGN KEY (reference_id) REFERENCES public."references"(id) ON DELETE RESTRICT not valid;

alter table "public"."reservations" validate constraint "reservations_reference_id_fkey";

alter table "public"."reservations" add constraint "reservations_shop_id_fkey" FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE RESTRICT not valid;

alter table "public"."reservations" validate constraint "reservations_shop_id_fkey";

alter table "public"."reservations" add constraint "reservations_slot_id_fkey" FOREIGN KEY (slot_id) REFERENCES public.slots(id) ON DELETE RESTRICT not valid;

alter table "public"."reservations" validate constraint "reservations_slot_id_fkey";

alter table "public"."reservations" add constraint "reservations_status_check" CHECK ((status = ANY (ARRAY['PENDING_DEPOSIT'::text, 'DEPOSIT_PAID'::text, 'CONFIRMED'::text, 'SERVICE_CONFIRMED'::text, 'BALANCE_PAID'::text, 'COMPLETED'::text]))) not valid;

alter table "public"."reservations" validate constraint "reservations_status_check";

alter table "public"."reservations" add constraint "reservations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT not valid;

alter table "public"."reservations" validate constraint "reservations_user_id_fkey";

alter table "public"."shop_images" add constraint "shop_images_kind_check" CHECK ((kind = ANY (ARRAY['EXTERIOR'::text, 'INTERIOR'::text, 'ETC'::text]))) not valid;

alter table "public"."shop_images" validate constraint "shop_images_kind_check";

alter table "public"."shop_images" add constraint "shop_images_shop_id_fkey" FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE not valid;

alter table "public"."shop_images" validate constraint "shop_images_shop_id_fkey";

alter table "public"."shop_verifications" add constraint "shop_verifications_shop_id_fkey" FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE not valid;

alter table "public"."shop_verifications" validate constraint "shop_verifications_shop_id_fkey";

alter table "public"."shop_verifications" add constraint "shop_verifications_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text]))) not valid;

alter table "public"."shop_verifications" validate constraint "shop_verifications_status_check";

alter table "public"."shops" add constraint "shops_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE RESTRICT not valid;

alter table "public"."shops" validate constraint "shops_owner_id_fkey";

alter table "public"."shops" add constraint "shops_region_id_fkey" FOREIGN KEY (region_id) REFERENCES public.regions(id) ON DELETE SET NULL not valid;

alter table "public"."shops" validate constraint "shops_region_id_fkey";

alter table "public"."shops" add constraint "shops_status_check" CHECK ((status = ANY (ARRAY['DRAFT'::text, 'PENDING_VERIFY'::text, 'VERIFIED'::text, 'REJECTED'::text]))) not valid;

alter table "public"."shops" validate constraint "shops_status_check";

alter table "public"."slots" add constraint "slots_capacity_check" CHECK ((capacity > 0)) not valid;

alter table "public"."slots" validate constraint "slots_capacity_check";

alter table "public"."slots" add constraint "slots_duration_min_check" CHECK ((duration_min > 0)) not valid;

alter table "public"."slots" validate constraint "slots_duration_min_check";

alter table "public"."slots" add constraint "slots_shop_id_fkey" FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE not valid;

alter table "public"."slots" validate constraint "slots_shop_id_fkey";

alter table "public"."slots" add constraint "slots_status_check" CHECK ((status = ANY (ARRAY['OPEN'::text, 'CLOSED'::text]))) not valid;

alter table "public"."slots" validate constraint "slots_status_check";

alter table "public"."style_tags" add constraint "style_tags_name_key" UNIQUE using index "style_tags_name_key";

alter table "public"."users" add constraint "users_kakao_user_id_key" UNIQUE using index "users_kakao_user_id_key";

alter table "public"."reference_style_tags" add constraint "reference_style_tags_tag_id_fkey" FOREIGN KEY (tag_id) REFERENCES public.style_tags(id) ON DELETE RESTRICT not valid;

alter table "public"."reference_style_tags" validate constraint "reference_style_tags_tag_id_fkey";

alter table "public"."user_refresh_tokens" add constraint "user_refresh_tokens_replaced_by_fkey" FOREIGN KEY (replaced_by) REFERENCES public.user_refresh_tokens(id) ON DELETE SET NULL not valid;

alter table "public"."user_refresh_tokens" validate constraint "user_refresh_tokens_replaced_by_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.prevent_deleting_last_reference_style_tag()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  remaining int;
begin
  select count(*)
    into remaining
  from public.reference_style_tags
  where reference_id = old.reference_id
    and tag_id <> old.tag_id;

  if remaining = 0 then
    raise exception 'Cannot delete the last style tag for reference %.', old.reference_id;
  end if;

  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_more_than_three_reference_style_tags()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  current_count int;
begin
  -- INSERT 기준: 현재 몇 개 연결되어 있는지 확인
  select count(*)
    into current_count
  from public.reference_style_tags
  where reference_id = new.reference_id;

  if current_count >= 3 then
    raise exception 'A reference % cannot have more than 3 style tags.', new.reference_id;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_update_reference_style_tags()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'Updating reference_style_tags is not allowed. Use delete + insert.';
end;
$function$
;

grant delete on table "public"."ai_generations" to "anon";

grant insert on table "public"."ai_generations" to "anon";

grant references on table "public"."ai_generations" to "anon";

grant select on table "public"."ai_generations" to "anon";

grant trigger on table "public"."ai_generations" to "anon";

grant truncate on table "public"."ai_generations" to "anon";

grant update on table "public"."ai_generations" to "anon";

grant delete on table "public"."ai_generations" to "authenticated";

grant insert on table "public"."ai_generations" to "authenticated";

grant references on table "public"."ai_generations" to "authenticated";

grant select on table "public"."ai_generations" to "authenticated";

grant trigger on table "public"."ai_generations" to "authenticated";

grant truncate on table "public"."ai_generations" to "authenticated";

grant update on table "public"."ai_generations" to "authenticated";

grant delete on table "public"."ai_generations" to "service_role";

grant insert on table "public"."ai_generations" to "service_role";

grant references on table "public"."ai_generations" to "service_role";

grant select on table "public"."ai_generations" to "service_role";

grant trigger on table "public"."ai_generations" to "service_role";

grant truncate on table "public"."ai_generations" to "service_role";

grant update on table "public"."ai_generations" to "service_role";

grant delete on table "public"."categories" to "anon";

grant insert on table "public"."categories" to "anon";

grant references on table "public"."categories" to "anon";

grant select on table "public"."categories" to "anon";

grant trigger on table "public"."categories" to "anon";

grant truncate on table "public"."categories" to "anon";

grant update on table "public"."categories" to "anon";

grant delete on table "public"."categories" to "authenticated";

grant insert on table "public"."categories" to "authenticated";

grant references on table "public"."categories" to "authenticated";

grant select on table "public"."categories" to "authenticated";

grant trigger on table "public"."categories" to "authenticated";

grant truncate on table "public"."categories" to "authenticated";

grant update on table "public"."categories" to "authenticated";

grant delete on table "public"."categories" to "service_role";

grant insert on table "public"."categories" to "service_role";

grant references on table "public"."categories" to "service_role";

grant select on table "public"."categories" to "service_role";

grant trigger on table "public"."categories" to "service_role";

grant truncate on table "public"."categories" to "service_role";

grant update on table "public"."categories" to "service_role";

grant delete on table "public"."options" to "anon";

grant insert on table "public"."options" to "anon";

grant references on table "public"."options" to "anon";

grant select on table "public"."options" to "anon";

grant trigger on table "public"."options" to "anon";

grant truncate on table "public"."options" to "anon";

grant update on table "public"."options" to "anon";

grant delete on table "public"."options" to "authenticated";

grant insert on table "public"."options" to "authenticated";

grant references on table "public"."options" to "authenticated";

grant select on table "public"."options" to "authenticated";

grant trigger on table "public"."options" to "authenticated";

grant truncate on table "public"."options" to "authenticated";

grant update on table "public"."options" to "authenticated";

grant delete on table "public"."options" to "service_role";

grant insert on table "public"."options" to "service_role";

grant references on table "public"."options" to "service_role";

grant select on table "public"."options" to "service_role";

grant trigger on table "public"."options" to "service_role";

grant truncate on table "public"."options" to "service_role";

grant update on table "public"."options" to "service_role";

grant delete on table "public"."regions" to "anon";

grant insert on table "public"."regions" to "anon";

grant references on table "public"."regions" to "anon";

grant select on table "public"."regions" to "anon";

grant trigger on table "public"."regions" to "anon";

grant truncate on table "public"."regions" to "anon";

grant update on table "public"."regions" to "anon";

grant delete on table "public"."regions" to "authenticated";

grant insert on table "public"."regions" to "authenticated";

grant references on table "public"."regions" to "authenticated";

grant select on table "public"."regions" to "authenticated";

grant trigger on table "public"."regions" to "authenticated";

grant truncate on table "public"."regions" to "authenticated";

grant update on table "public"."regions" to "authenticated";

grant delete on table "public"."regions" to "service_role";

grant insert on table "public"."regions" to "service_role";

grant references on table "public"."regions" to "service_role";

grant select on table "public"."regions" to "service_role";

grant trigger on table "public"."regions" to "service_role";

grant truncate on table "public"."regions" to "service_role";

grant update on table "public"."regions" to "service_role";

grant delete on table "public"."reservations" to "anon";

grant insert on table "public"."reservations" to "anon";

grant references on table "public"."reservations" to "anon";

grant select on table "public"."reservations" to "anon";

grant trigger on table "public"."reservations" to "anon";

grant truncate on table "public"."reservations" to "anon";

grant update on table "public"."reservations" to "anon";

grant delete on table "public"."reservations" to "authenticated";

grant insert on table "public"."reservations" to "authenticated";

grant references on table "public"."reservations" to "authenticated";

grant select on table "public"."reservations" to "authenticated";

grant trigger on table "public"."reservations" to "authenticated";

grant truncate on table "public"."reservations" to "authenticated";

grant update on table "public"."reservations" to "authenticated";

grant delete on table "public"."reservations" to "service_role";

grant insert on table "public"."reservations" to "service_role";

grant references on table "public"."reservations" to "service_role";

grant select on table "public"."reservations" to "service_role";

grant trigger on table "public"."reservations" to "service_role";

grant truncate on table "public"."reservations" to "service_role";

grant update on table "public"."reservations" to "service_role";

grant delete on table "public"."shop_images" to "anon";

grant insert on table "public"."shop_images" to "anon";

grant references on table "public"."shop_images" to "anon";

grant select on table "public"."shop_images" to "anon";

grant trigger on table "public"."shop_images" to "anon";

grant truncate on table "public"."shop_images" to "anon";

grant update on table "public"."shop_images" to "anon";

grant delete on table "public"."shop_images" to "authenticated";

grant insert on table "public"."shop_images" to "authenticated";

grant references on table "public"."shop_images" to "authenticated";

grant select on table "public"."shop_images" to "authenticated";

grant trigger on table "public"."shop_images" to "authenticated";

grant truncate on table "public"."shop_images" to "authenticated";

grant update on table "public"."shop_images" to "authenticated";

grant delete on table "public"."shop_images" to "service_role";

grant insert on table "public"."shop_images" to "service_role";

grant references on table "public"."shop_images" to "service_role";

grant select on table "public"."shop_images" to "service_role";

grant trigger on table "public"."shop_images" to "service_role";

grant truncate on table "public"."shop_images" to "service_role";

grant update on table "public"."shop_images" to "service_role";

grant delete on table "public"."shop_verifications" to "anon";

grant insert on table "public"."shop_verifications" to "anon";

grant references on table "public"."shop_verifications" to "anon";

grant select on table "public"."shop_verifications" to "anon";

grant trigger on table "public"."shop_verifications" to "anon";

grant truncate on table "public"."shop_verifications" to "anon";

grant update on table "public"."shop_verifications" to "anon";

grant delete on table "public"."shop_verifications" to "authenticated";

grant insert on table "public"."shop_verifications" to "authenticated";

grant references on table "public"."shop_verifications" to "authenticated";

grant select on table "public"."shop_verifications" to "authenticated";

grant trigger on table "public"."shop_verifications" to "authenticated";

grant truncate on table "public"."shop_verifications" to "authenticated";

grant update on table "public"."shop_verifications" to "authenticated";

grant delete on table "public"."shop_verifications" to "service_role";

grant insert on table "public"."shop_verifications" to "service_role";

grant references on table "public"."shop_verifications" to "service_role";

grant select on table "public"."shop_verifications" to "service_role";

grant trigger on table "public"."shop_verifications" to "service_role";

grant truncate on table "public"."shop_verifications" to "service_role";

grant update on table "public"."shop_verifications" to "service_role";

grant delete on table "public"."slots" to "anon";

grant insert on table "public"."slots" to "anon";

grant references on table "public"."slots" to "anon";

grant select on table "public"."slots" to "anon";

grant trigger on table "public"."slots" to "anon";

grant truncate on table "public"."slots" to "anon";

grant update on table "public"."slots" to "anon";

grant delete on table "public"."slots" to "authenticated";

grant insert on table "public"."slots" to "authenticated";

grant references on table "public"."slots" to "authenticated";

grant select on table "public"."slots" to "authenticated";

grant trigger on table "public"."slots" to "authenticated";

grant truncate on table "public"."slots" to "authenticated";

grant update on table "public"."slots" to "authenticated";

grant delete on table "public"."slots" to "service_role";

grant insert on table "public"."slots" to "service_role";

grant references on table "public"."slots" to "service_role";

grant select on table "public"."slots" to "service_role";

grant trigger on table "public"."slots" to "service_role";

grant truncate on table "public"."slots" to "service_role";

grant update on table "public"."slots" to "service_role";


  create policy "public read categories"
  on "public"."categories"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "public read regions"
  on "public"."regions"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "public read shop_images"
  on "public"."shop_images"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "public read shops"
  on "public"."shops"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "public read open slots"
  on "public"."slots"
  as permissive
  for select
  to anon, authenticated
using ((status = 'OPEN'::text));



  create policy "public read style_tags"
  on "public"."style_tags"
  as permissive
  for select
  to anon, authenticated
using (true);


CREATE TRIGGER trg_owners_updated_at BEFORE UPDATE ON public.owners FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_prevent_insert_more_than_3_tags BEFORE INSERT ON public.reference_style_tags FOR EACH ROW EXECUTE FUNCTION public.prevent_more_than_three_reference_style_tags();

CREATE TRIGGER trg_prevent_update_reference_style_tags BEFORE UPDATE ON public.reference_style_tags FOR EACH ROW EXECUTE FUNCTION public.prevent_update_reference_style_tags();

CREATE TRIGGER trg_references_updated_at BEFORE UPDATE ON public."references" FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_reservations_updated_at BEFORE UPDATE ON public.reservations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_shops_updated_at BEFORE UPDATE ON public.shops FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


