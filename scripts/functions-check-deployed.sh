#!/usr/bin/env bash

set -uo pipefail

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

LOCAL_FUNCTIONS=()
while IFS= read -r file; do
  func_name="$(basename "$(dirname "$file")")"
  LOCAL_FUNCTIONS+=("$func_name")
done < <(find "$FUNCTIONS_DIR" -mindepth 2 -maxdepth 2 -name "index.ts" | sort)

if [[ ${#LOCAL_FUNCTIONS[@]} -eq 0 ]]; then
  echo "No local edge functions found."
  exit 1
fi

LIST_OUTPUT="$(supabase functions list --project-ref "$PROJECT_REF")"
if [[ $? -ne 0 ]]; then
  echo "ERROR: failed to list remote functions for project: $PROJECT_REF"
  exit 1
fi

REMOTE_FUNCTIONS=()
while IFS= read -r line; do
  name="$(echo "$line" | awk -F'|' '{gsub(/^ +| +$/, "", $3); print $3}')"
  if [[ -n "$name" && "$name" != "SLUG" ]]; then
    REMOTE_FUNCTIONS+=("$name")
  fi
done < <(echo "$LIST_OUTPUT" | awk -F'|' '/\|/ && $0 !~ /---/')

if [[ ${#REMOTE_FUNCTIONS[@]} -eq 0 ]]; then
  echo "ERROR: no remote functions found on project: $PROJECT_REF"
  exit 1
fi

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
