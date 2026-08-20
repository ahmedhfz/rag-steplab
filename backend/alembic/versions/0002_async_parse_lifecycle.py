"""Add durable asynchronous parse lifecycle state and worker metadata."""

from alembic import op


revision = "0002_async_parse_lifecycle"
down_revision = "0001_rag_lab_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing completed rows remain valid. Queue rows are created before a
    # worker has produced structured content, so those payload columns must be
    # nullable during the run lifecycle.
    op.execute("ALTER TABLE rag_lab.parse_runs ALTER COLUMN structured DROP NOT NULL")
    op.execute("ALTER TABLE rag_lab.parse_runs ALTER COLUMN summary DROP NOT NULL")
    op.execute("ALTER TABLE rag_lab.parse_runs DROP CONSTRAINT IF EXISTS parse_runs_status_check")
    op.execute("ALTER TABLE rag_lab.parse_runs DROP CONSTRAINT IF EXISTS ck_parse_runs_status")
    op.execute(
        "ALTER TABLE rag_lab.parse_runs ADD CONSTRAINT ck_parse_runs_status "
        "CHECK (status IN ('queued','running','completed','failed','interrupted'))"
    )
    op.execute(
        "ALTER TABLE rag_lab.parse_runs ADD COLUMN execution_metadata jsonb NOT NULL "
        "DEFAULT '{}'::jsonb"
    )
    op.execute("ALTER TABLE rag_lab.parse_runs ADD COLUMN dispatch_id varchar(255)")
    op.execute(
        "ALTER TABLE rag_lab.parse_runs ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now()"
    )
    op.execute("CREATE INDEX ix_parse_runs_status ON rag_lab.parse_runs (status)")
    # This is the database-level duplicate guard. The repository also checks
    # first to return a useful API error instead of leaking an IntegrityError.
    op.execute(
        "CREATE UNIQUE INDEX uq_parse_runs_document_inflight "
        "ON rag_lab.parse_runs (document_id) WHERE status IN ('queued','running')"
    )


def downgrade() -> None:
    # Do not leave rows that violate the old schema behind during rollback.
    op.execute(
        "UPDATE rag_lab.parse_runs SET status = 'failed', "
        "error_code = COALESCE(error_code, 'parse_interrupted'), "
        "error_message = COALESCE(error_message, 'The parse run did not complete.') "
        "WHERE status IN ('queued','running')"
    )
    op.execute(
        "UPDATE rag_lab.parse_runs SET "
        "structured = COALESCE(structured, '{}'::jsonb), "
        "summary = COALESCE(summary, '{}'::jsonb) "
        "WHERE structured IS NULL OR summary IS NULL"
    )
    op.execute("DROP INDEX IF EXISTS rag_lab.uq_parse_runs_document_inflight")
    op.execute("DROP INDEX IF EXISTS rag_lab.ix_parse_runs_status")
    op.execute("ALTER TABLE rag_lab.parse_runs DROP COLUMN IF EXISTS updated_at")
    op.execute("ALTER TABLE rag_lab.parse_runs DROP COLUMN IF EXISTS dispatch_id")
    op.execute("ALTER TABLE rag_lab.parse_runs DROP COLUMN IF EXISTS execution_metadata")
    op.execute("ALTER TABLE rag_lab.parse_runs DROP CONSTRAINT IF EXISTS ck_parse_runs_status")
    op.execute(
        "ALTER TABLE rag_lab.parse_runs ADD CONSTRAINT parse_runs_status_check "
        "CHECK (status IN ('running','completed','failed','interrupted'))"
    )
    op.execute("ALTER TABLE rag_lab.parse_runs ALTER COLUMN structured SET NOT NULL")
    op.execute("ALTER TABLE rag_lab.parse_runs ALTER COLUMN summary SET NOT NULL")
