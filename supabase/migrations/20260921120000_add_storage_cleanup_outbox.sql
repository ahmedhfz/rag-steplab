-- Private source objects outlive logical document deletion only while a
-- retryable cleanup is pending. The row is created in the same transaction as
-- the document cascade and contains no client-visible data.
create table if not exists rag_lab.storage_cleanups (
  id varchar(36) primary key,
  -- Deliberately no auth.users FK: cleanup evidence must survive account
  -- deletion until the private storage object is actually removed.
  owner_user_id uuid not null,
  storage_bucket varchar(255) not null,
  storage_path varchar(1024) not null unique,
  status varchar(32) not null default 'pending',
  attempt_count integer not null default 0,
  last_error_code varchar(128),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint storage_cleanups_status_check check (status in ('pending', 'completed')),
  constraint storage_cleanups_attempt_nonnegative check (attempt_count >= 0)
);

create index if not exists ix_storage_cleanups_owner_pending
  on rag_lab.storage_cleanups (owner_user_id, created_at, id)
  where status = 'pending';

alter table rag_lab.storage_cleanups disable row level security;
revoke all on rag_lab.storage_cleanups from anon, authenticated, public;
grant select, insert, update, delete on rag_lab.storage_cleanups to rag_steplab_app;

comment on table rag_lab.storage_cleanups is
  'Backend-private eventual cleanup outbox for deleted source PDF objects.';
