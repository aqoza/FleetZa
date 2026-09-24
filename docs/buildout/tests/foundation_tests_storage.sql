
-- =====================================================================
-- STORAGE / DOCUMENTS TESTS (bucket + storage.objects policies from section 18)
-- =====================================================================
reset role;
do $$
begin
  perform pg_temp.ok('09 documents bucket private 25MB + 4 object policies',
    exists (select 1 from storage.buckets where id = 'documents' and not public
            and file_size_limit = 26214400)
    and (select count(*) from pg_policies where schemaname = 'storage'
         and policyname like 'documents\_objects\_%') = 4, null);
end $$;

select pg_temp.set_module('documents', true);
do $$
declare v_doc uuid := gen_random_uuid(); v_err text; v_e2 text; v int; v_off int;
begin
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  insert into public.documents (id, name, storage_path, mime_type, size_bytes, entity_type, entity_id, category)
  values (v_doc, 'policy.pdf', '170d2d86-5c22-4bcb-9d74-420c879419b2/' || v_doc || '/policy.pdf',
          'application/pdf', 1234, 'vehicle', gen_random_uuid(), 'insurance');
  begin
    insert into public.documents (name, storage_path)
    values ('x.pdf', 'd0000000-0000-4000-8000-0000000000d0/' || gen_random_uuid() || '/x.pdf');
    v_err := 'allowed';
  exception when others then v_err := sqlstate;
  end;
  perform pg_temp.ok('09a documents row must live in own tenant folder', v_err = '23514', v_err);

  insert into storage.objects (bucket_id, name)
  values ('documents', '170d2d86-5c22-4bcb-9d74-420c879419b2/' || v_doc || '/policy.pdf');
  begin
    insert into storage.objects (bucket_id, name)
    values ('documents', 'd0000000-0000-4000-8000-0000000000d0/' || v_doc || '/evil.pdf');
    v_err := 'allowed';
  exception when others then v_err := sqlstate;
  end;
  perform pg_temp.become('a0000000-0000-4000-8000-00000000000a', 'viewer');
  select count(*) into v from storage.objects where bucket_id = 'documents';
  begin
    insert into storage.objects (bucket_id, name)
    values ('documents', '170d2d86-5c22-4bcb-9d74-420c879419b2/' || v_doc || '/viewer.pdf');
    v_e2 := 'allowed';
  exception when others then v_e2 := sqlstate;
  end;
  select count(*) into v_off from public.documents;
  perform pg_temp.ok('09b storage: owner writes own folder only; viewer reads, cannot write',
    v_err = '42501' and v_e2 = '42501' and v = 1 and v_off = 1,
    'foreign=' || v_err || ' viewer_insert=' || v_e2 || ' viewer_sees=' || v || ' docs=' || v_off);
  reset role;
end $$;

-- 09d-09f F1: HR files follow the employee restriction, objects follow rows
do $$
declare
  v_t text := '170d2d86-5c22-4bcb-9d74-420c879419b2/';
  v_d1 uuid := gen_random_uuid(); v_d2 uuid := gen_random_uuid(); v_d3 uuid := gen_random_uuid();
  v_orphan uuid := gen_random_uuid();
  v_docs int; v_objs int; v_mine int;
begin
  perform pg_temp.become('950e38aa-2bd7-4c55-9dfc-9b4255316548', 'manager');
  insert into public.documents (id, name, storage_path, entity_type, entity_id, category) values
    (v_d1, 'Passport - Sara', v_t || v_d1 || '/passport.pdf', 'employee', pg_temp.get('emp_sara'), 'permit'),
    (v_d2, 'Contract - Mo', v_t || v_d2 || '/contract.pdf', 'employee', pg_temp.get('emp_mo'), 'contract'),
    (v_d3, 'Payslip - Mo', v_t || v_d3 || '/payslip.pdf', 'hr_payslip', pg_temp.get('emp_mo'), 'other');
  insert into storage.objects (bucket_id, name) values
    ('documents', v_t || v_d1 || '/passport.pdf'),
    ('documents', v_t || v_d2 || '/contract.pdf'),
    ('documents', v_t || v_d3 || '/payslip.pdf'),
    ('documents', v_t || v_orphan || '/orphan.pdf');
  select count(*) into v_docs from public.documents;
  select count(*) into v_objs from storage.objects where bucket_id = 'documents';
  perform pg_temp.ok('09d manager sees every document and object (incl. orphan)', v_docs = 4 and v_objs = 5,
    'docs=' || v_docs || ' objects=' || v_objs);

  perform pg_temp.become('a0000000-0000-4000-8000-00000000000a', 'viewer');
  select count(*) into v_docs from public.documents where entity_type in ('employee', 'hr_payslip');
  select count(*) into v_objs from storage.objects where bucket_id = 'documents';
  perform pg_temp.ok('09e viewer: 0 HR documents; only the vehicle file (no HR, no orphan)',
    v_docs = 0 and v_objs = 1, 'hr_docs=' || v_docs || ' objects=' || v_objs);

  -- the manager's login linked to employee Mo, acting with a viewer role
  perform pg_temp.become('950e38aa-2bd7-4c55-9dfc-9b4255316548', 'viewer');
  select count(*) into v_docs from public.documents where entity_type in ('employee', 'hr_payslip');
  select count(*) into v_mine from public.documents where id = v_d2;
  select count(*) into v_objs from storage.objects where bucket_id = 'documents';
  perform pg_temp.ok('09f linked employee sees own employee file only (not hr_*, not others)',
    v_docs = 1 and v_mine = 1 and v_objs = 2, 'hr_docs=' || v_docs || ' own=' || v_mine || ' objects=' || v_objs);
  reset role;
end $$;

do $$
declare v int; v_off int;
begin
  perform pg_temp.set_module('documents', false);
  perform pg_temp.become('129bbbae-fdfc-4d21-8a86-8949fec2403b', 'owner');
  select count(*) into v from storage.objects where bucket_id = 'documents';
  select count(*) into v_off from public.documents;
  perform pg_temp.ok('09c documents module off hides files + rows', v = 0 and v_off = 0, 'objects=' || v || ' docs=' || v_off);
  reset role;
end $$;

