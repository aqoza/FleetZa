#!/bin/bash
# Assembles foundation_test.sql = begin; foundation migration (with a lock probe
# spliced in right before its section 17, i.e. before the only statements that
# may take contended locks); tests; storage tests; report; rollback;
# Also writes foundation_test_live.sql (comments/blank lines/indent stripped,
# same statements) for the execute_sql dry-run; its md5 is the report's
# 'zz script md5' row.
set -e
D=$(cd "$(dirname "$0")" && pwd)
M="$D/../../../supabase/migrations/20260924000001_platform_foundation.sql"
python3 - "$M" "$D" <<'PY'
import sys
m, d = sys.argv[1], sys.argv[2]
src = open(m).read()
marker = "-- ============================================================\n-- 17) Existing-table changes"
assert src.count(marker) == 1, "section 17 marker missing"
probe = """-- [test harness] contended locks held before sections 17/18 (must be none)
create temp table _lock_probe on commit drop as
select coalesce(string_agg(c.relnamespace::regnamespace::text || '.' || c.relname, ', ' order by 1), '') as held
from pg_locks l join pg_class c on c.oid = l.relation
where l.pid = pg_backend_pid() and l.mode = 'AccessExclusiveLock'
  and (c.relnamespace::regnamespace::text in ('auth', 'storage', 'realtime')
       or c.oid in ('public.vehicles'::regclass, 'public.drivers'::regclass,
                    'public.document_sequences'::regclass));
grant select on _lock_probe to public;

"""
i = src.index(marker)
parts = ["begin;\n", src[:i], probe, src[i:]]
for f in ["foundation_tests_body.sql", "foundation_tests_storage.sql", "foundation_tests_report.sql"]:
    parts.append(open(f"{d}/{f}").read())
parts.append("rollback;\n")
full = "".join(parts)
open(f"{d}/foundation_test.sql", "w").write(full)
import re
live = [re.sub(r"^\s+", "", l) for l in full.split("\n")]
live = [l for l in live if l.strip() and not l.startswith("--")]
open(f"{d}/foundation_test_live.sql", "w").write("\n".join(live))
PY
wc -lc "$D/foundation_test.sql" "$D/foundation_test_live.sql"
echo "live md5: $(md5sum < "$D/foundation_test_live.sql" | cut -d' ' -f1)"
