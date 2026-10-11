begin;

select plan(60);

select ok(to_regnamespace('rag_lab') is not null, 'rag_lab schema exists');

select ok(to_regclass('rag_lab.documents') is not null, 'documents table exists');
select ok(to_regclass('rag_lab.parse_runs') is not null, 'parse_runs table exists');
select ok(to_regclass('rag_lab.chunk_runs') is not null, 'chunk_runs table exists');
select ok(to_regclass('rag_lab.chunks') is not null, 'chunks table exists');
select ok(to_regclass('rag_lab.embedding_runs') is not null, 'embedding_runs table exists');
select ok(to_regclass('rag_lab.chunk_embeddings') is not null, 'chunk_embeddings table exists');
select ok(to_regclass('rag_lab.experiment_runs') is not null, 'experiment_runs table exists');
select ok(to_regclass('rag_lab.evaluation_datasets') is not null, 'evaluation_datasets table exists');
select ok(to_regclass('rag_lab.evaluation_runs') is not null, 'evaluation_runs table exists');

select ok(
  exists (select 1 from pg_extension where extname = 'vector'),
  'vector extension exists'
);

select ok(
  exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'rag_lab'
      and c.relname = 'chunk_embeddings'
      and a.attname = 'embedding'
      and format_type(a.atttypid, a.atttypmod) like '%vector(768)'
  ),
  'embedding vector dimension is 768'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'rag_lab'
      and table_name = 'chunks'
      and column_name = 'search_vector'
      and is_generated = 'ALWAYS'
      and generation_expression like '%to_tsvector%'
  ),
  'search_vector is generated from text'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'rag_lab'
      and indexname = 'ix_chunks_search_vector'
      and indexdef like '% USING gin %'
  ),
  'search_vector has a GIN index'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'rag_lab'
      and indexname = 'uq_parse_runs_document_inflight'
      and indexdef like '%queued%'
      and indexdef like '%running%'
  ),
  'parse inflight partial unique index exists'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'rag_lab'
      and table_name = 'chunk_runs'
      and column_name = 'identity_claimed'
      and column_default = 'true'
  ),
  'chunk artifact identity claim column defaults to true'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'rag_lab'
      and table_name = 'embedding_runs'
      and column_name = 'identity_claimed'
      and column_default = 'true'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'rag_lab'
      and table_name = 'embedding_runs'
      and column_name = 'effective_model'
  ),
  'embedding artifact claim and effective model provenance columns exist'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where connamespace = 'rag_lab'::regnamespace
      and conrelid = 'rag_lab.chunk_runs'::regclass
      and conname = 'uq_chunk_runs_artifact_identity'
      and contype = 'u'
  ),
  'chunk artifact identity unique constraint exists'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where connamespace = 'rag_lab'::regnamespace
      and conrelid = 'rag_lab.embedding_runs'::regclass
      and conname = 'uq_embedding_runs_artifact_identity'
      and contype = 'u'
  ),
  'embedding artifact identity unique constraint exists'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'rag_lab'
      and table_name = 'experiment_runs'
      and column_name = 'experiment_fingerprint'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'rag_lab'
      and table_name = 'experiment_runs'
      and column_name = 'identity_claimed'
  ),
  'experiment exact identity columns exist'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'rag_lab'
      and indexname = 'uq_experiment_runs_active_identity'
      and indexdef like '%WHERE%identity_claimed%'
  )
  and exists (
    select 1
    from pg_indexes
    where schemaname = 'rag_lab'
      and indexname = 'ix_experiment_runs_experiment_fingerprint'
  ),
  'experiment identity indexes exist'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where connamespace = 'rag_lab'::regnamespace
      and conrelid = 'rag_lab.experiment_runs'::regclass
      and conname = 'ck_experiment_runs_identity_claim'
      and contype = 'c'
  ),
  'experiment identity claim only permits queued/running rows'
);

select ok(
  (select count(*) from information_schema.columns
   where table_schema = 'rag_lab'
     and table_name in ('chunk_runs', 'embedding_runs', 'experiment_runs', 'evaluation_runs')
     and column_name in ('lease_token', 'lease_expires_at')) = 8
  and exists (select 1 from information_schema.columns where table_schema = 'rag_lab' and table_name = 'experiment_runs' and column_name = 'dispatch_id')
  and exists (select 1 from information_schema.columns where table_schema = 'rag_lab' and table_name = 'evaluation_runs' and column_name = 'worker_started_at'),
  'durable worker lease and dispatch columns exist'
);

