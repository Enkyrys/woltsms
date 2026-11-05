#!/usr/bin/env bash
# Yerel uçtan uca test: gerçek migration'lar + gerçek worker kodu (processSendBatch) + sahte ENKYRYS API.
# Gerekenler: PostgreSQL 15+ (psql, initdb, pg_ctl), Node 20+, npx tsx.
# Kullanım: bash tests/e2e-local/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
PGBIN="${PGBIN:-$(dirname "$(command -v pg_ctl || echo /usr/lib/postgresql/16/bin/pg_ctl)")}"
D="$(mktemp -d)"; SOCK="$(mktemp -d)"
"$PGBIN/initdb" -D "$D" -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$D" -o "-k $SOCK -p 5499" -l "$D/log" start >/dev/null
trap '"$PGBIN/pg_ctl" -D "$D" stop >/dev/null; rm -rf "$D" "$SOCK"' EXIT
P="psql -h $SOCK -p 5499 -U $(whoami) -d postgres -v ON_ERROR_STOP=1 -q"
$P -f tests/e2e-local/supabase-stubs.sql >/dev/null 2>&1
for f in supabase/migrations/*.sql; do case "$f" in *0003*) continue;; esac; $P -f "$f" >/dev/null 2>&1 || { echo "migration hatası: $f"; exit 1; }; done
echo "migration'lar uygulandı"
$P -f tests/e2e-local/campaign-scenarios.sql
$P -f tests/e2e-local/activity-scenarios.sql
ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(printf 'a%.0s' {1..64})}" PGHOST="$SOCK" ${TSX:-npx tsx} --tsconfig tests/e2e-local/tsconfig.json tests/e2e-local/e2e-worker.mts
ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(printf 'a%.0s' {1..64})}" PGHOST="$SOCK" ${TSX:-npx tsx} --tsconfig tests/e2e-local/tsconfig.activity.json tests/e2e-local/e2e-activity.mts
