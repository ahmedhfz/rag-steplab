--
-- PostgreSQL database dump
--

-- Production schema baseline captured without data.
-- Existing production must mark this migration as applied via Supabase
-- migration repair; it must never execute this DDL against that database.
-- The historical alembic_version table is included in this baseline and is
-- removed only by the following canonical migration after runtime checks.

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: alembic_version; Type: TABLE; Schema: rag_lab; Owner: postgres
--

CREATE TABLE "rag_lab"."alembic_version" (
    "version_num" character varying(32) NOT NULL
);


ALTER TABLE "rag_lab"."alembic_version" OWNER TO "postgres";

--
-- Name: chunk_embeddings; Type: TABLE; Schema: rag_lab; Owner: postgres
--

CREATE TABLE "rag_lab"."chunk_embeddings" (
    "id" character varying(36) NOT NULL,
    "embedding_run_id" character varying(36) NOT NULL,
    "chunk_id" character varying(36) NOT NULL,
    "input_hash" character varying(64) NOT NULL,
    "embedding" "extensions"."vector"(768) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "rag_lab"."chunk_embeddings" OWNER TO "postgres";

--
-- Name: chunk_runs; Type: TABLE; Schema: rag_lab; Owner: postgres
--

CREATE TABLE "rag_lab"."chunk_runs" (
    "id" character varying(36) NOT NULL,
    "document_id" character varying(36) NOT NULL,
    "parse_run_id" character varying(36) NOT NULL,
    "strategy" character varying(64) NOT NULL,
    "config" "jsonb" NOT NULL,
    "config_hash" character varying(64) NOT NULL,
    "tokenizer_version" character varying(64) NOT NULL,
    "chunker_version" character varying(64) NOT NULL,
    "status" character varying(32) NOT NULL,
    "chunk_count" integer DEFAULT 0 NOT NULL,
    "error_code" character varying(128),
    "error_message" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "duration_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chunk_runs_chunk_count_check" CHECK (("chunk_count" >= 0)),
    CONSTRAINT "chunk_runs_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['running'::character varying, 'completed'::character varying, 'failed'::character varying, 'interrupted'::character varying])::"text"[]))),
    CONSTRAINT "chunk_runs_strategy_check" CHECK ((("strategy")::"text" = ANY ((ARRAY['fixed_token'::character varying, 'recursive_token'::character varying, 'structure_aware'::character varying])::"text"[])))
);


ALTER TABLE "rag_lab"."chunk_runs" OWNER TO "postgres";

--
-- Name: chunks; Type: TABLE; Schema: rag_lab; Owner: postgres
--

CREATE TABLE "rag_lab"."chunks" (
    "id" character varying(36) NOT NULL,
    "document_id" character varying(36) NOT NULL,
    "chunk_run_id" character varying(36) NOT NULL,
    "ordinal" integer NOT NULL,
    "text" "text" NOT NULL,
    "page_numbers" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "source_element_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "heading_path" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "token_count" integer NOT NULL,
    "character_count" integer NOT NULL,
    "search_vector" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"simple"'::"regconfig", COALESCE("text", ''::"text"))) STORED,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chunks_character_count_check" CHECK (("character_count" >= 0)),
    CONSTRAINT "chunks_ordinal_check" CHECK (("ordinal" >= 0)),
    CONSTRAINT "chunks_token_count_check" CHECK (("token_count" >= 0))
);


ALTER TABLE "rag_lab"."chunks" OWNER TO "postgres";

--
-- Name: documents; Type: TABLE; Schema: rag_lab; Owner: postgres
--

CREATE TABLE "rag_lab"."documents" (
    "id" character varying(36) NOT NULL,
    "file_name" character varying(512) NOT NULL,
    "media_type" character varying(128) NOT NULL,
    "size_bytes" integer NOT NULL,
    "page_count" integer DEFAULT 0 NOT NULL,
    "sha256" character varying(64) NOT NULL,
    "storage_bucket" character varying(255) NOT NULL,
    "storage_path" character varying(1024) NOT NULL,
    "active_parse_run_id" character varying(36),
    "active_chunk_run_id" character varying(36),
    "active_embedding_run_id" character varying(36),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "documents_page_count_check" CHECK (("page_count" >= 0)),
    CONSTRAINT "documents_size_bytes_check" CHECK (("size_bytes" >= 0))
);


ALTER TABLE "rag_lab"."documents" OWNER TO "postgres";

--
-- Name: embedding_runs; Type: TABLE; Schema: rag_lab; Owner: postgres
--

CREATE TABLE "rag_lab"."embedding_runs" (
    "id" character varying(36) NOT NULL,
    "document_id" character varying(36) NOT NULL,
    "chunk_run_id" character varying(36) NOT NULL,
    "model" character varying(255) NOT NULL,
    "dimensions" integer NOT NULL,
    "embedding_format_version" character varying(128) NOT NULL,
    "status" character varying(32) NOT NULL,
    "embedding_count" integer DEFAULT 0 NOT NULL,
    "error_code" character varying(128),
    "error_message" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "duration_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "embedding_runs_dimensions_check" CHECK (("dimensions" > 0)),
    CONSTRAINT "embedding_runs_embedding_count_check" CHECK (("embedding_count" >= 0)),
    CONSTRAINT "embedding_runs_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['running'::character varying, 'completed'::character varying, 'failed'::character varying, 'interrupted'::character varying])::"text"[])))
);


ALTER TABLE "rag_lab"."embedding_runs" OWNER TO "postgres";

--
-- Name: evaluation_datasets; Type: TABLE; Schema: rag_lab; Owner: postgres
--

CREATE TABLE "rag_lab"."evaluation_datasets" (
    "id" character varying(36) NOT NULL,
    "document_id" character varying(36) NOT NULL,
    "parse_run_id" character varying(36) NOT NULL,
    "name" character varying(200) NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "cases" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "evaluation_datasets_version_check" CHECK (("version" > 0))
);


ALTER TABLE "rag_lab"."evaluation_datasets" OWNER TO "postgres";

--
-- Name: evaluation_runs; Type: TABLE; Schema: rag_lab; Owner: postgres
--

CREATE TABLE "rag_lab"."evaluation_runs" (
    "id" character varying(36) NOT NULL,
    "dataset_id" character varying(36) NOT NULL,
    "config" "jsonb" NOT NULL,
    "child_experiment_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "results" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" character varying(32) NOT NULL,
    "error_code" character varying(128),
    "error_message" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "duration_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "evaluation_runs_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['running'::character varying, 'completed'::character varying, 'failed'::character varying, 'interrupted'::character varying])::"text"[])))
);


