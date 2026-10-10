-- Production rag_lab şeması ile supabase/migrations'ın kurduğu şema arasındaki
-- drift'i kapatır (release.yml "schema drift" adımı, Actions run 38035135501).
-- Hedef, production'daki mevcut durumdur; bu migration production'da no-op'tur.
--
-- Kök nedenler:
-- 1. document_pipelines production'a 20260823121229'un erken bir taslağıyla
--    kuruldu (inline `references` ile varsayılan *_fkey adları, uzunluksuz
--    varchar id kolonları, `between ... and name = btrim(name)` ve
--    `revision >= 1` yazımı, (owner_user_id, document_id) index'i).
--    20260823125355 yalnız owner FK'sını, lineage check adını ve name index
--    adını hizaladı; kalan farklar burada fresh DB tarafında production'a
--    eşitlenir. Hepsi anlamca eşdeğerdir; production'daki satırlar ve
--    kilitler etkilenmez.
-- 2. Baseline'daki IN-listesi CHECK'leri ve uq_parse_runs_document_inflight
--    production'da `x IN (...)` kaynağından oluşturuldu. pg_dump çıktısı
--    yeniden parse edildiğinde PostgreSQL `(ARRAY[...])::text[]` cast'ini
--    elemanlara dağıtır: anlam aynı, katalog gösterimi farklı. Kaynak
--    IN-listesiyle yeniden oluşturmak production gösterimini verir.
--
-- Her DDL katalog kontrolüyle korunur. Beklenen CHECK/predicate gösterimi aynı
-- sunucuda geçici bir probe tablosunda üretilir; karşılaştırma sürüm veya
-- oturum ayarından etkilenmez. Gösterimi zaten eşit olan bir nesneye (production)
-- dokunulmaz: tablo kilidi, rewrite veya validation taraması olmaz.

begin;

set local lock_timeout = '5s';

-- 1. document_pipelines FK adları: production'daki varsayılan *_fkey adları.
--    ON DELETE davranışları iki tarafta da aynıdır (document CASCADE, run'lar
--    RESTRICT); yalnız ad değişir, doğrulama taraması yapılmaz.
do $$
declare
  fk record;
begin
  for fk in
    select *
    from (values
      ('fk_document_pipelines_document', 'document_pipelines_document_id_fkey'),
      ('fk_document_pipelines_parse', 'document_pipelines_parse_run_id_fkey'),
      ('fk_document_pipelines_chunk', 'document_pipelines_chunk_run_id_fkey'),
      ('fk_document_pipelines_embedding', 'document_pipelines_embedding_run_id_fkey')
    ) as t(old_name, new_name)
  loop
    if exists (
      select 1 from pg_constraint
      where conrelid = 'rag_lab.document_pipelines'::regclass
        and conname = fk.old_name and contype = 'f'
    ) and not exists (
      select 1 from pg_constraint
      where conrelid = 'rag_lab.document_pipelines'::regclass
        and conname = fk.new_name
    ) then
      execute format(
        'alter table rag_lab.document_pipelines rename constraint %I to %I',
        fk.old_name, fk.new_name
      );
    end if;
  end loop;
end;
$$;

-- 2. document_pipelines id/lineage kolonları production'da uzunluksuz varchar.
--    varchar(36) -> varchar binary-coercible'dır: rewrite veya index rebuild
--    olmaz. Kolon listeli trigger kolon tipi değişimini engellediği için
--    trigger aynı tanımla yeniden kurulur (yalnız değişiklik gerekiyorsa).
do $$
declare
  alterations text;
begin
  select string_agg(format('alter column %I type varchar', a.attname), ', ' order by a.attnum)
    into alterations
    from pg_attribute a
   where a.attrelid = 'rag_lab.document_pipelines'::regclass
     and a.attname in ('id', 'document_id', 'parse_run_id', 'chunk_run_id', 'embedding_run_id')
     and not a.attisdropped
     and a.atttypid = 'pg_catalog.varchar'::regtype
     and a.atttypmod <> -1;

  if alterations is not null then
    drop trigger if exists trg_document_pipelines_validate_lineage
      on rag_lab.document_pipelines;
    execute 'alter table rag_lab.document_pipelines ' || alterations;
    create trigger trg_document_pipelines_validate_lineage
    before insert or update of owner_user_id, document_id, parse_run_id, chunk_run_id, embedding_run_id
    on rag_lab.document_pipelines
    for each row execute function rag_lab.validate_document_pipeline_lineage();
  end if;
end;
$$;

-- 3. Production'daki (owner_user_id, document_id) index'i.
do $$
begin
  if to_regclass('rag_lab.ix_document_pipelines_owner_document') is null then
    create index ix_document_pipelines_owner_document
      on rag_lab.document_pipelines (owner_user_id, document_id);
  end if;
end;
$$;

-- 4. CHECK gösterimleri ve inflight partial unique index predicate'i.
do $$
declare
  item record;
  current_def text;
  expected_def text;
begin
  create temporary table rag_lab_drift_probe (
    document_id varchar,
    status varchar,
    strategy varchar,
    target_stage varchar,
    name varchar,
    revision integer
  ) on commit drop;

  for item in
    select *
    from (values
      ('rag_lab.chunk_runs', 'chunk_runs_status_check',
       $c$status in ('running', 'completed', 'failed', 'interrupted')$c$),
      ('rag_lab.chunk_runs', 'chunk_runs_strategy_check',
       $c$strategy in ('fixed_token', 'recursive_token', 'structure_aware')$c$),
      ('rag_lab.embedding_runs', 'embedding_runs_status_check',
       $c$status in ('running', 'completed', 'failed', 'interrupted')$c$),
      ('rag_lab.experiment_runs', 'experiment_runs_target_stage_check',
       $c$target_stage in ('retrieval', 'reranking', 'context', 'generation')$c$),
      ('rag_lab.parse_runs', 'ck_parse_runs_status',
       $c$status in ('queued', 'running', 'completed', 'failed', 'interrupted')$c$),
      ('rag_lab.document_pipelines', 'ck_document_pipelines_name',
       $c$char_length(name) between 1 and 100 and name = btrim(name)$c$),
      ('rag_lab.document_pipelines', 'ck_document_pipelines_revision',
       $c$revision >= 1$c$)
    ) as t(table_name, constraint_name, expression)
  loop
    execute format(
      'alter table pg_temp.rag_lab_drift_probe add constraint %I check (%s)',
      item.constraint_name, item.expression
    );
    select pg_get_constraintdef(oid)
      into expected_def
      from pg_constraint
     where conrelid = 'pg_temp.rag_lab_drift_probe'::regclass
       and conname = item.constraint_name;
    execute format(
      'alter table pg_temp.rag_lab_drift_probe drop constraint %I',
      item.constraint_name
    );

    current_def := null;
    select pg_get_constraintdef(oid)
      into current_def
      from pg_constraint
     where conrelid = item.table_name::regclass
       and conname = item.constraint_name
       and contype = 'c'
       and convalidated;

    if current_def is distinct from expected_def then
      execute format(
        'alter table %s drop constraint if exists %I, add constraint %I check (%s)',
        item.table_name, item.constraint_name, item.constraint_name, item.expression
      );
    end if;
  end loop;

  create index rag_lab_drift_probe_inflight
    on pg_temp.rag_lab_drift_probe (document_id)
    where status in ('queued', 'running');
  select pg_get_expr(i.indpred, i.indrelid)
    into expected_def
    from pg_index i
   where i.indexrelid = 'pg_temp.rag_lab_drift_probe_inflight'::regclass;

  current_def := null;
  select pg_get_expr(i.indpred, i.indrelid)
    into current_def
    from pg_index i
   where i.indexrelid = to_regclass('rag_lab.uq_parse_runs_document_inflight')
     and i.indrelid = 'rag_lab.parse_runs'::regclass
     and i.indisunique
     and i.indisvalid
     and i.indnatts = 1
     and pg_get_indexdef(i.indexrelid, 1, true) = 'document_id';

  if current_def is distinct from expected_def then
    drop index if exists rag_lab.uq_parse_runs_document_inflight;
    create unique index uq_parse_runs_document_inflight
      on rag_lab.parse_runs (document_id)
      where status in ('queued', 'running');
  end if;
end;
$$;

-- 5. Son durum doğrulaması: beklenmeyen bir şema durumunda sessizce devam
--    etmek yerine migration'ı durdurur.
do $$
begin
  if (
    select count(*)
    from pg_constraint c
    join lateral unnest(c.conkey) as k(attnum) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.conrelid = 'rag_lab.document_pipelines'::regclass
      and c.contype = 'f'
      and cardinality(c.conkey) = 1
      and (c.conname, a.attname, c.confrelid, c.confdeltype) in (
        ('fk_document_pipelines_owner_user', 'owner_user_id', 'auth.users'::regclass, 'c'),
        ('document_pipelines_document_id_fkey', 'document_id', 'rag_lab.documents'::regclass, 'c'),
        ('document_pipelines_parse_run_id_fkey', 'parse_run_id', 'rag_lab.parse_runs'::regclass, 'r'),
        ('document_pipelines_chunk_run_id_fkey', 'chunk_run_id', 'rag_lab.chunk_runs'::regclass, 'r'),
        ('document_pipelines_embedding_run_id_fkey', 'embedding_run_id', 'rag_lab.embedding_runs'::regclass, 'r')
      )
  ) <> 5 or (
    select count(*) from pg_constraint
    where conrelid = 'rag_lab.document_pipelines'::regclass and contype = 'f'
  ) <> 5 then
    raise exception 'document_pipelines foreign keys do not match the production shape';
  end if;

  if exists (
    select 1 from pg_attribute
    where attrelid = 'rag_lab.document_pipelines'::regclass
      and attname in ('id', 'document_id', 'parse_run_id', 'chunk_run_id', 'embedding_run_id')
      and format_type(atttypid, atttypmod) <> 'character varying'
  ) then
    raise exception 'document_pipelines id columns do not match the production shape';
  end if;

  if not exists (
    select 1 from pg_index
    where indexrelid = to_regclass('rag_lab.ix_document_pipelines_owner_document')
      and indrelid = 'rag_lab.document_pipelines'::regclass
      and not indisunique
      and indpred is null
      and pg_get_indexdef(indexrelid, 1, true) = 'owner_user_id'
      and pg_get_indexdef(indexrelid, 2, true) = 'document_id'
      and indnatts = 2
  ) then
    raise exception 'ix_document_pipelines_owner_document does not match the production shape';
  end if;
end;
$$;

commit;
