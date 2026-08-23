begin;

create table rag_lab.document_pipelines (
  id varchar(36) primary key,
  owner_user_id uuid not null,
  document_id varchar(36) not null,
  name varchar(100) not null,
  parse_run_id varchar(36),
  chunk_run_id varchar(36),
  embedding_run_id varchar(36),
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_document_pipelines_name
    check (name = btrim(name) and char_length(name) between 1 and 100),
  constraint ck_document_pipelines_revision
    check (revision > 0),
  constraint ck_document_pipelines_lineage_shape
    check (
      (parse_run_id is not null or (chunk_run_id is null and embedding_run_id is null))
      and (chunk_run_id is not null or embedding_run_id is null)
    ),
  constraint fk_document_pipelines_owner_user
    foreign key (owner_user_id) references auth.users(id) on delete cascade,
  constraint fk_document_pipelines_document
    foreign key (document_id) references rag_lab.documents(id) on delete cascade,
  constraint fk_document_pipelines_parse
    foreign key (parse_run_id) references rag_lab.parse_runs(id) on delete restrict,
  constraint fk_document_pipelines_chunk
    foreign key (chunk_run_id) references rag_lab.chunk_runs(id) on delete restrict,
  constraint fk_document_pipelines_embedding
    foreign key (embedding_run_id) references rag_lab.embedding_runs(id) on delete restrict
);

create unique index uq_document_pipelines_document_name
  on rag_lab.document_pipelines (document_id, lower(name));

create or replace function rag_lab.validate_document_pipeline_lineage()
returns trigger
language plpgsql
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

create trigger trg_document_pipelines_validate_lineage
before insert or update of owner_user_id, document_id, parse_run_id, chunk_run_id, embedding_run_id
on rag_lab.document_pipelines
for each row execute function rag_lab.validate_document_pipeline_lineage();

grant select, insert, update, delete on rag_lab.document_pipelines to rag_steplab_app;
revoke all on rag_lab.document_pipelines from anon, authenticated;

commit;
