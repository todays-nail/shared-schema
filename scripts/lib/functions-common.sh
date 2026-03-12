#!/usr/bin/env bash

COMMON_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$COMMON_LIB_DIR/../.." && pwd)"
FUNCTIONS_DIR="$ROOT_DIR/supabase/functions"
DEFAULT_SUPABASE_PROJECT_REF="twahqxjhyocyqrmtjbdf"

require_command() {
  local command_name="$1"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "ERROR: required command is not installed: $command_name"
    exit 1
  fi
}

resolve_project_ref() {
  local cli_arg="${1:-}"

  if [[ -n "$cli_arg" ]]; then
    printf '%s\n' "$cli_arg"
    return
  fi

  if [[ -n "${SUPABASE_PROJECT_REF:-}" ]]; then
    printf '%s\n' "$SUPABASE_PROJECT_REF"
    return
  fi

  printf '%s\n' "$DEFAULT_SUPABASE_PROJECT_REF"
}

ensure_functions_dir() {
  if [[ ! -d "$FUNCTIONS_DIR" ]]; then
    echo "ERROR: functions directory not found: $FUNCTIONS_DIR"
    exit 1
  fi
}

list_local_function_names() {
  ensure_functions_dir

  find "$FUNCTIONS_DIR" -mindepth 2 -maxdepth 2 -name "index.ts" \
    | while IFS= read -r file; do
        basename "$(dirname "$file")"
      done \
    | sort -u
}
