#!/usr/bin/env bash
# run-migrations.sh
# Runs all 13 migrations against Supabase IN ORDER using the Management API.
# Requires SUPABASE_DB_URL (direct postgres connection string) or
# SUPABASE_SERVICE_KEY (service_role JWT — starts with eyJ...)
#
# Usage:
#   SUPABASE_DB_URL="postgresql://postgres:[password]@db.urdhebsbnjbtdnookwmk.supabase.co:5432/postgres" \
#   bash run-migrations.sh

set -euo pipefail

DB_URL="${SUPABASE_DB_URL:-}"

if [ -z "$DB_URL" ]; then
  echo "ERROR: SUPABASE_DB_URL is not set."
  echo "Get it from: Supabase Dashboard → Project Settings → Database → Connection string (URI)"
  echo ""
  echo "Example: postgresql://postgres:[YOUR-PASSWORD]@db.urdhebsbnjbtdnookwmk.supabase.co:5432/postgres"
  exit 1
fi

MIGRATIONS_DIR="$(dirname "$0")/migrations"
MIGRATIONS=$(ls "$MIGRATIONS_DIR"/*.sql | sort)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " GTM Autopilot — Running Migrations"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

for FILE in $MIGRATIONS; do
  NAME=$(basename "$FILE")
  echo "▶ Running $NAME ..."
  psql "$DB_URL" -f "$FILE" -v ON_ERROR_STOP=1 2>&1
  if [ $? -eq 0 ]; then
    echo "  ✓ $NAME — SUCCESS"
  else
    echo "  ✗ $NAME — FAILED. Stopping."
    exit 1
  fi
  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " All migrations complete. Verifying..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Verify event_log has NO updated_at
echo ""
echo "Checking event_log has no updated_at..."
RESULT=$(psql "$DB_URL" -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='event_log' AND column_name='updated_at';" 2>&1)
if [ -z "$(echo $RESULT | tr -d '[:space:]')" ]; then
  echo "  ✓ event_log: NO updated_at column confirmed"
else
  echo "  ✗ FAIL: event_log has updated_at column — this violates the schema rules!"
  exit 1
fi

# Verify decision_snapshot is NOT NULL on event_log
echo "Checking decision_snapshot is JSONB NOT NULL on event_log..."
RESULT=$(psql "$DB_URL" -t -c "SELECT is_nullable FROM information_schema.columns WHERE table_name='event_log' AND column_name='decision_snapshot';" 2>&1)
if echo "$RESULT" | grep -q "NO"; then
  echo "  ✓ event_log.decision_snapshot: JSONB NOT NULL confirmed"
else
  echo "  ✗ FAIL: decision_snapshot is nullable"
  exit 1
fi

# Verify organization_id exists on every table
echo "Checking organization_id on all tables..."
TABLES="leads companies external_identity evidence policy_rules action_risk_registry play_instance event_log action_execution_state connector_config routing_state"
for TABLE in $TABLES; do
  RESULT=$(psql "$DB_URL" -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='$TABLE' AND column_name='organization_id';" 2>&1)
  if [ -n "$(echo $RESULT | tr -d '[:space:]')" ]; then
    echo "  ✓ $TABLE.organization_id: present"
  else
    echo "  ✗ FAIL: $TABLE is missing organization_id!"
    exit 1
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " ✓ All verifications passed!"
echo " Next: commit to feat/schema and open PR to main."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
