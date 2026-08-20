"""Create the nine RAG StepLab persistence tables."""

from alembic import op

revision = "0001_rag_lab_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE rag_lab.documents (
            id varchar(36) PRIMARY KEY,
            file_name varchar(512) NOT NULL,
            media_type varchar(128) NOT NULL,
            size_bytes integer NOT NULL CHECK (size_bytes >= 0),
            page_count integer NOT NULL DEFAULT 0 CHECK (page_count >= 0),
            sha256 varchar(64) NOT NULL,
            storage_bucket varchar(255) NOT NULL,
            storage_path varchar(1024) NOT NULL UNIQUE,
            active_parse_run_id varchar(36),
            active_chunk_run_id varchar(36),
            active_embedding_run_id varchar(36),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_documents_sha256 ON rag_lab.documents (sha256)")
    op.execute(
        """
        CREATE TABLE rag_lab.parse_runs (
            id varchar(36) PRIMARY KEY,
            document_id varchar(36) NOT NULL REFERENCES rag_lab.documents(id) ON DELETE CASCADE,
            parser_name varchar(128) NOT NULL,
            parser_version varchar(128) NOT NULL,
            normalized_schema_version varchar(64) NOT NULL,
            structured jsonb NOT NULL,
            markdown text NOT NULL DEFAULT '',
            summary jsonb NOT NULL,
            status varchar(32) NOT NULL CHECK (status IN ('running','completed','failed','interrupted')),
            error_code varchar(128),
            error_message text,
            started_at timestamptz,
            completed_at timestamptz,
            duration_ms integer,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_parse_runs_document_id ON rag_lab.parse_runs (document_id)")
    op.execute(
        """
        CREATE TABLE rag_lab.chunk_runs (
            id varchar(36) PRIMARY KEY,
            document_id varchar(36) NOT NULL REFERENCES rag_lab.documents(id) ON DELETE CASCADE,
            parse_run_id varchar(36) NOT NULL REFERENCES rag_lab.parse_runs(id) ON DELETE RESTRICT,
            strategy varchar(64) NOT NULL CHECK (strategy IN ('fixed_token','recursive_token','structure_aware')),
            config jsonb NOT NULL,
            config_hash varchar(64) NOT NULL,
            tokenizer_version varchar(64) NOT NULL,
            chunker_version varchar(64) NOT NULL,
            status varchar(32) NOT NULL CHECK (status IN ('running','completed','failed','interrupted')),
            chunk_count integer NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
            error_code varchar(128),
            error_message text,
            started_at timestamptz,
            completed_at timestamptz,
            duration_ms integer,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_chunk_runs_document_id ON rag_lab.chunk_runs (document_id)")
    op.execute("CREATE INDEX ix_chunk_runs_parse_run_id ON rag_lab.chunk_runs (parse_run_id)")
    op.execute(
        """
        CREATE TABLE rag_lab.chunks (
            id varchar(36) PRIMARY KEY,
            document_id varchar(36) NOT NULL REFERENCES rag_lab.documents(id) ON DELETE CASCADE,
            chunk_run_id varchar(36) NOT NULL REFERENCES rag_lab.chunk_runs(id) ON DELETE CASCADE,
            ordinal integer NOT NULL CHECK (ordinal >= 0),
            text text NOT NULL,
            page_numbers jsonb NOT NULL DEFAULT '[]'::jsonb,
            source_element_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
            heading_path jsonb NOT NULL DEFAULT '[]'::jsonb,
            token_count integer NOT NULL CHECK (token_count >= 0),
            character_count integer NOT NULL CHECK (character_count >= 0),
            search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(text, ''))) STORED,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_chunks_run_ordinal UNIQUE (chunk_run_id, ordinal)
        )
        """
    )
    op.execute("CREATE INDEX ix_chunks_document_id ON rag_lab.chunks (document_id)")
    op.execute("CREATE INDEX ix_chunks_chunk_run_id ON rag_lab.chunks (chunk_run_id)")
    op.execute("CREATE INDEX ix_chunks_search_vector ON rag_lab.chunks USING gin (search_vector)")
    op.execute(
        """
        CREATE TABLE rag_lab.embedding_runs (
            id varchar(36) PRIMARY KEY,
            document_id varchar(36) NOT NULL REFERENCES rag_lab.documents(id) ON DELETE CASCADE,
            chunk_run_id varchar(36) NOT NULL REFERENCES rag_lab.chunk_runs(id) ON DELETE RESTRICT,
            model varchar(255) NOT NULL,
            dimensions integer NOT NULL CHECK (dimensions > 0),
            embedding_format_version varchar(128) NOT NULL,
            status varchar(32) NOT NULL CHECK (status IN ('running','completed','failed','interrupted')),
            embedding_count integer NOT NULL DEFAULT 0 CHECK (embedding_count >= 0),
            error_code varchar(128),
            error_message text,
            started_at timestamptz,
            completed_at timestamptz,
            duration_ms integer,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_embedding_runs_document_id ON rag_lab.embedding_runs (document_id)")
    op.execute("CREATE INDEX ix_embedding_runs_chunk_run_id ON rag_lab.embedding_runs (chunk_run_id)")
    op.execute(
        """
        CREATE TABLE rag_lab.chunk_embeddings (
            id varchar(36) PRIMARY KEY,
            embedding_run_id varchar(36) NOT NULL REFERENCES rag_lab.embedding_runs(id) ON DELETE CASCADE,
            chunk_id varchar(36) NOT NULL REFERENCES rag_lab.chunks(id) ON DELETE CASCADE,
            input_hash varchar(64) NOT NULL,
            embedding extensions.vector(768) NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_chunk_embeddings_run_chunk UNIQUE (embedding_run_id, chunk_id)
        )
        """
    )
    op.execute("CREATE INDEX ix_chunk_embeddings_embedding_run_id ON rag_lab.chunk_embeddings (embedding_run_id)")
    op.execute("CREATE INDEX ix_chunk_embeddings_chunk_id ON rag_lab.chunk_embeddings (chunk_id)")
    op.execute(
        """
        CREATE TABLE rag_lab.experiment_runs (
            id varchar(36) PRIMARY KEY,
            document_id varchar(36) NOT NULL REFERENCES rag_lab.documents(id) ON DELETE CASCADE,
            chunk_run_id varchar(36) NOT NULL REFERENCES rag_lab.chunk_runs(id) ON DELETE RESTRICT,
            embedding_run_id varchar(36) REFERENCES rag_lab.embedding_runs(id) ON DELETE RESTRICT,
            query text NOT NULL,
            target_stage varchar(32) NOT NULL CHECK (target_stage IN ('retrieval','reranking','context','generation')),
            config jsonb NOT NULL,
            stage_results jsonb NOT NULL,
            status varchar(32) NOT NULL CHECK (status IN ('running','completed','failed','interrupted')),
            error_code varchar(128),
            error_message text,
            started_at timestamptz,
            completed_at timestamptz,
            duration_ms integer,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_experiment_runs_document_id ON rag_lab.experiment_runs (document_id)")
    op.execute("CREATE INDEX ix_experiment_runs_chunk_run_id ON rag_lab.experiment_runs (chunk_run_id)")
    op.execute("CREATE INDEX ix_experiment_runs_embedding_run_id ON rag_lab.experiment_runs (embedding_run_id)")
    op.execute(
        """
        CREATE TABLE rag_lab.evaluation_datasets (
            id varchar(36) PRIMARY KEY,
            document_id varchar(36) NOT NULL REFERENCES rag_lab.documents(id) ON DELETE CASCADE,
            parse_run_id varchar(36) NOT NULL REFERENCES rag_lab.parse_runs(id) ON DELETE RESTRICT,
            name varchar(200) NOT NULL,
            version integer NOT NULL DEFAULT 1 CHECK (version > 0),
            cases jsonb NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_evaluation_datasets_document_id ON rag_lab.evaluation_datasets (document_id)")
    op.execute("CREATE INDEX ix_evaluation_datasets_parse_run_id ON rag_lab.evaluation_datasets (parse_run_id)")
    op.execute(
        """
        CREATE TABLE rag_lab.evaluation_runs (
            id varchar(36) PRIMARY KEY,
            dataset_id varchar(36) NOT NULL REFERENCES rag_lab.evaluation_datasets(id) ON DELETE CASCADE,
            config jsonb NOT NULL,
            child_experiment_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
            results jsonb NOT NULL DEFAULT '{}'::jsonb,
            status varchar(32) NOT NULL CHECK (status IN ('running','completed','failed','interrupted')),
            error_code varchar(128),
            error_message text,
            started_at timestamptz,
            completed_at timestamptz,
            duration_ms integer,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_evaluation_runs_dataset_id ON rag_lab.evaluation_runs (dataset_id)")
    op.execute(
        "ALTER TABLE rag_lab.documents ADD CONSTRAINT fk_documents_active_parse FOREIGN KEY (active_parse_run_id) REFERENCES rag_lab.parse_runs(id) ON DELETE SET NULL"
    )
    op.execute(
        "ALTER TABLE rag_lab.documents ADD CONSTRAINT fk_documents_active_chunk FOREIGN KEY (active_chunk_run_id) REFERENCES rag_lab.chunk_runs(id) ON DELETE SET NULL"
    )
    op.execute(
        "ALTER TABLE rag_lab.documents ADD CONSTRAINT fk_documents_active_embedding FOREIGN KEY (active_embedding_run_id) REFERENCES rag_lab.embedding_runs(id) ON DELETE SET NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE rag_lab.documents DROP CONSTRAINT IF EXISTS fk_documents_active_embedding")
    op.execute("ALTER TABLE rag_lab.documents DROP CONSTRAINT IF EXISTS fk_documents_active_chunk")
    op.execute("ALTER TABLE rag_lab.documents DROP CONSTRAINT IF EXISTS fk_documents_active_parse")
    op.execute("DROP TABLE IF EXISTS rag_lab.evaluation_runs")
    op.execute("DROP TABLE IF EXISTS rag_lab.evaluation_datasets")
    op.execute("DROP TABLE IF EXISTS rag_lab.experiment_runs")
    op.execute("DROP TABLE IF EXISTS rag_lab.chunk_embeddings")
    op.execute("DROP TABLE IF EXISTS rag_lab.embedding_runs")
    op.execute("DROP TABLE IF EXISTS rag_lab.chunks")
    op.execute("DROP TABLE IF EXISTS rag_lab.chunk_runs")
    op.execute("DROP TABLE IF EXISTS rag_lab.parse_runs")
    op.execute("DROP TABLE IF EXISTS rag_lab.documents")
