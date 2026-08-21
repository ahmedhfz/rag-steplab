begin;

alter table rag_lab.documents
  add column if not exists owner_user_id uuid;

alter table rag_lab.documents
  add column if not exists is_canonical boolean not null default true;

do $$
declare
  legacy_owner_count integer;
  legacy_owner_id uuid;
  documents_without_owner integer;
begin
  select count(*)
    into documents_without_owner
    from rag_lab.documents
   where owner_user_id is null;

  if documents_without_owner = 0 then
    return;
  end if;

  select count(*)
    into legacy_owner_count
    from auth.users
   where coalesce(raw_app_meta_data ->> 'rag_steplab_legacy_owner', '') = 'true';

  if legacy_owner_count <> 1 then
    raise exception using
      message = 'RAG StepLab ownership backfill requires exactly one auth user marked rag_steplab_legacy_owner=true';
  end if;

  select id
    into legacy_owner_id
    from auth.users
   where coalesce(raw_app_meta_data ->> 'rag_steplab_legacy_owner', '') = 'true'
   limit 1;

  update rag_lab.documents
     set owner_user_id = legacy_owner_id
   where owner_user_id is null;

  -- Keep historical duplicate rows, but select one current canonical row per
  -- owner/SHA so a repeat upload can reuse it without creating new lineage.
  with ranked as (
    select id,
           row_number() over (
             partition by owner_user_id, sha256
             order by (active_parse_run_id is not null) desc,
                      updated_at desc nulls last,
                      created_at desc nulls last,
                      id
           ) as row_number
      from rag_lab.documents
     where owner_user_id = legacy_owner_id
  )
  update rag_lab.documents as document
     set is_canonical = ranked.row_number = 1
    from ranked
   where document.id = ranked.id;
end;
$$;

alter table rag_lab.documents
  add constraint fk_documents_owner_user
  foreign key (owner_user_id) references auth.users(id) on delete restrict;

create index if not exists ix_documents_owner_user_id
  on rag_lab.documents (owner_user_id);

create index if not exists ix_documents_owner_user_sha256
  on rag_lab.documents (owner_user_id, sha256);

commit;
