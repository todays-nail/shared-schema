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

expected_mode_for_function() {
  case "$1" in
    feed-detail|feed-like|feed-list|nail-gen-delete|nail-gen-like|nail-gen-list|nail-gen-refine-request|nail-gen-request|nail-gen-status|nail-gen-upload-url|owner-dashboard-summary|owner-notification-list|owner-notification-mark-all-read|owner-notification-mark-read|owner-payment-ledger-upsert|owner-quote-request-list|owner-quote-response-upsert|profile-style-insight|push-token-deactivate|push-token-upsert|quote-request-create|quote-request-list|quote-response-list|quote-response-select|region-boundary|regions-list|regions-tree|reservation-create|reservation-list|reservation-slots|shop-detail|shop-recommend|shop-search|users-delete|users-me)
      echo "app_access_jwt"
      ;;
    auth-refresh|auth-logout)
      echo "refresh_token"
      ;;
    auth-kakao)
      echo "kakao_exchange"
      ;;
    auth-google)
      echo "google_exchange"
      ;;
    auth-apple)
      echo "apple_exchange"
      ;;
    public-app-config|public-onboarding-styles)
      echo "public_config"
      ;;
    nail-gen-worker)
      echo "worker_secret"
      ;;
    *)
      echo ""
      ;;
  esac
}

expected_verify_jwt_for_mode() {
  case "$1" in
    "")
      echo ""
      ;;
    *)
      echo "false"
      ;;
  esac
}

expected_verify_jwt_for_function() {
  local mode
  mode="$(expected_mode_for_function "$1")"
  expected_verify_jwt_for_mode "$mode"
}
