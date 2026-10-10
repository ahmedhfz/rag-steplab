begin;

-- Fresh migration zinciri production rag_lab gösterimini üretmeli; aksi halde
-- release.yml'deki read-only schema drift adımı release'i durdurur.
-- Beklenen metinler production katalog gösterimidir
-- (20261009120000_reconcile_production_schema_drift.sql).

select plan(12);

select is(
  (select array_agg(conname::text order by conname)
     from pg_constraint
    where conrelid = 'rag_lab.document_pipelines'::regclass and contype = 'f'),
  array[
    'document_pipelines_chunk_run_id_fkey',
    'document_pipelines_document_id_fkey',
    'document_pipelines_embedding_run_id_fkey',
    'document_pipelines_parse_run_id_fkey',
    'fk_document_pipelines_owner_user'
  ],
  'document pipeline foreign keys use the production names'
);

select is(
  (select array_agg(format('%s %s', conname, confdeltype) order by conname)
     from pg_constraint
    where conrelid = 'rag_lab.document_pipelines'::regclass and contype = 'f'),
  array[
    'document_pipelines_chunk_run_id_fkey r',
    'document_pipelines_document_id_fkey c',
    'document_pipelines_embedding_run_id_fkey r',
    'document_pipelines_parse_run_id_fkey r',
    'fk_document_pipelines_owner_user c'
  ],
  'document pipeline lineage keys restrict deletes; document and owner cascade'
);

select is(
  (select array_agg(format('%s %s', attname, format_type(atttypid, atttypmod)) order by attnum)
     from pg_attribute
    where attrelid = 'rag_lab.document_pipelines'::regclass
      and attname in ('id', 'document_id', 'parse_run_id', 'chunk_run_id', 'embedding_run_id')),
  array[
    'id character varying',
    'document_id character varying',
    'parse_run_id character varying',
    'chunk_run_id character varying',
    'embedding_run_id character varying'
  ],
  'document pipeline id columns match the production types'
);

select is(
  (select array_agg(pg_get_indexdef(i.indexrelid, k, true) order by k)
     from pg_index i
     cross join generate_series(1, i.indnatts) as k
    where i.indexrelid = to_regclass('rag_lab.ix_document_pipelines_owner_document')
      and i.indrelid = 'rag_lab.document_pipelines'::regclass
      and not i.indisunique
      and i.indpred is null),
  array['owner_user_id', 'document_id'],
  'document pipelines have the production owner/document index'
);

select is(
  (select pg_get_expr(indpred, indrelid) from pg_index
    where indexrelid = 'rag_lab.uq_parse_runs_document_inflight'::regclass and indisunique),
  $$((status)::text = ANY ((ARRAY['queued'::character varying, 'running'::character varying])::text[]))$$,
  'parse inflight unique index predicate matches production'
);

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'rag_lab.chunk_runs'::regclass and conname = 'chunk_runs_status_check' and convalidated),
  $$CHECK (((status)::text = ANY ((ARRAY['running'::character varying, 'completed'::character varying, 'failed'::character varying, 'interrupted'::character varying])::text[])))$$,
  'chunk_runs_status_check matches production'
);

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'rag_lab.chunk_runs'::regclass and conname = 'chunk_runs_strategy_check' and convalidated),
  $$CHECK (((strategy)::text = ANY ((ARRAY['fixed_token'::character varying, 'recursive_token'::character varying, 'structure_aware'::character varying])::text[])))$$,
  'chunk_runs_strategy_check matches production'
);

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'rag_lab.embedding_runs'::regclass and conname = 'embedding_runs_status_check' and convalidated),
  $$CHECK (((status)::text = ANY ((ARRAY['running'::character varying, 'completed'::character varying, 'failed'::character varying, 'interrupted'::character varying])::text[])))$$,
  'embedding_runs_status_check matches production'
);

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'rag_lab.experiment_runs'::regclass and conname = 'experiment_runs_target_stage_check' and convalidated),
  $$CHECK (((target_stage)::text = ANY ((ARRAY['retrieval'::character varying, 'reranking'::character varying, 'context'::character varying, 'generation'::character varying])::text[])))$$,
  'experiment_runs_target_stage_check matches production'
);

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'rag_lab.parse_runs'::regclass and conname = 'ck_parse_runs_status' and convalidated),
  $$CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'running'::character varying, 'completed'::character varying, 'failed'::character varying, 'interrupted'::character varying])::text[])))$$,
  'ck_parse_runs_status matches production'
);

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'rag_lab.document_pipelines'::regclass and conname = 'ck_document_pipelines_name' and convalidated),
  $$CHECK ((((char_length((name)::text) >= 1) AND (char_length((name)::text) <= 100)) AND ((name)::text = btrim((name)::text))))$$,
  'ck_document_pipelines_name matches production'
);

select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'rag_lab.document_pipelines'::regclass and conname = 'ck_document_pipelines_revision' and convalidated),
  'CHECK ((revision >= 1))',
  'ck_document_pipelines_revision matches production'
);

select * from finish();
rollback;
