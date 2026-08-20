CREATE INDEX IF NOT EXISTS ix_documents_active_parse_run_id ON rag_lab.documents (active_parse_run_id);
CREATE INDEX IF NOT EXISTS ix_documents_active_chunk_run_id ON rag_lab.documents (active_chunk_run_id);
CREATE INDEX IF NOT EXISTS ix_documents_active_embedding_run_id ON rag_lab.documents (active_embedding_run_id);;