ALTER TABLE "rag_lab"."evaluation_runs" OWNER TO "postgres";

--
-- Name: experiment_runs; Type: TABLE; Schema: rag_lab; Owner: postgres
--

CREATE TABLE "rag_lab"."experiment_runs" (
    "id" character varying(36) NOT NULL,
    "document_id" character varying(36) NOT NULL,
    "chunk_run_id" character varying(36) NOT NULL,
    "embedding_run_id" character varying(36),
    "query" "text" NOT NULL,
    "target_stage" character varying(32) NOT NULL,
    "config" "jsonb" NOT NULL,
    "stage_results" "jsonb" NOT NULL,
    "status" character varying(32) NOT NULL,
    "error_code" character varying(128),
    "error_message" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "duration_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "experiment_runs_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['running'::character varying, 'completed'::character varying, 'failed'::character varying, 'interrupted'::character varying])::"text"[]))),
    CONSTRAINT "experiment_runs_target_stage_check" CHECK ((("target_stage")::"text" = ANY ((ARRAY['retrieval'::character varying, 'reranking'::character varying, 'context'::character varying, 'generation'::character varying])::"text"[])))
);


ALTER TABLE "rag_lab"."experiment_runs" OWNER TO "postgres";

--
-- Name: parse_runs; Type: TABLE; Schema: rag_lab; Owner: postgres
--

CREATE TABLE "rag_lab"."parse_runs" (
    "id" character varying(36) NOT NULL,
    "document_id" character varying(36) NOT NULL,
    "parser_name" character varying(128) NOT NULL,
    "parser_version" character varying(128) NOT NULL,
    "normalized_schema_version" character varying(64) NOT NULL,
    "structured" "jsonb",
    "markdown" "text" DEFAULT ''::"text" NOT NULL,
    "summary" "jsonb",
    "status" character varying(32) NOT NULL,
    "error_code" character varying(128),
    "error_message" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "duration_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "execution_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "dispatch_id" character varying(255),
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ck_parse_runs_status" CHECK ((("status")::"text" = ANY ((ARRAY['queued'::character varying, 'running'::character varying, 'completed'::character varying, 'failed'::character varying, 'interrupted'::character varying])::"text"[])))
);


