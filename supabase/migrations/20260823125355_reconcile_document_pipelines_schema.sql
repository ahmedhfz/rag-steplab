begin;

-- Aynı migration version'ıyla daha önce uygulanmış taslağı, history'yi
-- değiştirmeden onaylanan canonical şemaya ileri yönlü hizalar.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'rag_lab.document_pipelines'::regclass
      and conname = 'ck_document_pipelines_hierarchy'
  ) and not exists (
    select 1
    from pg_constraint
    where conrelid = 'rag_lab.document_pipelines'::regclass
      and conname = 'ck_document_pipelines_lineage_shape'
  ) then
    alter table rag_lab.document_pipelines
      rename constraint ck_document_pipelines_hierarchy
      to ck_document_pipelines_lineage_shape;
  end if;
end;
$$;

do $$
begin
  if to_regclass('rag_lab.uq_document_pipelines_document_name') is null
    and to_regclass('rag_lab.uq_document_pipelines_document_name_ci') is not null then
    alter index rag_lab.uq_document_pipelines_document_name_ci
      rename to uq_document_pipelines_document_name;
  end if;
end;
$$;

alter table rag_lab.document_pipelines
  drop constraint if exists fk_document_pipelines_owner_user;
alter table rag_lab.document_pipelines
  drop constraint if exists document_pipelines_owner_user_id_fkey;
alter table rag_lab.document_pipelines
  add constraint fk_document_pipelines_owner_user
  foreign key (owner_user_id) references auth.users(id) on delete cascade;

create or replace function rag_lab.validate_document_pipeline_lineage()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  document_owner uuid;
  parse_document_id varchar(36);
  parse_status varchar(32);
  chunk_document_id varchar(36);
  chunk_parse_run_id varchar(36);
  chunk_status varchar(32);
  embedding_document_id varchar(36);
  embedding_chunk_run_id varchar(36);
  embedding_status varchar(32);
begin
  select owner_user_id
    into document_owner
    from rag_lab.documents
   where id = new.document_id;

  if document_owner is null or document_owner <> new.owner_user_id then
    raise exception using
      errcode = '23514',
      constraint = 'ck_document_pipelines_owner_matches_document',
      message = 'document pipeline owner must match the document owner';
  end if;

  if new.parse_run_id is not null then
    select document_id, status
      into parse_document_id, parse_status
      from rag_lab.parse_runs
     where id = new.parse_run_id;
    if parse_document_id is distinct from new.document_id or parse_status is distinct from 'completed' then
      raise exception using
        errcode = '23514',
        constraint = 'ck_document_pipelines_parse_lineage',
        message = 'document pipeline parse run must be a completed run for the same document';
    end if;
  end if;

  if new.chunk_run_id is not null then
    select document_id, parse_run_id, status
      into chunk_document_id, chunk_parse_run_id, chunk_status
      from rag_lab.chunk_runs
     where id = new.chunk_run_id;
    if chunk_document_id is distinct from new.document_id
      or chunk_parse_run_id is distinct from new.parse_run_id
      or chunk_status is distinct from 'completed' then
      raise exception using
        errcode = '23514',
        constraint = 'ck_document_pipelines_chunk_lineage',
        message = 'document pipeline chunk run must be a completed child of the selected parse run';
    end if;
  end if;

  if new.embedding_run_id is not null then
    select document_id, chunk_run_id, status
      into embedding_document_id, embedding_chunk_run_id, embedding_status
      from rag_lab.embedding_runs
     where id = new.embedding_run_id;
    if embedding_document_id is distinct from new.document_id
      or embedding_chunk_run_id is distinct from new.chunk_run_id
      or embedding_status is distinct from 'completed' then
      raise exception using
        errcode = '23514',
        constraint = 'ck_document_pipelines_embedding_lineage',
        message = 'document pipeline embedding run must be a completed child of the selected chunk run';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function rag_lab.validate_document_pipeline_lineage() from public;

drop trigger if exists trg_document_pipelines_validate_lineage
  on rag_lab.document_pipelines;
create trigger trg_document_pipelines_validate_lineage
before insert or update of owner_user_id, document_id, parse_run_id, chunk_run_id, embedding_run_id
on rag_lab.document_pipelines
for each row execute function rag_lab.validate_document_pipeline_lineage();

grant select, insert, update, delete on rag_lab.document_pipelines to rag_steplab_app;
revoke all on rag_lab.document_pipelines from anon, authenticated;

commit;
