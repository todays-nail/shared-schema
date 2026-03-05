#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUNCTIONS_DIR="$ROOT_DIR/supabase/functions"
PROJECT_REF="${1:-${SUPABASE_PROJECT_REF:-twahqxjhyocyqrmtjbdf}}"

if ! command -v supabase >/dev/null 2>&1; then
  echo "ERROR: supabase CLI is not installed."
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is not installed."
  exit 1
fi

if [[ ! -d "$FUNCTIONS_DIR" ]]; then
  echo "ERROR: functions directory not found: $FUNCTIONS_DIR"
  exit 1
fi

expected_mode_for() {
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

expected_verify_jwt_for() {
  case "$1" in
    "")
      echo ""
      ;;
    *)
      echo "false"
      ;;
  esac
}

required_secrets_for_mode() {
  case "$1" in
    google_exchange)
      echo "GOOGLE_OAUTH_AUDIENCES"
      ;;
    apple_exchange)
      echo "APPLE_OAUTH_AUDIENCES"
      ;;
    *)
      echo ""
      ;;
  esac
}

LOCAL_FUNCTIONS=()
while IFS= read -r file; do
  func_name="$(basename "$(dirname "$file")")"
  LOCAL_FUNCTIONS+=("$func_name")
done < <(find "$FUNCTIONS_DIR" -mindepth 2 -maxdepth 2 -name "index.ts" | sort)

if [[ ${#LOCAL_FUNCTIONS[@]} -eq 0 ]]; then
  echo "No local edge functions found."
  exit 1
fi

UNCLASSIFIED=()
for func_name in "${LOCAL_FUNCTIONS[@]}"; do
  mode="$(expected_mode_for "$func_name")"
  if [[ -z "$mode" ]]; then
    UNCLASSIFIED+=("$func_name")
  fi
done

if [[ ${#UNCLASSIFIED[@]} -gt 0 ]]; then
  echo "ERROR: auth mode classification is missing for function(s):"
  for func_name in "${UNCLASSIFIED[@]}"; do
    echo " - $func_name"
  done
  echo "Update scripts/functions-check-auth-config.sh classification arrays."
  exit 1
fi

REMOTE_JSON="$(supabase functions list -o json --project-ref "$PROJECT_REF")"
REMOTE_SECRETS_JSON="$(supabase secrets list -o json --project-ref "$PROJECT_REF")"
REMOTE_SECRET_NAMES="$(echo "$REMOTE_SECRETS_JSON" | jq -r '.[].name')"

MISSING_REMOTE=()
VERIFY_MISMATCH=()
MISSING_SECRETS=()

for func_name in "${LOCAL_FUNCTIONS[@]}"; do
  actual="$(echo "$REMOTE_JSON" | jq -r --arg name "$func_name" '
    (map(select(.name == $name)) | .[0]) as $row
    | if $row == null then "__MISSING__" else (if $row.verify_jwt then "true" else "false" end) end
  ')"

  if [[ "$actual" == "__MISSING__" ]]; then
    MISSING_REMOTE+=("$func_name")
    continue
  fi

  mode="$(expected_mode_for "$func_name")"
  expected="$(expected_verify_jwt_for "$mode")"

  if [[ "$actual" != "$expected" ]]; then
    VERIFY_MISMATCH+=("$func_name (mode=$mode expected=$expected actual=$actual)")
  fi

  required_secrets="$(required_secrets_for_mode "$mode")"
  if [[ -z "$required_secrets" ]]; then
    continue
  fi

  for secret_name in $required_secrets; do
    if ! grep -qx "$secret_name" <<<"$REMOTE_SECRET_NAMES"; then
      MISSING_SECRETS+=("$func_name (mode=$mode missing_secret=$secret_name)")
    fi
  done
done

if [[ ${#MISSING_REMOTE[@]} -gt 0 ]]; then
  echo "ERROR: missing deployed functions on project $PROJECT_REF:"
  for func_name in "${MISSING_REMOTE[@]}"; do
    echo " - $func_name"
  done
fi

if [[ ${#VERIFY_MISMATCH[@]} -gt 0 ]]; then
  echo "ERROR: verify_jwt mismatch on project $PROJECT_REF:"
  for item in "${VERIFY_MISMATCH[@]}"; do
    echo " - $item"
  done
fi

if [[ ${#MISSING_SECRETS[@]} -gt 0 ]]; then
  echo "ERROR: required auth secrets missing on project $PROJECT_REF:"
  for item in "${MISSING_SECRETS[@]}"; do
    echo " - $item"
  done
fi

if [[ ${#MISSING_REMOTE[@]} -gt 0 || ${#VERIFY_MISMATCH[@]} -gt 0 || ${#MISSING_SECRETS[@]} -gt 0 ]]; then
  exit 1
fi

echo "Auth config check passed on project $PROJECT_REF."
echo " - Local functions: ${#LOCAL_FUNCTIONS[@]}"
echo " - Expected verify_jwt=false for all classified functions"
echo " - Required auth secrets are present"