ALTER TABLE "rag_lab"."parse_runs" OWNER TO "postgres";

--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."alembic_version"
    ADD CONSTRAINT "alembic_version_pkc" PRIMARY KEY ("version_num");


--
-- Name: chunk_embeddings chunk_embeddings_pkey; Type: CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."chunk_embeddings"
    ADD CONSTRAINT "chunk_embeddings_pkey" PRIMARY KEY ("id");


--
-- Name: chunk_runs chunk_runs_pkey; Type: CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."chunk_runs"
    ADD CONSTRAINT "chunk_runs_pkey" PRIMARY KEY ("id");


--
-- Name: chunks chunks_pkey; Type: CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."chunks"
    ADD CONSTRAINT "chunks_pkey" PRIMARY KEY ("id");


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");


--
-- Name: documents documents_storage_path_key; Type: CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."documents"
    ADD CONSTRAINT "documents_storage_path_key" UNIQUE ("storage_path");


--
-- Name: embedding_runs embedding_runs_pkey; Type: CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."embedding_runs"
    ADD CONSTRAINT "embedding_runs_pkey" PRIMARY KEY ("id");


--
-- Name: evaluation_datasets evaluation_datasets_pkey; Type: CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."evaluation_datasets"
    ADD CONSTRAINT "evaluation_datasets_pkey" PRIMARY KEY ("id");


--
-- Name: evaluation_runs evaluation_runs_pkey; Type: CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."evaluation_runs"
    ADD CONSTRAINT "evaluation_runs_pkey" PRIMARY KEY ("id");


--
-- Name: experiment_runs experiment_runs_pkey; Type: CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."experiment_runs"
    ADD CONSTRAINT "experiment_runs_pkey" PRIMARY KEY ("id");


--
-- Name: parse_runs parse_runs_pkey; Type: CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."parse_runs"
    ADD CONSTRAINT "parse_runs_pkey" PRIMARY KEY ("id");


--
-- Name: chunk_embeddings uq_chunk_embeddings_run_chunk; Type: CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."chunk_embeddings"
    ADD CONSTRAINT "uq_chunk_embeddings_run_chunk" UNIQUE ("embedding_run_id", "chunk_id");


--
-- Name: chunks uq_chunks_run_ordinal; Type: CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."chunks"
    ADD CONSTRAINT "uq_chunks_run_ordinal" UNIQUE ("chunk_run_id", "ordinal");


--
-- Name: ix_chunk_embeddings_chunk_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_chunk_embeddings_chunk_id" ON "rag_lab"."chunk_embeddings" USING "btree" ("chunk_id");


--
-- Name: ix_chunk_embeddings_embedding_run_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_chunk_embeddings_embedding_run_id" ON "rag_lab"."chunk_embeddings" USING "btree" ("embedding_run_id");


--
-- Name: ix_chunk_runs_document_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_chunk_runs_document_id" ON "rag_lab"."chunk_runs" USING "btree" ("document_id");


--
-- Name: ix_chunk_runs_parse_run_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_chunk_runs_parse_run_id" ON "rag_lab"."chunk_runs" USING "btree" ("parse_run_id");


--
-- Name: ix_chunks_chunk_run_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_chunks_chunk_run_id" ON "rag_lab"."chunks" USING "btree" ("chunk_run_id");


--
-- Name: ix_chunks_document_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_chunks_document_id" ON "rag_lab"."chunks" USING "btree" ("document_id");


--
-- Name: ix_chunks_search_vector; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_chunks_search_vector" ON "rag_lab"."chunks" USING "gin" ("search_vector");


--
-- Name: ix_documents_active_chunk_run_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_documents_active_chunk_run_id" ON "rag_lab"."documents" USING "btree" ("active_chunk_run_id");


--
-- Name: ix_documents_active_embedding_run_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_documents_active_embedding_run_id" ON "rag_lab"."documents" USING "btree" ("active_embedding_run_id");


--
-- Name: ix_documents_active_parse_run_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_documents_active_parse_run_id" ON "rag_lab"."documents" USING "btree" ("active_parse_run_id");


--
-- Name: ix_documents_sha256; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_documents_sha256" ON "rag_lab"."documents" USING "btree" ("sha256");


--
-- Name: ix_embedding_runs_chunk_run_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_embedding_runs_chunk_run_id" ON "rag_lab"."embedding_runs" USING "btree" ("chunk_run_id");


