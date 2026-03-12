#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_REF="${1:-${SUPABASE_PROJECT_REF:-twahqxjhyocyqrmtjbdf}}"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "ERROR: SUPABASE_ACCESS_TOKEN secret is required when deploying functions."
  exit 1
fi

bash "$SCRIPT_DIR/deploy-functions.sh" "$PROJECT_REF"
bash "$SCRIPT_DIR/functions-check-deployed.sh" "$PROJECT_REF"
bash "$SCRIPT_DIR/functions-check-auth-config.sh" "$PROJECT_REF"

echo "[deploy-and-validate-functions] completed for project $PROJECT_REF"
