reset role;
-- Last result set = the report. The fingerprint row is the md5 of the submitted
-- script (execute_sql appends a '-- source' trailer, stripped here), so the run
-- can be matched byte-for-byte with this file.
select name, pass, detail
from (
  select name, pass, detail from _results
  union all
  select 'zz script md5', true,
         md5(split_part(current_query(), E'\n\n-- source: POST /mcp', 1))
) r
order by name;
