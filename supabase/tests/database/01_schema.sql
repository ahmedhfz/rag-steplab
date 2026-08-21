begin;

select plan(32);

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
  'documents have a required UUID owner'
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
  exists (
    select 1
    from pg_indexes
    where schemaname = 'rag_lab'
      and indexname = 'uq_documents_owner_sha256_canonical'
      and indexdef like '%UNIQUE INDEX%'
      and indexdef like '%is_canonical%'
  ),
  'canonical documents are unique per owner and SHA256'
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

select ok(
  to_regclass('rag_lab.alembic_version') is null,
  'legacy Alembic state table is absent'
);

select * from finish();
rollback;
