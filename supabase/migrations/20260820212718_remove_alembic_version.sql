-- Alembic is no longer a runtime or deployment dependency.
-- The table only stores historical revision state and has no application
-- foreign keys or runtime readers. Keep the removal explicit and fail-fast.
DROP TABLE "rag_lab"."alembic_version";
