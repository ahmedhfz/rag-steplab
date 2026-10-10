-- Production `rag_lab` şeması, 20260823121229 taslağının release akışı dışında
-- uygulanması ve ORM kökenli ifade biçimleri yüzünden migration'ların temiz bir
-- veritabanında ürettiği şemadan bazı noktalarda ayrışmıştır. Release'teki
-- `supabase db diff --linked --schema rag_lab` kontrolü bu farkları drift olarak
-- raporlar.
--
-- Bu migration temiz kurulan veritabanlarını production'ın mevcut haline hizalar.
-- Her adım koşulludur: production'da (şema zaten bu haldeyken) hiçbir DDL
-- çalıştırmaz. Anlamsal davranış değişmez; yalnız constraint adları, kolon tip
-- uzunlukları ve CHECK/index ifade biçimleri production ile birebir eşitlenir.

begin;

set local lock_timeout = '5s';

-- 1) document_pipelines FK adları production'daki varsayılan adlarla aynı olsun.
do $$
declare
  r record;
begin
  for r in
    select *
      from (values
        ('fk_document_pipelines_document', 'document_pipelines_document_id_fkey'),
        ('fk_document_pipelines_parse', 'document_pipelines_parse_run_id_fkey'),
        ('fk_document_pipelines_chunk', 'document_pipelines_chunk_run_id_fkey'),
        ('fk_document_pipelines_embedding', 'document_pipelines_embedding_run_id_fkey')
      ) as v(old_name, new_name)
  loop
    if exists (
      select 1 from pg_constraint
       where conrelid = 'rag_lab.document_pipelines'::regclass and conname = r.old_name
    ) and not exists (
      select 1 from pg_constraint
       where conrelid = 'rag_lab.document_pipelines'::regclass and conname = r.new_name
    ) then
      execute format(
        'alter table rag_lab.document_pipelines rename constraint %I to %I',
        r.old_name,
        r.new_name
      );
    end if;
  end loop;
end;
$$;

-- 2) document_pipelines kimlik kolonları production'da uzunluk sınırsız varchar.
--    varchar(n) -> varchar dönüşümü tabloyu yeniden yazmaz. Lineage trigger'ı
--    `UPDATE OF` listesiyle bu kolonlara bağlı olduğu için aynı tanımla yeniden
--    kurulur.
do $$
declare
  column_name text;
begin
  if exists (
    select 1 from pg_attribute
     where attrelid = 'rag_lab.document_pipelines'::regclass
       and attname in ('id', 'document_id', 'parse_run_id', 'chunk_run_id', 'embedding_run_id')
       and atttypmod <> -1
  ) then
    drop trigger if exists trg_document_pipelines_validate_lineage
      on rag_lab.document_pipelines;

    foreach column_name in array array['id', 'document_id', 'parse_run_id', 'chunk_run_id', 'embedding_run_id']
    loop
      execute format(
        'alter table rag_lab.document_pipelines alter column %I type varchar',
        column_name
      );
    end loop;

    create trigger trg_document_pipelines_validate_lineage
    before insert or update of owner_user_id, document_id, parse_run_id, chunk_run_id, embedding_run_id
    on rag_lab.document_pipelines
    for each row execute function rag_lab.validate_document_pipeline_lineage();
  end if;
end;
$$;

-- 3) CHECK constraint'leri production'daki ifade biçimiyle yeniden kur. PG
--    ifadeyi normalize ederek sakladığı için karşılaştırma production'ın birebir
--    deparse metniyle yapılır; tanım zaten aynıysa (production) dokunulmaz.
do $$
declare
  r record;
begin
  for r in
    select *
      from (values
        (
          'rag_lab.chunk_runs', 'chunk_runs_status_check',
          $c$status in ('running', 'completed', 'failed', 'interrupted')$c$,
          $d$CHECK (((status)::text = ANY ((ARRAY['running'::character varying, 'completed'::character varying, 'failed'::character varying, 'interrupted'::character varying])::text[])))$d$
        ),
        (
          'rag_lab.chunk_runs', 'chunk_runs_strategy_check',
          $c$strategy in ('fixed_token', 'recursive_token', 'structure_aware')$c$,
          $d$CHECK (((strategy)::text = ANY ((ARRAY['fixed_token'::character varying, 'recursive_token'::character varying, 'structure_aware'::character varying])::text[])))$d$
        ),
        (
          'rag_lab.embedding_runs', 'embedding_runs_status_check',
          $c$status in ('running', 'completed', 'failed', 'interrupted')$c$,
          $d$CHECK (((status)::text = ANY ((ARRAY['running'::character varying, 'completed'::character varying, 'failed'::character varying, 'interrupted'::character varying])::text[])))$d$
        ),
        (
          'rag_lab.experiment_runs', 'experiment_runs_target_stage_check',
          $c$target_stage in ('retrieval', 'reranking', 'context', 'generation')$c$,
          $d$CHECK (((target_stage)::text = ANY ((ARRAY['retrieval'::character varying, 'reranking'::character varying, 'context'::character varying, 'generation'::character varying])::text[])))$d$
        ),
        (
          'rag_lab.parse_runs', 'ck_parse_runs_status',
          $c$status in ('queued', 'running', 'completed', 'failed', 'interrupted')$c$,
          $d$CHECK (((status)::text = ANY ((ARRAY['queued'::character varying, 'running'::character varying, 'completed'::character varying, 'failed'::character varying, 'interrupted'::character varying])::text[])))$d$
        ),
        (
          'rag_lab.document_pipelines', 'ck_document_pipelines_name',
          $c$char_length(name) between 1 and 100 and name = btrim(name)$c$,
          $d$CHECK ((((char_length((name)::text) >= 1) AND (char_length((name)::text) <= 100)) AND ((name)::text = btrim((name)::text))))$d$
        ),
        (
          'rag_lab.document_pipelines', 'ck_document_pipelines_revision',
          $c$revision >= 1$c$,
          $d$CHECK ((revision >= 1))$d$
        )
      ) as v(table_name, constraint_name, check_expression, expected_definition)
  loop
    if (
      select pg_get_constraintdef(oid)
        from pg_constraint
       where conrelid = r.table_name::regclass and conname = r.constraint_name
    ) is distinct from r.expected_definition then
      execute format(
        'alter table %s drop constraint if exists %I',
        r.table_name,
        r.constraint_name
      );
      execute format(
        'alter table %s add constraint %I check (%s)',
        r.table_name,
        r.constraint_name,
        r.check_expression
      );
    end if;
  end loop;
end;
$$;

-- 4) Eşzamanlı parse kısıtını koruyan unique index'i production biçimine hizala.
do $$
begin
  if (
    select indexdef from pg_indexes
     where schemaname = 'rag_lab' and indexname = 'uq_parse_runs_document_inflight'
  ) is distinct from
    $i$CREATE UNIQUE INDEX uq_parse_runs_document_inflight ON rag_lab.parse_runs USING btree (document_id) WHERE ((status)::text = ANY ((ARRAY['queued'::character varying, 'running'::character varying])::text[]))$i$
  then
    drop index if exists rag_lab.uq_parse_runs_document_inflight;
    create unique index uq_parse_runs_document_inflight
      on rag_lab.parse_runs (document_id)
      where status in ('queued', 'running');
  end if;
end;
$$;

-- 5) Production'da bulunan owner/document sorgu index'i.
create index if not exists ix_document_pipelines_owner_document
  on rag_lab.document_pipelines (owner_user_id, document_id);

commit;
