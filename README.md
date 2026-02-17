# shared-schema

Supabase 공용 스키마 canonical 저장소입니다.

## Canonical Path
- `migrations/`

## 운영 원칙
- `shared-staging/prod` 반영은 이 저장소 CI에서만 수행합니다.
- 앱 레포(`owner-app`, `client-app-ios`)는 submodule로 이 저장소를 참조합니다.
- 앱 레포의 실행 경로(`supabase/migrations`, `infra/supabase/migrations`)는 `db:sync:from-shared` 계열 스크립트로 동기화합니다.

## Migration 파일명 규칙
- 전환 시점(`20260218000000`) 이후 신규 파일명:
  - `YYYYMMDDHHMMSS_<team>_<description>.sql`
  - `<team>`: `ios` 또는 `web`

## 수동 검증
```bash
bash scripts/check-migration-names.sh
```

## CI Secrets
- `SUPABASE_DB_URL_SHARED_STAGING`
- `SUPABASE_DB_URL_SHARED_PROD`

## CI Environment
- `shared-prod` GitHub Environment에 승인자(최소 1명)를 설정해야 합니다.
