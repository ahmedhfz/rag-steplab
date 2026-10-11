-- 1. Hosted embedding runs move from the API request onto the durable
--    pipeline worker; they need the same dispatch bookkeeping as
--    experiment/evaluation runs. Nullable/defaulted columns keep historical
--    rows untouched.
-- 2. The storage cleanup outbox gets bounded exponential retry and a terminal
--    'dead' state so one permanently failing object cannot block the queue.

set lock_timeout = '5s';

alter table rag_lab.embedding_runs
  add column if not exists dispatch_id varchar(255),
  add column if not exists attempt_count integer not null default 0,
  add column if not exists worker_started_at timestamptz;

alter table rag_lab.embedding_runs
  add constraint ck_embedding_runs_attempt_nonnegative check (attempt_count >= 0) not valid;

alter table rag_lab.storage_cleanups
  add column if not exists next_attempt_at timestamptz not null default now();

alter table rag_lab.storage_cleanups
  drop constraint if exists storage_cleanups_status_check;
alter table rag_lab.storage_cleanups
  add constraint storage_cleanups_status_check
  check (status in ('pending', 'completed', 'dead'));

drop index if exists rag_lab.ix_storage_cleanups_owner_pending;
create index if not exists ix_storage_cleanups_owner_due
  on rag_lab.storage_cleanups (owner_user_id, next_attempt_at, id)
  where status = 'pending';
create index if not exists ix_storage_cleanups_due
  on rag_lab.storage_cleanups (next_attempt_at, id)
  where status = 'pending';

comment on column rag_lab.storage_cleanups.next_attempt_at is
  'Earliest retry time; failures back off exponentially until the dead state.';