select ok(
  exists (select 1 from information_schema.check_constraints where constraint_schema = 'rag_lab' and constraint_name = 'ck_experiment_runs_lease_pair')
  and exists (select 1 from information_schema.check_constraints where constraint_schema = 'rag_lab' and constraint_name = 'ck_evaluation_runs_lease_pair')
  and exists (select 1 from information_schema.check_constraints where constraint_schema = 'rag_lab' and constraint_name = 'ck_chunk_runs_lease_pair')
  and exists (select 1 from information_schema.check_constraints where constraint_schema = 'rag_lab' and constraint_name = 'ck_embedding_runs_lease_pair'),
  'lease token and expiry are atomically paired'
);

select ok(
  exists (
    select 1
    from information_schema.check_constraints
    where constraint_schema = 'rag_lab'
      and constraint_name = 'ck_chunk_runs_identity_claim'
  )
  and exists (
    select 1
    from information_schema.check_constraints
    where constraint_schema = 'rag_lab'
      and constraint_name = 'ck_embedding_runs_identity_claim'
  ),
  'artifact identity claims are restricted to active statuses'
);

select ok(to_regclass('rag_lab.ix_documents_active_parse_run_id') is not null, 'active parse FK index exists');
select ok(to_regclass('rag_lab.ix_documents_active_chunk_run_id') is not null, 'active chunk FK index exists');
select ok(to_regclass('rag_lab.ix_documents_active_embedding_run_id') is not null, 'active embedding FK index exists');

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'rag_lab'
      and table_name = 'documents'
      and column_name = 'owner_user_id'
      and data_type = 'uuid'
      and is_nullable = 'NO'
  ),
  'documents have a non-null UUID owner'
);

select ok(
  exists (
    select 1
    from information_schema.table_constraints
    where constraint_schema = 'rag_lab'
      and table_name = 'documents'
      and constraint_name = 'fk_documents_owner_user'
      and constraint_type = 'FOREIGN KEY'
  ),
  'documents owner references auth users'
);

select ok(to_regclass('rag_lab.ix_documents_owner_user_id') is not null, 'owner lookup index exists');

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'rag_lab'
      and table_name = 'documents'
      and column_name = 'is_canonical'
  )
  and exists (
    select 1
    from pg_indexes
    where schemaname = 'rag_lab'
      and indexname = 'uq_documents_owner_sha256'
      and indexdef like '%UNIQUE INDEX%'
      and indexdef not like '%is_canonical%'
  ),
  'documents use direct owner and SHA256 uniqueness without canonical flags'
);

select ok(
  not (select relrowsecurity from pg_class where oid = 'rag_lab.documents'::regclass),
  'application schema remains private without misleading RLS'
);

select ok(
  exists (
    select 1
    from storage.buckets
    where id = 'rag-documents'
      and public = false
      and file_size_limit = 52428800
      and allowed_mime_types = array['application/pdf']::text[]
  ),
  'rag-documents bucket is private and PDF-only'
);

select ok(
  exists (select 1 from pg_roles where rolname = 'rag_steplab_app'),
  'runtime role exists'
);

select ok(has_schema_privilege('rag_steplab_app', 'rag_lab', 'USAGE'), 'runtime role can use rag_lab');
select ok(not has_schema_privilege('rag_steplab_app', 'rag_lab', 'CREATE'), 'runtime role cannot create in rag_lab');
select ok(not (select rolcreatedb from pg_roles where rolname = 'rag_steplab_app'), 'runtime role cannot create databases');
select ok(not (select rolcreaterole from pg_roles where rolname = 'rag_steplab_app'), 'runtime role cannot create roles');

select ok(
  has_table_privilege('rag_steplab_app', 'rag_lab.documents', 'SELECT')
  and has_table_privilege('rag_steplab_app', 'rag_lab.documents', 'INSERT')
  and has_table_privilege('rag_steplab_app', 'rag_lab.documents', 'UPDATE')
  and has_table_privilege('rag_steplab_app', 'rag_lab.documents', 'DELETE'),
  'runtime role has document DML access'
);

select ok(to_regclass('rag_lab.storage_cleanups') is not null, 'storage cleanup outbox table exists');

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'rag_lab' and table_name = 'storage_cleanups'
      and column_name = 'owner_user_id' and data_type = 'uuid' and is_nullable = 'NO'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'rag_lab' and table_name = 'storage_cleanups'
      and column_name = 'storage_path' and is_nullable = 'NO'
  ),
  'storage cleanup rows retain owner and private object path'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'rag_lab.storage_cleanups'::regclass
      and conname = 'storage_cleanups_status_check'
      and contype = 'c'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'rag_lab.storage_cleanups'::regclass
      and conname = 'storage_cleanups_attempt_nonnegative'
      and contype = 'c'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'rag_lab.storage_cleanups'::regclass
      and conname = 'storage_cleanups_storage_path_key'
      and contype = 'u'
  ),
  'storage cleanup state and idempotency constraints exist'
);

