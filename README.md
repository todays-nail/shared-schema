# shared-schema

Canonical Supabase repository for shared schema and Edge Function operations.

## Canonical Scope
- `migrations/` (DB schema + data migration)
- `supabase/functions/` (Edge Functions + `_shared`)

Deployment to `shared-staging` and `shared-prod` is performed only by this repository's CI workflows.

## Operating Principles
- Allow DB and Edge Function source changes only in this repository.
- Do not edit DB or Edge Function sources directly from app repositories such as `client-app-ios` or `owner-app`.
- App repositories are API consumers and should change only when the contract changes.
- For zero-downtime delivery, use the default rollout strategy: Expand -> App/Function adoption -> Contract.

## CI Workflows
- `.github/workflows/apply-shared-staging.yml`
  - On `main` pushes, apply DB changes and then deploy/validate functions
- `.github/workflows/promote-shared-prod.yml`
  - Manually triggered, then promoted to production after `shared-prod` environment approval

## Function Deploy & Validation
Example local commands:

```bash
# repo root: shared-schema
bash scripts/deploy-functions.sh
bash scripts/functions-check-deployed.sh
bash scripts/functions-check-auth-config.sh
```

The default project ref is `twahqxjhyocyqrmtjbdf`.
Override it with `SUPABASE_PROJECT_REF` or the first positional argument when needed.

## Local Environment Variables
- Use the repository root `.env` file for local commands.
- Initial setup:
  - `cp .env.example .env`
  - Sync the values from `client-app-ios/infra/.env` into `.env`
- `.env` is for local use only and must not be committed.

## Required Secrets
GitHub Actions (repository or environment secrets)
- `SUPABASE_DB_URL_SHARED_STAGING`
- `SUPABASE_DB_URL_SHARED_PROD`
- `SUPABASE_ACCESS_TOKEN`

Supabase Edge Function secrets
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_JWT_SECRET`
- `REFRESH_TOKEN_PEPPER`
- `GOOGLE_OAUTH_AUDIENCES`
- `APPLE_OAUTH_AUDIENCES`
- `OPENAI_API_KEY`
- `NAIL_GEN_WORKER_SECRET`
- `APNS_TEAM_ID`
- `APNS_KEY_ID`
- `APNS_PRIVATE_KEY_P8`
- `APNS_TOPIC`
- `APNS_DEFAULT_ENV` (optional)

## Migration Filename Rule
- For files created after the transition point (`20260218000000`):
  - `YYYYMMDDHHMMSS_<team>_<description>.sql`
  - `<team>`: `ios` or `web`

## Manual Verification
```bash
bash scripts/check-migration-names.sh
```

## CI Environment
- The `shared-prod` GitHub Environment is required.
- During hackathon or early development stages, `Required reviewers` may be left empty.
- Before full production use, configure at least one `Required reviewer`.