--
-- Name: ix_embedding_runs_document_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_embedding_runs_document_id" ON "rag_lab"."embedding_runs" USING "btree" ("document_id");


--
-- Name: ix_evaluation_datasets_document_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_evaluation_datasets_document_id" ON "rag_lab"."evaluation_datasets" USING "btree" ("document_id");


--
-- Name: ix_evaluation_datasets_parse_run_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_evaluation_datasets_parse_run_id" ON "rag_lab"."evaluation_datasets" USING "btree" ("parse_run_id");


--
-- Name: ix_evaluation_runs_dataset_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_evaluation_runs_dataset_id" ON "rag_lab"."evaluation_runs" USING "btree" ("dataset_id");


--
-- Name: ix_experiment_runs_chunk_run_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_experiment_runs_chunk_run_id" ON "rag_lab"."experiment_runs" USING "btree" ("chunk_run_id");


--
-- Name: ix_experiment_runs_document_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_experiment_runs_document_id" ON "rag_lab"."experiment_runs" USING "btree" ("document_id");


--
-- Name: ix_experiment_runs_embedding_run_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_experiment_runs_embedding_run_id" ON "rag_lab"."experiment_runs" USING "btree" ("embedding_run_id");


--
-- Name: ix_parse_runs_document_id; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_parse_runs_document_id" ON "rag_lab"."parse_runs" USING "btree" ("document_id");


--
-- Name: ix_parse_runs_status; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE INDEX "ix_parse_runs_status" ON "rag_lab"."parse_runs" USING "btree" ("status");


--
-- Name: uq_parse_runs_document_inflight; Type: INDEX; Schema: rag_lab; Owner: postgres
--

CREATE UNIQUE INDEX "uq_parse_runs_document_inflight" ON "rag_lab"."parse_runs" USING "btree" ("document_id") WHERE (("status")::"text" = ANY ((ARRAY['queued'::character varying, 'running'::character varying])::"text"[]));


--
-- Name: chunk_embeddings chunk_embeddings_chunk_id_fkey; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."chunk_embeddings"
    ADD CONSTRAINT "chunk_embeddings_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "rag_lab"."chunks"("id") ON DELETE CASCADE;


--
-- Name: chunk_embeddings chunk_embeddings_embedding_run_id_fkey; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."chunk_embeddings"
    ADD CONSTRAINT "chunk_embeddings_embedding_run_id_fkey" FOREIGN KEY ("embedding_run_id") REFERENCES "rag_lab"."embedding_runs"("id") ON DELETE CASCADE;


--
-- Name: chunk_runs chunk_runs_document_id_fkey; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."chunk_runs"
    ADD CONSTRAINT "chunk_runs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "rag_lab"."documents"("id") ON DELETE CASCADE;


--
-- Name: chunk_runs chunk_runs_parse_run_id_fkey; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."chunk_runs"
    ADD CONSTRAINT "chunk_runs_parse_run_id_fkey" FOREIGN KEY ("parse_run_id") REFERENCES "rag_lab"."parse_runs"("id") ON DELETE RESTRICT;


--
-- Name: chunks chunks_chunk_run_id_fkey; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."chunks"
    ADD CONSTRAINT "chunks_chunk_run_id_fkey" FOREIGN KEY ("chunk_run_id") REFERENCES "rag_lab"."chunk_runs"("id") ON DELETE CASCADE;


--
-- Name: chunks chunks_document_id_fkey; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."chunks"
    ADD CONSTRAINT "chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "rag_lab"."documents"("id") ON DELETE CASCADE;


--
-- Name: embedding_runs embedding_runs_chunk_run_id_fkey; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."embedding_runs"
    ADD CONSTRAINT "embedding_runs_chunk_run_id_fkey" FOREIGN KEY ("chunk_run_id") REFERENCES "rag_lab"."chunk_runs"("id") ON DELETE RESTRICT;


--
-- Name: embedding_runs embedding_runs_document_id_fkey; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."embedding_runs"
    ADD CONSTRAINT "embedding_runs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "rag_lab"."documents"("id") ON DELETE CASCADE;


--
-- Name: evaluation_datasets evaluation_datasets_document_id_fkey; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."evaluation_datasets"
    ADD CONSTRAINT "evaluation_datasets_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "rag_lab"."documents"("id") ON DELETE CASCADE;


--
-- Name: evaluation_datasets evaluation_datasets_parse_run_id_fkey; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."evaluation_datasets"
    ADD CONSTRAINT "evaluation_datasets_parse_run_id_fkey" FOREIGN KEY ("parse_run_id") REFERENCES "rag_lab"."parse_runs"("id") ON DELETE RESTRICT;


