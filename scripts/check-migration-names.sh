#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG_DIR="${ROOT_DIR}/migrations"
CUTOFF_TS=20260218000000

if [[ ! -d "${MIG_DIR}" ]]; then
  echo "[migration-lint] directory not found: ${MIG_DIR}" >&2
  exit 1
fi

errors=0
count=0

while IFS= read -r file; do
  base="$(basename "${file}")"
  count=$((count + 1))

  if [[ "${base}" =~ ^([0-9]{14})_(ios|web)_[a-z0-9_]+\.sql$ ]]; then
    continue
  fi

  if [[ "${base}" =~ ^([0-9]{14})_[a-z0-9_]+\.sql$ ]]; then
    ts="${BASH_REMATCH[1]}"
    if [[ "${ts}" -ge "${CUTOFF_TS}" ]]; then
      echo "[migration-lint] ${base}: 전환 시점 이후 파일은 팀 접두사(ios|web)가 필요합니다." >&2
      errors=$((errors + 1))
    fi
    continue
  fi

  echo "[migration-lint] ${base}: 허용되지 않은 파일명 형식입니다." >&2
  errors=$((errors + 1))
done < <(find "${MIG_DIR}" -maxdepth 1 -type f -name '*.sql' | sort)

if [[ "${count}" -eq 0 ]]; then
  echo "[migration-lint] SQL 파일이 없습니다: ${MIG_DIR}" >&2
  exit 1
fi

dupes="$(find "${MIG_DIR}" -maxdepth 1 -type f -name '*.sql' -print | sed -E 's#.*/([0-9]{14})_.*#\1#' | sort | uniq -d || true)"
if [[ -n "${dupes}" ]]; then
  echo "[migration-lint] 중복 타임스탬프가 있습니다:" >&2
  echo "${dupes}" | sed 's/^/- /' >&2
  errors=$((errors + 1))
fi

if [[ "${errors}" -gt 0 ]]; then
  echo "[migration-lint] 실패 (${errors}건)" >&2
  exit 1
fi

echo "[migration-lint] 통과: ${count}개 파일"
