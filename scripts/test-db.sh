#!/usr/bin/env bash
# Testa as migrations e as políticas de RLS num Postgres local que imita o Supabase.
#
# Uso local:  bash scripts/test-db.sh            (sobe um Postgres temporário)
# No CI:      PGHOST/PGPORT/PGUSER/PGPASSWORD definidos → usa o banco informado.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${PGHOST:-}" ]]; then
  PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
  [[ -x "$PGBIN/initdb" ]] || { echo "Postgres não encontrado (defina PGBIN)."; exit 1; }
  TMP="$(mktemp -d)"
  trap 'set +e; "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1; rm -rf "$TMP"' EXIT
  RUN_AS=()
  if [[ "$(id -u)" == "0" ]]; then
    id postgres >/dev/null 2>&1 || useradd -m postgres
    chown -R postgres "$TMP"
    RUN_AS=(runuser -u postgres --)
  fi
  "${RUN_AS[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
  "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p 54329 -k $TMP -c listen_addresses=''" -l "$TMP/pg.log" -w start >/dev/null
  export PGHOST="$TMP" PGPORT=54329 PGUSER=postgres
fi
export PGDATABASE="${PGDATABASE:-postgres}"

PSQL=(psql -X -q -v ON_ERROR_STOP=1)

echo "→ Ambiente Supabase simulado"
"${PSQL[@]}" -f tests/db/00_supabase_shim.sql

for f in supabase/migrations/*.sql; do
  echo "→ Migration $(basename "$f")"
  "${PSQL[@]}" -f "$f" >/dev/null
done

echo "→ Dados de teste"
"${PSQL[@]}" -f tests/db/10_fixtures.sql

for f in tests/db/2*_test.sql; do
  echo "→ $(basename "$f")"
  # Os testes de permissão conectam como "authenticator", igual ao PostgREST,
  # para que session_user não seja um superusuário.
  PGUSER=authenticator PGPASSWORD=authenticator "${PSQL[@]}" -f "$f" >/dev/null
done

if compgen -G "tests/db/9*_superuser_test.sql" >/dev/null; then
  for f in tests/db/9*_superuser_test.sql; do
    echo "→ $(basename "$f")"
    "${PSQL[@]}" -f "$f" >/dev/null
  done
fi

echo "✓ Todos os testes de banco passaram."