--
-- Name: evaluation_runs evaluation_runs_dataset_id_fkey; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."evaluation_runs"
    ADD CONSTRAINT "evaluation_runs_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "rag_lab"."evaluation_datasets"("id") ON DELETE CASCADE;


--
-- Name: experiment_runs experiment_runs_chunk_run_id_fkey; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."experiment_runs"
    ADD CONSTRAINT "experiment_runs_chunk_run_id_fkey" FOREIGN KEY ("chunk_run_id") REFERENCES "rag_lab"."chunk_runs"("id") ON DELETE RESTRICT;


--
-- Name: experiment_runs experiment_runs_document_id_fkey; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."experiment_runs"
    ADD CONSTRAINT "experiment_runs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "rag_lab"."documents"("id") ON DELETE CASCADE;


--
-- Name: experiment_runs experiment_runs_embedding_run_id_fkey; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."experiment_runs"
    ADD CONSTRAINT "experiment_runs_embedding_run_id_fkey" FOREIGN KEY ("embedding_run_id") REFERENCES "rag_lab"."embedding_runs"("id") ON DELETE RESTRICT;


--
-- Name: documents fk_documents_active_chunk; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."documents"
    ADD CONSTRAINT "fk_documents_active_chunk" FOREIGN KEY ("active_chunk_run_id") REFERENCES "rag_lab"."chunk_runs"("id") ON DELETE SET NULL;


--
-- Name: documents fk_documents_active_embedding; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."documents"
    ADD CONSTRAINT "fk_documents_active_embedding" FOREIGN KEY ("active_embedding_run_id") REFERENCES "rag_lab"."embedding_runs"("id") ON DELETE SET NULL;


--
-- Name: documents fk_documents_active_parse; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."documents"
    ADD CONSTRAINT "fk_documents_active_parse" FOREIGN KEY ("active_parse_run_id") REFERENCES "rag_lab"."parse_runs"("id") ON DELETE SET NULL;


--
-- Name: parse_runs parse_runs_document_id_fkey; Type: FK CONSTRAINT; Schema: rag_lab; Owner: postgres
--

ALTER TABLE ONLY "rag_lab"."parse_runs"
    ADD CONSTRAINT "parse_runs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "rag_lab"."documents"("id") ON DELETE CASCADE;


--
-- Name: SCHEMA "rag_lab"; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA "rag_lab" TO "rag_steplab_app";


--
-- Name: TABLE "alembic_version"; Type: ACL; Schema: rag_lab; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "rag_lab"."alembic_version" TO "rag_steplab_app";


--
-- Name: TABLE "chunk_embeddings"; Type: ACL; Schema: rag_lab; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "rag_lab"."chunk_embeddings" TO "rag_steplab_app";


--
-- Name: TABLE "chunk_runs"; Type: ACL; Schema: rag_lab; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "rag_lab"."chunk_runs" TO "rag_steplab_app";


--
-- Name: TABLE "chunks"; Type: ACL; Schema: rag_lab; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "rag_lab"."chunks" TO "rag_steplab_app";


--
-- Name: TABLE "documents"; Type: ACL; Schema: rag_lab; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "rag_lab"."documents" TO "rag_steplab_app";


--
-- Name: TABLE "embedding_runs"; Type: ACL; Schema: rag_lab; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "rag_lab"."embedding_runs" TO "rag_steplab_app";


--
-- Name: TABLE "evaluation_datasets"; Type: ACL; Schema: rag_lab; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "rag_lab"."evaluation_datasets" TO "rag_steplab_app";


--
-- Name: TABLE "evaluation_runs"; Type: ACL; Schema: rag_lab; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "rag_lab"."evaluation_runs" TO "rag_steplab_app";


--
-- Name: TABLE "experiment_runs"; Type: ACL; Schema: rag_lab; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "rag_lab"."experiment_runs" TO "rag_steplab_app";


--
-- Name: TABLE "parse_runs"; Type: ACL; Schema: rag_lab; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "rag_lab"."parse_runs" TO "rag_steplab_app";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: rag_lab; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "rag_lab" GRANT SELECT,USAGE ON SEQUENCES TO "rag_steplab_app";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: rag_lab; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "rag_lab" GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO "rag_steplab_app";


--
-- PostgreSQL database dump complete
--
