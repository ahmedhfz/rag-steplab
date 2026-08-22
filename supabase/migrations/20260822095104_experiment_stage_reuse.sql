begin;

alter table rag_lab.experiment_runs
  add column experiment_fingerprint varchar(64);

alter table rag_lab.experiment_runs
  add column identity_claimed boolean;

-- Only an active computation owns an exact request. Completed and failed rows
-- remain historical stage storage and do not block a later compatible retry.
alter table rag_lab.experiment_runs
  add constraint ck_experiment_runs_identity_claim
  check (identity_claimed is null or (identity_claimed and status = 'running'));

create unique index uq_experiment_runs_active_identity
  on rag_lab.experiment_runs (document_id, experiment_fingerprint)
  where identity_claimed is true;

-- The fingerprint index serves exact completed-history lookup; stage JSONB is
-- intentionally left unindexed until query measurements justify an expression index.
create index ix_experiment_runs_experiment_fingerprint
  on rag_lab.experiment_runs (experiment_fingerprint);

create index ix_experiment_runs_document_created
  on rag_lab.experiment_runs (document_id, created_at desc);

commit;
