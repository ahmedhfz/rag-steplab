begin;

do $$
begin
  if exists (select 1 from rag_lab.documents where owner_user_id is null) then
    raise exception using
      message = 'RAG StepLab documents still contain NULL owner_user_id values';
  end if;
end;
$$;

alter table rag_lab.documents
  alter column owner_user_id set not null;

create unique index if not exists uq_documents_owner_sha256_canonical
  on rag_lab.documents (owner_user_id, sha256)
  where is_canonical;

commit;
