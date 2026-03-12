#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/functions-common.sh
source "$SCRIPT_DIR/lib/functions-common.sh"

PROJECT_REF="$(resolve_project_ref "${1:-}")"

require_command "supabase"

FUNCTIONS=()
while IFS= read -r func_name; do
  [[ -n "$func_name" ]] || continue
  FUNCTIONS+=("$func_name")
done < <(list_local_function_names)

if [[ ${#FUNCTIONS[@]} -eq 0 ]]; then
  echo "No local edge functions found."
  exit 1
fi

for func_name in "${FUNCTIONS[@]}"; do
  echo "[deploy-functions] deploying: $func_name"
  supabase functions deploy "$func_name" --project-ref "$PROJECT_REF" --no-verify-jwt
done

echo "[deploy-functions] completed. deployed=${#FUNCTIONS[@]} project=$PROJECT_REF"
