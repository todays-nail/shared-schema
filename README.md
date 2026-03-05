# shared-schema

Supabase 공용 canonical 저장소입니다.

## Canonical Scope
- `migrations/` (DB schema + data migration)
- `supabase/functions/` (Edge Functions + `_shared`)

`shared-staging/shared-prod` 반영은 이 저장소 CI에서만 수행합니다.

## 운영 원칙
- DB/Functions 변경은 이 저장소에서만 허용합니다.
- 앱 저장소(`client-app-ios`, `owner-app`)에서는 DB/Functions 소스를 직접 수정하지 않습니다.
- 앱 저장소는 API 소비자이며, 계약이 바뀔 때만 앱 코드를 수정합니다.
- 무중단을 위해 기본 전략은 Expand -> App/Function 반영 -> Contract 2단계입니다.

## CI Workflows
- `.github/workflows/apply-shared-staging.yml`
  - `main` push 시 DB push 후 함수 배포/검증
- `.github/workflows/promote-shared-prod.yml`
  - 수동 실행 + `shared-prod` environment 승인 후 DB/함수 반영

## Function Deploy & Validation
로컬 수동 실행 예시:

```bash
# repo root: shared-schema
bash scripts/deploy-functions.sh
bash scripts/functions-check-deployed.sh
bash scripts/functions-check-auth-config.sh
```

기본 프로젝트 ref는 `twahqxjhyocyqrmtjbdf`이며,
필요 시 `SUPABASE_PROJECT_REF` 또는 첫 번째 인자로 override 가능합니다.

## 필수 Secrets
GitHub Actions (Repository/Environment Secrets)
- `SUPABASE_DB_URL_SHARED_STAGING`
- `SUPABASE_DB_URL_SHARED_PROD`
- `SUPABASE_ACCESS_TOKEN`

Supabase Edge Functions Secrets
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

## Migration 파일명 규칙
- 전환 시점(`20260218000000`) 이후 신규 파일명:
  - `YYYYMMDDHHMMSS_<team>_<description>.sql`
  - `<team>`: `ios` 또는 `web`

## 수동 검증
```bash
bash scripts/check-migration-names.sh
```

## CI Environment
- `shared-prod` GitHub Environment는 필수입니다.
- 해커톤/초기 개발 단계에서는 `Required reviewers`를 비워둘 수 있습니다.
- 운영 전환 시에는 `Required reviewers` 1명 이상 설정을 권장합니다.
