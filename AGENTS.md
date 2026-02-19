# AGENTS.md (shared-schema)

이 저장소는 3개 레포(`client-app-ios`, `owner-app`, `shared-schema`)의 공용 DB canonical 스키마를 관리한다.

## Working Rules

- migration source of truth는 `shared-schema/migrations`다.
- 앱 레포 반영 순서는 `shared-schema PR 머지 -> 각 앱 레포 submodule/mirror sync`를 따른다.
- 새 migration 파일명은 `YYYYMMDDHHMMSS_<team>_<description>.sql` 형식을 사용한다. (`team`: `ios` 또는 `web`)
- destructive 변경(drop/rename/retype)은 운영 영향 분석과 롤백/호환 계획 없이 반영하지 않는다.

## Verification

- 변경 후 `bash scripts/check-migration-names.sh`를 필수로 통과한다.
- `shared-staging` 적용 확인 전에는 완료로 간주하지 않는다.
- `shared-prod`는 비파괴 원칙을 유지하며 별도 승인 절차 없이 승격하지 않는다.

## Notion Alignment (Required)

- DB 계약 변경 전 Notion 기준 문서(`🧩 기능 명세`, `🙏 요구사항 명세서`, `🚀 MVP`, `📑 시나리오`, `🗒️ 기능 구현`)를 확인한다.
- 스키마 변경과 문서 변경은 같은 작업 사이클에서 동시 반영한다.
- PR 설명에 참조 Notion 링크와 정합성 점검 결과를 반드시 포함한다.
