#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$ROOT_DIR/scripts/check-migration-names.sh"

mkdir -p "$ROOT_DIR/supabase/migrations"
rsync -a --delete "$ROOT_DIR/migrations/" "$ROOT_DIR/supabase/migrations/"

echo "[prepare-shared-deploy] prepared supabase/migrations from migrations/"
