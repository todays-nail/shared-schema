# DB Schema Cleanup Audit for Issue 36

Date: 2026-05-21

## Scope

This audit classifies database and storage objects before any cleanup migration is written.
It intentionally does not change migrations, deploy Edge Functions, run Supabase deploy commands, or modify the iOS app.

Reviewed surfaces:

- `migrations/`
- `supabase/functions/`
- `scripts/`
- iOS API contract references in `client-app-ios/NailClient`
- storage bucket names and object path flows present in this repository

Not reviewed:

- Live production or staging row counts
- Owner web application source outside this repository
- Supabase dashboard-only usage

## Method

Static references were searched across migrations, Edge Functions, scripts, and the iOS client.
Objects with active Edge Function references, trigger dependencies, storage flows, or iOS API contract exposure are treated as keep.
Objects found only in migrations are not automatically safe to remove; owner-web or direct Supabase client usage can still depend on RLS-backed tables and buckets.

## Summary

| Classification | Objects |
| --- | --- |
| Delete candidate | `ai_generations`, `feed_post_likes`, `shop_images`, `shop_verifications` |
| Hold pending owner-web/live-data check | `owner_account_settings`, `owner_verifications`, `reference_likes`, `shop_gallery_images`, `owner-licenses`, `reference-images`, `shop-gallery-images`, `onboarding-style-images-public` |
| Keep | Auth/session tables, user profile tables, region tables, feed tables, nail generation tables, quote/reservation/owner operation tables, active storage buckets |

No object should be removed from this audit PR. Each delete candidate needs a follow-up issue with live row counts, API impact, rollback plan, and a migration PR.

## Delete Candidates

### `ai_generations`

Evidence:

- Created and granted in `migrations/20260217123336_reconcile_remote_schema.sql`.
- No direct references found in `supabase/functions/`, `scripts/`, or the iOS client.
- Current generation and quote flows use `nail_generation_jobs` and `quote_requests.ai_generation_job_id`.

Risks and dependencies:

- `reservations.ai_generation_id` still has a foreign key to `ai_generations`.
- `reservation-create` accepts `ai_generation_id` and `reservation-list` returns it, so the API contract must be handled before dropping the table or column.

Follow-up:

- Verify live row counts for `ai_generations` and `reservations.ai_generation_id`.
- Decide whether to preserve historical reservation links, migrate them to `nail_generation_jobs`, or remove the API field.
- Write a dedicated migration only after the contract decision is made.

### `feed_post_likes`

Evidence:

- Created by `migrations/20260217110000_feed_posts_and_detail.sql`.
- No Edge Function, script, or iOS client references found.
- Active feed-like behavior uses `bookmarks` and triggers feed counters through bookmark changes.

Risks and dependencies:

- Could contain legacy seed or test data.
- Dropping it is likely low app impact, but live row count should still be checked.

Follow-up:

- Verify row count.
- If empty or migrated to `bookmarks`, drop table, indexes, grants, and any related policies in a dedicated cleanup migration.

### `shop_images`

Evidence:

- Created and publicly readable in `migrations/20260217123336_reconcile_remote_schema.sql`.
- No Edge Function, script, or iOS client references found.
- Newer shop gallery metadata uses `shop_gallery_images`.

Risks and dependencies:

- It may be a legacy public shop image source.
- Owner web or dashboard code outside this repository could still read it.

Follow-up:

- Verify owner-web usage and live row counts.
- If unused, drop `shop_images` and its indexes, grants, constraints, and policies in a dedicated cleanup migration.

### `shop_verifications`

Evidence:

- Created and granted in `migrations/20260217123336_reconcile_remote_schema.sql`.
- No Edge Function, script, or iOS client references found.
- Separate owner verification flow exists through `owner_verifications`.

Risks and dependencies:

- It may hold historical shop approval data.
- Owner-web or dashboard code outside this repository could still use it.

Follow-up:

- Verify owner-web usage and live row counts.
- If unused, drop `shop_verifications` and its indexes, grants, constraints, and policies in a dedicated cleanup migration.

## Hold

### Owner web and verification objects

Hold:

- `owner_account_settings`
- `owner_verifications`
- `owner-licenses`

Reason:

- These objects are migration-only from the Edge Function perspective, but they are RLS-backed owner flows and may be accessed directly by owner web clients.
- `owner_verifications` is also referenced by database-side provisioning logic in migrations.

Required before deletion:

- Audit owner web source and Supabase dashboard flows.
- Check live row counts and storage object counts.
- Confirm whether `ensure_owner_shop_for_user` and `handle_auth_user_created_provision_shop` still need `owner_verifications`.

### Shop gallery objects

Hold:

- `shop_gallery_images`
- `shop-gallery-images`

Reason:

- These are not referenced by current Edge Functions or the iOS client, but the migration is explicitly for shop settings/gallery metadata and private storage.
- RLS policies are membership-based, which suggests direct owner-client access.

Required before deletion:

- Audit owner web source.
- Check live table and storage object counts.
- Confirm whether a replacement gallery API exists.

### Reference/catalog owner objects

Hold:

- `reference_likes`
- `reference-images`
- `reference_categories`
- `reference_options`
- `categories`
- `options`

