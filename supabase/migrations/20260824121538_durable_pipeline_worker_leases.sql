-- Durable pipeline workers: queued/running state, dispatch identity and
-- fencing leases. Existing artifacts remain historical; nullable lease
-- columns deliberately preserve legacy rows that were created before this
-- worker contract.

alter table rag_lab.chunk_runs
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz;

alter table rag_lab.chunk_runs
  add constraint ck_chunk_runs_lease_pair
  check ((lease_token is null) = (lease_expires_at is null));

alter table rag_lab.embedding_runs
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz;

alter table rag_lab.embedding_runs
  add constraint ck_embedding_runs_lease_pair
  check ((lease_token is null) = (lease_expires_at is null));

alter table rag_lab.experiment_runs
  add column if not exists dispatch_id varchar(255),
  add column if not exists attempt_count integer,
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists worker_started_at timestamptz;

update rag_lab.experiment_runs
set attempt_count = 0
where attempt_count is null;

alter table rag_lab.experiment_runs
  alter column attempt_count set default 0,
  alter column attempt_count set not null;

alter table rag_lab.experiment_runs
  drop constraint if exists experiment_runs_status_check,
  drop constraint if exists ck_experiment_runs_identity_claim;

alter table rag_lab.experiment_runs
  add constraint experiment_runs_status_check
  check (status = any (array['queued', 'running', 'completed', 'failed', 'interrupted']::varchar[])),
  add constraint ck_experiment_runs_identity_claim
  check (identity_claimed is null or (identity_claimed and status in ('queued', 'running'))),
  add constraint ck_experiment_runs_attempt_nonnegative
  check (attempt_count >= 0),
  add constraint ck_experiment_runs_lease_pair
  check ((lease_token is null) = (lease_expires_at is null));

alter table rag_lab.evaluation_runs
  add column if not exists dispatch_id varchar(255),
  add column if not exists evaluation_fingerprint varchar(64),
  add column if not exists identity_claimed boolean,
  add column if not exists attempt_count integer,
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists worker_started_at timestamptz;

update rag_lab.evaluation_runs
set attempt_count = 0
where attempt_count is null;

alter table rag_lab.evaluation_runs
  alter column attempt_count set default 0,
  alter column attempt_count set not null;

alter table rag_lab.evaluation_runs
  drop constraint if exists evaluation_runs_status_check,
  drop constraint if exists ck_evaluation_runs_identity_claim;

alter table rag_lab.evaluation_runs
  add constraint evaluation_runs_status_check
  check (status = any (array['queued', 'running', 'completed', 'failed', 'interrupted']::varchar[])),
  add constraint ck_evaluation_runs_identity_claim
  check (identity_claimed is null or (identity_claimed and status in ('queued', 'running'))),
  add constraint ck_evaluation_runs_attempt_nonnegative
  check (attempt_count >= 0),
  add constraint ck_evaluation_runs_lease_pair
  check ((lease_token is null) = (lease_expires_at is null));

create index if not exists ix_experiment_runs_lease_expiry
  on rag_lab.experiment_runs (lease_expires_at)
  where status in ('queued', 'running');

create index if not exists ix_evaluation_runs_lease_expiry
  on rag_lab.evaluation_runs (lease_expires_at)
  where status in ('queued', 'running');

create index if not exists ix_evaluation_runs_evaluation_fingerprint
  on rag_lab.evaluation_runs (evaluation_fingerprint);

create unique index if not exists uq_evaluation_runs_active_identity
  on rag_lab.evaluation_runs (dataset_id, evaluation_fingerprint)
  where identity_claimed is true;

create index if not exists ix_experiment_runs_dispatch
  on rag_lab.experiment_runs (dispatch_id)
  where dispatch_id is not null;

create index if not exists ix_evaluation_runs_dispatch
  on rag_lab.evaluation_runs (dispatch_id)
  where dispatch_id is not null;

comment on column rag_lab.experiment_runs.lease_token is
  'Opaque fencing token; every worker stage write must match the current token.';
comment on column rag_lab.evaluation_runs.lease_token is
  'Opaque fencing token; every worker stage write must match the current token.';
