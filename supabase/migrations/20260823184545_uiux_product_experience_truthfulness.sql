-- UI/UX truthfulness and stable lineage projection support.
-- Existing rows are backfilled without exposing private storage metadata.

alter table rag_lab.evaluation_datasets
  add column if not exists series_id text;

update rag_lab.evaluation_datasets
set series_id = id
where series_id is null;

alter table rag_lab.evaluation_datasets
  alter column series_id set not null;

create unique index if not exists uq_evaluation_datasets_series_version
  on rag_lab.evaluation_datasets (series_id, version);

insert into rag_lab.document_pipelines (
  id,
  owner_user_id,
  document_id,
  name,
  parse_run_id,
  chunk_run_id,
  embedding_run_id,
  revision
)
select
  gen_random_uuid()::text,
  d.owner_user_id,
  d.id,
  'Default Pipeline',
  null,
  null,
  null,
  1
from rag_lab.documents d
where d.owner_user_id is not null
  and not exists (
    select 1
    from rag_lab.document_pipelines p
    where p.document_id = d.id
      and lower(p.name) = lower('Default Pipeline')
  );

comment on column rag_lab.evaluation_datasets.series_id is
  'Stable dataset lineage identifier; each saved version shares one series.';
