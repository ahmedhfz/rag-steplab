create schema if not exists rag_lab;
create extension if not exists vector with schema extensions;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rag-documents', 'rag-documents', false, 52428800, array['application/pdf']::text[])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;;
