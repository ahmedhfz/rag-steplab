-- Stable, owner-safe display numbers for parse/chunk/embedding lineage.
-- Atomic counters live on the owning document, so concurrent inserts cannot
-- receive the same number and deleted history never causes number reuse.

alter table rag_lab.parse_runs add column if not exists run_number integer;
alter table rag_lab.chunk_runs add column if not exists run_number integer;
alter table rag_lab.embedding_runs add column if not exists run_number integer;
alter table rag_lab.documents add column if not exists parse_run_counter integer not null default 0;
alter table rag_lab.documents add column if not exists chunk_run_counter integer not null default 0;
alter table rag_lab.documents add column if not exists embedding_run_counter integer not null default 0;

with numbered as (
  select id, row_number() over (partition by document_id order by created_at, id)::integer as run_number
  from rag_lab.parse_runs
)
update rag_lab.parse_runs as target set run_number = numbered.run_number
from numbered where target.id = numbered.id and target.run_number is null;

with numbered as (
  select id, row_number() over (partition by document_id order by created_at, id)::integer as run_number
  from rag_lab.chunk_runs
)
update rag_lab.chunk_runs as target set run_number = numbered.run_number
from numbered where target.id = numbered.id and target.run_number is null;

with numbered as (
  select id, row_number() over (partition by document_id order by created_at, id)::integer as run_number
  from rag_lab.embedding_runs
)
update rag_lab.embedding_runs as target set run_number = numbered.run_number
from numbered where target.id = numbered.id and target.run_number is null;

update rag_lab.documents as document set
  parse_run_counter = coalesce((select max(run_number) from rag_lab.parse_runs where document_id = document.id), 0),
  chunk_run_counter = coalesce((select max(run_number) from rag_lab.chunk_runs where document_id = document.id), 0),
  embedding_run_counter = coalesce((select max(run_number) from rag_lab.embedding_runs where document_id = document.id), 0);

create or replace function rag_lab.assign_pipeline_run_number()
returns trigger
language plpgsql
set search_path = pg_catalog, rag_lab
as $$
begin
  if new.run_number is not null then
    return new;
  end if;
  if tg_table_name = 'parse_runs' then
    update rag_lab.documents set parse_run_counter = parse_run_counter + 1
    where id = new.document_id returning parse_run_counter into new.run_number;
  elsif tg_table_name = 'chunk_runs' then
    update rag_lab.documents set chunk_run_counter = chunk_run_counter + 1
    where id = new.document_id returning chunk_run_counter into new.run_number;
  elsif tg_table_name = 'embedding_runs' then
    update rag_lab.documents set embedding_run_counter = embedding_run_counter + 1
    where id = new.document_id returning embedding_run_counter into new.run_number;
  else
    raise exception 'Unsupported pipeline run table: %', tg_table_name;
  end if;
  return new;
end;
$$;

drop trigger if exists assign_parse_run_number on rag_lab.parse_runs;
create trigger assign_parse_run_number before insert on rag_lab.parse_runs
for each row execute function rag_lab.assign_pipeline_run_number();

drop trigger if exists assign_chunk_run_number on rag_lab.chunk_runs;
create trigger assign_chunk_run_number before insert on rag_lab.chunk_runs
for each row execute function rag_lab.assign_pipeline_run_number();

drop trigger if exists assign_embedding_run_number on rag_lab.embedding_runs;
create trigger assign_embedding_run_number before insert on rag_lab.embedding_runs
for each row execute function rag_lab.assign_pipeline_run_number();

alter table rag_lab.parse_runs alter column run_number set not null;
alter table rag_lab.chunk_runs alter column run_number set not null;
alter table rag_lab.embedding_runs alter column run_number set not null;

alter table rag_lab.parse_runs add constraint ck_parse_runs_run_number_positive check (run_number > 0);
alter table rag_lab.chunk_runs add constraint ck_chunk_runs_run_number_positive check (run_number > 0);
alter table rag_lab.embedding_runs add constraint ck_embedding_runs_run_number_positive check (run_number > 0);

create unique index if not exists uq_parse_runs_document_run_number on rag_lab.parse_runs (document_id, run_number);
create unique index if not exists uq_chunk_runs_document_run_number on rag_lab.chunk_runs (document_id, run_number);
create unique index if not exists uq_embedding_runs_document_run_number on rag_lab.embedding_runs (document_id, run_number);
