#!/usr/bin/env bash
# P0.4 — qa-seed-fixtures determinism check (gate doc §7 P0.4 step 3).
#
# For each profile, seed twice into two distinct temp HOMEs and assert
# byte-identical output. SQLite DBs are checked via .dump (decoupled
# from page-cache layout) rather than raw file bytes — content
# determinism is what U1-VR cares about.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SEEDER="${REPO_ROOT}/scripts/qa-seed-fixtures.mjs"
TMP_BASE="${TMP_BASE:-/tmp/omt-qa-seed-test}"
PROFILES=(populated first-run setup-guide backfill)

mkdir -p "$TMP_BASE"

dump_db() {
  local db_path="$1"
  if [[ ! -f "$db_path" ]]; then return 0; fi
  ( cd "$REPO_ROOT" && node --input-type=module -e "
    import Database from 'better-sqlite3';
    const db = new Database('${db_path}', { readonly: true });
    const tables = db.prepare(\`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name
    \`).all();
    for (const { name } of tables) {
      const rows = db.prepare(\`SELECT * FROM \${name}\`).all();
      console.log('--', name, rows.length);
      for (const r of rows) {
        const sortedKeys = Object.keys(r).sort();
        const pairs = sortedKeys.map((k) => [k, r[k]]);
        console.log(JSON.stringify(Object.fromEntries(pairs)));
      }
    }
    db.close();
  " )
}

hash_tree() {
  local root="$1"
  local out_file="$2"
  : > "$out_file"
  cd "$root"
  while IFS= read -r -d '' f; do
    if [[ "$f" == *checktoken.db ]]; then
      hash=$(dump_db "$root/$f" | shasum -a 256 | awk '{print $1}')
      printf '%s\tDB-DUMP\t%s\n' "$hash" "$f" >> "$out_file"
    else
      hash=$(shasum -a 256 "$f" | awk '{print $1}')
      printf '%s\tFILE\t%s\n' "$hash" "$f" >> "$out_file"
    fi
  done < <(find . -type f -print0 | sort -z)
  cd - >/dev/null
}

failed=0
for p in "${PROFILES[@]}"; do
  A="${TMP_BASE}/qa-${p}-A"
  B="${TMP_BASE}/qa-${p}-B"
  rm -rf "$A" "$B"
  node "$SEEDER" "$p" --home "$A" >/dev/null
  node "$SEEDER" "$p" --home "$B" >/dev/null

  manifestA="${TMP_BASE}/qa-${p}-A.hashes"
  manifestB="${TMP_BASE}/qa-${p}-B.hashes"
  hash_tree "$A" "$manifestA"
  hash_tree "$B" "$manifestB"

  if diff -q "$manifestA" "$manifestB" >/dev/null; then
    summary=$(shasum -a 256 "$manifestA" | awk '{print $1}')
    echo "[qa-seed-fixtures-test] ${p}: PASS (${summary:0:12}...)"
  else
    echo "[qa-seed-fixtures-test] ${p}: FAIL — output differs across re-seed"
    diff -u "$manifestA" "$manifestB" || true
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "[qa-seed-fixtures-test] determinism check FAILED"
  exit 1
fi
echo "[qa-seed-fixtures-test] All ${#PROFILES[@]} profiles deterministic across re-seed."
