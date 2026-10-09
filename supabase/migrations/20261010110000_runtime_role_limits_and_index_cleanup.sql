-- Runtime role hardening and index hygiene.

set lock_timeout = '5s';

-- 1. Bound every runtime session. A blocked FOR UPDATE / advisory lock or a
--    runaway statement can no longer pin the small API connection pool.
--    Repository transactions never span provider calls, so 30 s is ample.
alter role rag_steplab_app set statement_timeout = '30s';
alter role rag_steplab_app set lock_timeout = '5s';
alter role rag_steplab_app set idle_in_transaction_session_timeout = '60s';

-- 2. Least privilege in the extensions schema. The bootstrap grant re-opened
--    every extension function, including administrative ones that extensions
--    deliberately revoke from PUBLIC (e.g. pg_stat_statements_reset).
--    pgvector types, operators and functions remain executable via PUBLIC.
revoke execute on all functions in schema extensions from rag_steplab_app;

-- Trigger functions run without a caller EXECUTE check; nobody needs to call
-- this one directly (validate_document_pipeline_lineage is already revoked).
revoke all on function rag_lab.assign_pipeline_run_number() from public;

-- 3. Indexes that duplicate the leading column of another index.
drop index if exists rag_lab.ix_documents_owner_user_id;            -- uq_documents_owner_sha256
drop index if exists rag_lab.ix_chunk_embeddings_embedding_run_id;  -- uq_chunk_embeddings_run_chunk
drop index if exists rag_lab.ix_parse_runs_document_id;             -- uq_parse_runs_document_id_id
drop index if exists rag_lab.ix_chunk_runs_document_id;             -- uq_chunk_runs_document_id_id
drop index if exists rag_lab.ix_embedding_runs_document_id;         -- uq_embedding_runs_document_chunk_id

-- 4. Missing indexes: RESTRICT/CASCADE foreign keys of saved pipelines and the
--    per-user admission scan over active runs.
create index if not exists ix_document_pipelines_parse_run_id
  on rag_lab.document_pipelines (parse_run_id) where parse_run_id is not null;
create index if not exists ix_document_pipelines_chunk_run_id
  on rag_lab.document_pipelines (chunk_run_id) where chunk_run_id is not null;
create index if not exists ix_document_pipelines_embedding_run_id
  on rag_lab.document_pipelines (embedding_run_id) where embedding_run_id is not null;
create index if not exists ix_document_pipelines_owner_user_id
  on rag_lab.document_pipelines (owner_user_id);

create index if not exists ix_parse_runs_active
  on rag_lab.parse_runs (document_id) where status in ('queued', 'running');
create index if not exists ix_embedding_runs_active
  on rag_lab.embedding_runs (document_id) where status in ('queued', 'running');
create index if not exists ix_experiment_runs_active
  on rag_lab.experiment_runs (document_id) where status in ('queued', 'running');
create index if not exists ix_evaluation_runs_active
  on rag_lab.evaluation_runs (dataset_id) where status in ('queued', 'running');
