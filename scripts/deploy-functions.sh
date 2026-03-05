#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUNCTIONS_DIR="$ROOT_DIR/supabase/functions"
PROJECT_REF="${1:-${SUPABASE_PROJECT_REF:-twahqxjhyocyqrmtjbdf}}"

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: supabase CLI is not installed."
  exit 1
fi

if [[ ! -d "$FUNCTIONS_DIR" ]]; then
  echo "ERROR: functions directory not found: $FUNCTIONS_DIR"
  exit 1
fi

FUNCTIONS=()
while IFS= read -r file; do
  FUNCTIONS+=("$(basename "$(dirname "$file")")")
done < <(find "$FUNCTIONS_DIR" -mindepth 2 -maxdepth 2 -name "index.ts" | sort)

if [[ ${#FUNCTIONS[@]} -eq 0 ]]; then
  echo "No local edge functions found."
  exit 1
fi

for func_name in "${FUNCTIONS[@]}"; do
  echo "[deploy-functions] deploying: $func_name"
  supabase functions deploy "$func_name" --project-ref "$PROJECT_REF" --no-verify-jwt
done

echo "[deploy-functions] completed. deployed=${#FUNCTIONS[@]} project=$PROJECT_REF"