select ok(
  not exists (
    select 1 from pg_constraint
    where conrelid = 'rag_lab.storage_cleanups'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
  ),
  'cleanup outbox survives auth user deletion until storage retry completes'
);

select ok(
  not (select relrowsecurity from pg_class where oid = 'rag_lab.storage_cleanups'::regclass)
  and to_regclass('rag_lab.ix_storage_cleanups_owner_pending') is not null,
  'cleanup outbox is backend-private and indexed by owner pending state'
);

select ok(
  not has_table_privilege('anon', 'rag_lab.storage_cleanups', 'SELECT')
  and not has_table_privilege('authenticated', 'rag_lab.storage_cleanups', 'SELECT')
  and has_table_privilege('rag_steplab_app', 'rag_lab.storage_cleanups', 'SELECT')
  and has_table_privilege('rag_steplab_app', 'rag_lab.storage_cleanups', 'INSERT')
  and has_table_privilege('rag_steplab_app', 'rag_lab.storage_cleanups', 'UPDATE')
  and has_table_privilege('rag_steplab_app', 'rag_lab.storage_cleanups', 'DELETE'),
  'only the private runtime role can mutate cleanup outbox'
);

select ok(
  to_regclass('rag_lab.alembic_version') is null,
  'legacy Alembic state table is absent'
);

select ok(to_regclass('rag_lab.document_pipelines') is not null, 'document pipelines table exists');

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'rag_lab' and table_name = 'document_pipelines'
      and column_name = 'revision' and data_type = 'integer' and is_nullable = 'NO'
  ),
  'document pipelines have a required revision'
);

select is(
  (select count(*)::integer from pg_constraint
   where conrelid = 'rag_lab.document_pipelines'::regclass and contype = 'f'),
  5,
  'document pipelines use direct foreign keys to existing candidate keys'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'rag_lab' and indexname = 'uq_document_pipelines_document_name'
      and indexdef like '%UNIQUE INDEX%lower((name)::text)%'
  ),
  'pipeline names are case-insensitively unique per document'
);

select ok(
  has_table_privilege('rag_steplab_app', 'rag_lab.document_pipelines', 'SELECT')
  and has_table_privilege('rag_steplab_app', 'rag_lab.document_pipelines', 'INSERT')
  and has_table_privilege('rag_steplab_app', 'rag_lab.document_pipelines', 'UPDATE')
  and has_table_privilege('rag_steplab_app', 'rag_lab.document_pipelines', 'DELETE')
  and not has_table_privilege('authenticated', 'rag_lab.document_pipelines', 'SELECT'),
  'only the private runtime role can access document pipelines'
);

select ok(
  (select count(*) from information_schema.columns where table_schema = 'rag_lab' and column_name = 'run_number' and table_name in ('parse_runs', 'chunk_runs', 'embedding_runs')) = 3,
  'pipeline artifacts expose stable run numbers'
);

select ok(
  to_regclass('rag_lab.uq_parse_runs_document_run_number') is not null
  and to_regclass('rag_lab.uq_chunk_runs_document_run_number') is not null
  and to_regclass('rag_lab.uq_embedding_runs_document_run_number') is not null,
  'run numbers are unique per document and stage'
);

select ok(
  (select count(*) from information_schema.columns where table_schema = 'rag_lab' and table_name = 'documents' and column_name in ('parse_run_counter', 'chunk_run_counter', 'embedding_run_counter')) = 3,
  'document-owned counters prevent run number reuse after deletion'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'rag_lab.evaluation_runs'::regclass
      and conname = 'evaluation_runs_status_check'
      and pg_get_constraintdef(oid) like '%queued%'
  ),
  'evaluation runs allow durable queued lifecycle state'
);

select ok(
  (select count(*) from pg_constraint
    where conrelid = 'rag_lab.documents'::regclass
      and conname in ('fk_documents_active_parse_lineage', 'fk_documents_active_chunk_lineage', 'fk_documents_active_embedding_lineage')
      and contype = 'f') = 3,
  'document default pointers form one same-document lineage chain'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'rag_lab.documents'::regclass
      and conname = 'fk_documents_active_chunk_lineage'
      and pg_get_constraintdef(oid) like '%SET NULL (active_chunk_run_id)%'
  ),
  'deleting a default artifact clears only its pointer column'
);

select ok(
  (select count(*) from pg_constraint
    where conname in ('fk_chunk_runs_document_parse', 'fk_embedding_runs_document_chunk') and contype = 'f') = 2,
  'child artifacts must belong to their parent document'
);

select ok(
  exists (select 1 from pg_constraint where conrelid = 'rag_lab.documents'::regclass and conname = 'ck_documents_active_lineage_shape'),
  'a default descendant requires its default parent'
);

select * from finish();
rollback;
