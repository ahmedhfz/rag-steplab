begin;

-- Phase 1 resets RAG data before this migration is applied. Refuse to change
-- the identity contract if a caller skipped that destructive-but-scoped step.
do $$
begin
  if exists (
    select 1
    from rag_lab.documents
    group by owner_user_id, sha256
    having count(*) > 1
  ) then
    raise exception 'rag_lab.documents still contains duplicate owner_user_id + sha256 rows; reset data before applying identity migration';
  end if;
end;
$$;

drop index if exists rag_lab.uq_documents_owner_sha256_canonical;
drop index if exists rag_lab.ix_documents_owner_user_sha256;

alter table rag_lab.documents
  drop column if exists is_canonical;

create unique index if not exists uq_documents_owner_sha256
  on rag_lab.documents (owner_user_id, sha256);

commit;
