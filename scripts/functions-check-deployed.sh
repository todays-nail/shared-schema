#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/functions-common.sh
source "$SCRIPT_DIR/lib/functions-common.sh"

PROJECT_REF="$(resolve_project_ref "${1:-}")"

require_command "jq"
require_command "supabase"

LOCAL_FUNCTIONS=()
while IFS= read -r func_name; do
  [[ -n "$func_name" ]] || continue
  LOCAL_FUNCTIONS+=("$func_name")
done < <(list_local_function_names)

if [[ ${#LOCAL_FUNCTIONS[@]} -eq 0 ]]; then
  echo "No local edge functions found."
  exit 1
fi

if ! REMOTE_JSON="$(supabase functions list -o json --project-ref "$PROJECT_REF")"; then
  echo "ERROR: failed to list remote functions for project: $PROJECT_REF"
  exit 1
fi

REMOTE_FUNCTIONS=()
while IFS= read -r remote_name; do
  [[ -n "$remote_name" ]] || continue
  REMOTE_FUNCTIONS+=("$remote_name")
done < <(echo "$REMOTE_JSON" | jq -r '.[].name' | sort -u)

MISSING=()
for func_name in "${LOCAL_FUNCTIONS[@]}"; do
  found=0
  for remote_name in "${REMOTE_FUNCTIONS[@]}"; do
    if [[ "$func_name" == "$remote_name" ]]; then
      found=1
      break
    fi
  done

  if [[ $found -eq 0 ]]; then
    MISSING+=("$func_name")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "Missing deployed functions on project $PROJECT_REF:"
  for func_name in "${MISSING[@]}"; do
    echo " - $func_name"
  done
  exit 1
fi

echo "All local edge functions are deployed on project $PROJECT_REF."