Reason:

- Some objects are migration-only from Edge Functions, but they model owner-created reference catalog data.
- `reference_images`, `reference_style_tags`, and `reference_reviews` feed the `feed_posts` materialization triggers and must stay active.
- `reference_likes` currently has no Edge Function references, but its migration notes dashboard top-five sorting, so owner-dashboard usage must be checked.

Required before deletion:

- Audit owner dashboard/source.
- Check live row counts.
- Confirm no trigger, sync, or dashboard query depends on each object.

### Onboarding style bucket

Hold:

- `onboarding-style-images-public`

Reason:

- `public-onboarding-styles` reads `onboarding_style_assets`, not the bucket directly.
- The table may store public URLs pointing into this bucket.

Required before deletion:

- Check `onboarding_style_assets.image_url` values and storage object counts.
- Keep the bucket if active asset URLs still reference it.

## Keep

### Auth and user profile

Keep:

- `users`
- `user_identities`
- `user_refresh_tokens`
- `user_push_tokens`

Evidence:

- Used by auth providers, dev login, refresh/logout, user profile, account deletion, push token upsert/deactivate, and generation-complete push flows.

### Runtime config

Keep:

- `app_runtime_flags`

Evidence:

- Used by `public-app-config`.

### Regions

Keep:

- `regions`
- `region_boundaries`
- `region_sync_meta`

Evidence:

- Used by region list/tree/boundary functions, auth default region handling, feed filters, quote helpers, and user profile updates.

### Shops and owner operations

Keep:

- `shops`
- `shop_members`
- `shop_settings`
- `owner_notifications`
- `owner_notification_reads`

Evidence:

- Used by shop search/detail/recommend, reservation slot checks, quote owner flows, dashboard summary, and owner notification functions.

### Feed

Keep:

- `feed_posts`
- `feed_post_images`
- `feed_post_reviews`
- `bookmarks`

Evidence:

- Used by feed list/detail/like, profile-style insight, and shop recommendation flows.
- `bookmarks` is the active user-like/bookmark source.

### Nail generation

Keep:

- `nail_generation_jobs`
- `nail_generation_likes`
- `nail-inputs-private`
- `nail-results-private`
- `nail-results-thumb-public`

Evidence:

- Used by upload URL, generation request/refine/status/list/delete/like, worker processing, thumbnail backfill, quote image display, and iOS thumbnail URL handling.

### Quote and reservation

Keep:

- `quote_requests`
- `quote_request_targets`
- `quote_responses`
- `reservations`
- `slots`
- `reservation_payment_ledgers`

Evidence:

- Used by quote create/list/response/select, owner quote list/upsert, reservation create/list/slots, owner dashboard summary, and payment ledger upsert.

### Reference feed materialization

Keep:

- `references`
- `reference_images`
- `reference_style_tags`
- `reference_reviews`
- `style_tags`

Evidence:

- `references` is used directly by feed, shop recommendation, reservation, and owner dashboard flows.
- `reference_images`, `reference_style_tags`, and `reference_reviews` are source objects for `sync_feed_from_reference*` trigger functions that materialize `feed_posts`.
- `style_tags` is joined by feed sync functions and exposed through feed/profile-style APIs.

## Database Functions and Triggers

Keep active trigger/function groups:

- `sync_feed_from_reference*` and related reference/bookmark/shop triggers
- `references_apply_defaults`
- reference style-tag guard functions
- `validate_reservation_shop_consistency`
- quote request validation functions
- owner notification trigger functions
- payment ledger fill trigger
- standard `*_updated_at` triggers
- auth user provisioning functions

Candidate-adjacent triggers:

- `set_owner_account_settings_updated_at` should remain on hold with `owner_account_settings`.
- `set_owner_verifications_updated_at` should remain on hold with `owner_verifications`.

No function or trigger is safe to drop from this audit alone.

## App Impact

Current audit document impact: no impact.

Potential follow-up impact:

- `ai_generations` cleanup may be app/API-impacting because reservation APIs still accept and return `ai_generation_id`.
- `feed_post_likes`, `shop_images`, and `shop_verifications` appear to be no-impact for the iOS app, but still require owner-web and live-data checks.
- Owner-web direct Supabase access was not part of the available source audit, so any owner-facing table or bucket cleanup must be treated as backward-incompatible until proven otherwise.

## Recommended Follow-Up Issues

Created follow-up issues:

- #42: Retire `ai_generations` and `reservations.ai_generation_id` after live-data and API contract review.
- #43: Drop `feed_post_likes` if live row count confirms it is unused or migrated to `bookmarks`.
- #44: Verify and retire `shop_images` and `shop_verifications` after owner-web dependency review.

Potential future issue after owner-web source audit:

- Audit direct Supabase dependencies for `owner_account_settings`, `shop_gallery_images`, `reference_likes`, `reference-images`, `shop-gallery-images`, and `owner-licenses`.

## Verification

This audit only adds documentation.

Required checks before merging:

- Confirm `git diff --name-only` shows only this document.
- Confirm no migration, Edge Function, script, deployment workflow, or iOS code changed.
- Confirm no Supabase deploy, DB push, function deploy, or production promote was run.
