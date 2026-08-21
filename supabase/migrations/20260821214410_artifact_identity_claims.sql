begin;

alter table rag_lab.chunk_runs
  add column identity_claimed boolean;

alter table rag_lab.embedding_runs
  add column identity_claimed boolean;

alter table rag_lab.embedding_runs
  add column effective_model varchar(255);

-- Keep every historical row, but reserve one deterministic canonical active
-- row per identity. Active pointers win so the migration does not change the
-- current learning surface; created_at/id make the fallback stable. Running
-- rows are claimed as well so a deployment cannot start a duplicate while an
-- older worker is still finishing.
with ranked as (
  select
    cr.id,
    row_number() over (
      partition by cr.parse_run_id, cr.strategy, cr.config_hash,
                   cr.tokenizer_version, cr.chunker_version
      order by (d.active_chunk_run_id = cr.id) is true desc,
               cr.created_at asc,
               cr.id asc
    ) as identity_rank
  from rag_lab.chunk_runs cr
  join rag_lab.documents d on d.id = cr.document_id
  where cr.status in ('running', 'completed')
)
update rag_lab.chunk_runs cr
set identity_claimed = case when ranked.identity_rank = 1 then true else null end
from ranked
where ranked.id = cr.id;

with ranked as (
  select
    er.id,
    row_number() over (
      partition by er.chunk_run_id, er.model, er.dimensions,
                   er.embedding_format_version
      order by (d.active_embedding_run_id = er.id) is true desc,
               er.created_at asc,
               er.id asc
    ) as identity_rank
  from rag_lab.embedding_runs er
  join rag_lab.documents d on d.id = er.document_id
  where er.status in ('running', 'completed')
)
update rag_lab.embedding_runs er
set identity_claimed = case when ranked.identity_rank = 1 then true else null end
from ranked
where ranked.id = er.id;

alter table rag_lab.chunk_runs
  add constraint ck_chunk_runs_identity_claim
  check (identity_claimed is null or (identity_claimed and status in ('running', 'completed')));

alter table rag_lab.embedding_runs
  add constraint ck_embedding_runs_identity_claim
  check (identity_claimed is null or (identity_claimed and status in ('running', 'completed')));

alter table rag_lab.chunk_runs
  add constraint uq_chunk_runs_artifact_identity
  unique (parse_run_id, strategy, config_hash, tokenizer_version,
          chunker_version, identity_claimed);

alter table rag_lab.embedding_runs
  add constraint uq_embedding_runs_artifact_identity
  unique (chunk_run_id, model, dimensions, embedding_format_version,
          identity_claimed);

alter table rag_lab.chunk_runs
  alter column identity_claimed set default true;

alter table rag_lab.embedding_runs
  alter column identity_claimed set default true;

commit;
