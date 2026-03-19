#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/functions-common.sh
source "$SCRIPT_DIR/lib/functions-common.sh"

PROJECT_REF="$(resolve_project_ref "${2:-}")"
FUNCTION_NAME="${1:-}"

require_command "supabase"

if [[ -z "$FUNCTION_NAME" ]]; then
  echo "Usage: bash scripts/deploy-single-function.sh <function-name> [project-ref]"
  exit 1
fi

if [[ ! -f "$FUNCTIONS_DIR/$FUNCTION_NAME/index.ts" ]]; then
  echo "ERROR: function not found: $FUNCTION_NAME"
  exit 1
fi

MODE="$(expected_mode_for_function "$FUNCTION_NAME")"
if [[ -z "$MODE" ]]; then
  echo "ERROR: auth mode classification is missing for function: $FUNCTION_NAME"
  exit 1
fi

EXPECTED_VERIFY_JWT="$(expected_verify_jwt_for_mode "$MODE")"
DEPLOY_ARGS=()
if [[ "$EXPECTED_VERIFY_JWT" == "false" ]]; then
  DEPLOY_ARGS+=(--no-verify-jwt)
fi

echo "[deploy-single-function] deploying: $FUNCTION_NAME mode=$MODE verify_jwt=$EXPECTED_VERIFY_JWT"
supabase functions deploy "$FUNCTION_NAME" --project-ref "$PROJECT_REF" "${DEPLOY_ARGS[@]}"
bash "$SCRIPT_DIR/functions-check-auth-config.sh" "$PROJECT_REF"

echo "[deploy-single-function] completed. function=$FUNCTION_NAME project=$PROJECT_REF"
