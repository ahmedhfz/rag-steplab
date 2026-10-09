-- Document-scoped lineage integrity.
--
-- The saved document pipeline is the canonical lineage; documents.active_*
-- are only a default. Until now nothing in the schema prevented a default
-- chunk of one parse from being paired with another parse (a race between a
-- late chunk/embedding completion and a reparse), nor a chunk/embedding row
-- from pointing at an artifact of another document.
--
-- Constraints are added NOT VALID: they are enforced for every new write
-- without a full-table validation scan under ACCESS EXCLUSIVE. Existing
-- default pointers that violate the rule are cleared first (they are only
-- defaults; saved pipelines are untouched). VALIDATE CONSTRAINT is left to a
-- follow-up migration after the hosted data has been checked.

set lock_timeout = '5s';

-- 1. Clear inconsistent default pointers (descendants first).
update rag_lab.documents d
set active_embedding_run_id = null
where d.active_embedding_run_id is not null
  and not exists (
    select 1
    from rag_lab.embedding_runs e
    where e.id = d.active_embedding_run_id
      and e.document_id = d.id
      and e.chunk_run_id is not distinct from d.active_chunk_run_id
  );

update rag_lab.documents d
set active_chunk_run_id = null,
    active_embedding_run_id = null
where d.active_chunk_run_id is not null
  and not exists (
    select 1
    from rag_lab.chunk_runs c
    where c.id = d.active_chunk_run_id
      and c.document_id = d.id
      and c.parse_run_id is not distinct from d.active_parse_run_id
  );

update rag_lab.documents d
set active_parse_run_id = null,
    active_chunk_run_id = null,
    active_embedding_run_id = null
where d.active_parse_run_id is not null
  and not exists (
    select 1
    from rag_lab.parse_runs p
    where p.id = d.active_parse_run_id
      and p.document_id = d.id
  );

-- 2. Composite keys that identify an artifact together with its document
--    and direct parent. They are unique because each includes the primary key.
create unique index if not exists uq_parse_runs_document_id_id
  on rag_lab.parse_runs (document_id, id);
create unique index if not exists uq_chunk_runs_document_id_id
  on rag_lab.chunk_runs (document_id, id);
create unique index if not exists uq_chunk_runs_document_parse_id
  on rag_lab.chunk_runs (document_id, parse_run_id, id);
create unique index if not exists uq_embedding_runs_document_chunk_id
  on rag_lab.embedding_runs (document_id, chunk_run_id, id);

alter table rag_lab.parse_runs
  add constraint uq_parse_runs_document_id_id unique using index uq_parse_runs_document_id_id;
alter table rag_lab.chunk_runs
  add constraint uq_chunk_runs_document_id_id unique using index uq_chunk_runs_document_id_id,
  add constraint uq_chunk_runs_document_parse_id unique using index uq_chunk_runs_document_parse_id;
alter table rag_lab.embedding_runs
  add constraint uq_embedding_runs_document_chunk_id unique using index uq_embedding_runs_document_chunk_id;

-- 3. Cross-document lineage: a child artifact belongs to its parent's document.
alter table rag_lab.chunk_runs
  add constraint fk_chunk_runs_document_parse
  foreign key (document_id, parse_run_id)
  references rag_lab.parse_runs (document_id, id)
  not valid;

alter table rag_lab.embedding_runs
  add constraint fk_embedding_runs_document_chunk
  foreign key (document_id, chunk_run_id)
  references rag_lab.chunk_runs (document_id, id)
  not valid;

-- 4. Default pointers form one same-document chain. MATCH SIMPLE leaves a
--    NULL descendant unconstrained; deleting a referenced run clears only the
--    pointer column, never documents.id.
alter table rag_lab.documents
  add constraint ck_documents_active_lineage_shape
  check (
    (active_chunk_run_id is null or active_parse_run_id is not null)
    and (active_embedding_run_id is null or active_chunk_run_id is not null)
  )
  not valid,
  add constraint fk_documents_active_parse_lineage
  foreign key (id, active_parse_run_id)
  references rag_lab.parse_runs (document_id, id)
  on delete set null (active_parse_run_id)
  not valid,
  add constraint fk_documents_active_chunk_lineage
  foreign key (id, active_parse_run_id, active_chunk_run_id)
  references rag_lab.chunk_runs (document_id, parse_run_id, id)
  on delete set null (active_chunk_run_id)
  not valid,
  add constraint fk_documents_active_embedding_lineage
  foreign key (id, active_chunk_run_id, active_embedding_run_id)
  references rag_lab.embedding_runs (document_id, chunk_run_id, id)
  on delete set null (active_embedding_run_id)
  not valid;
