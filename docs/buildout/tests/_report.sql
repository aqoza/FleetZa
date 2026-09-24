-- Last result set = the report (execute_sql returns the last result set; the
-- trailing rollback returns none). Failures sort first. The 'zz script md5' row
-- fingerprints the script the server received (execute_sql appends a
-- '-- source' trailer, stripped here); compare it with `harness.mjs bundle`.
reset role;
select name, pass, detail
from (
  select name, pass, detail from _results
  union all
  select 'zz script md5', true, md5(split_part(current_query(), E'\n\n-- source: POST /mcp', 1))
) r
order by pass, name;
