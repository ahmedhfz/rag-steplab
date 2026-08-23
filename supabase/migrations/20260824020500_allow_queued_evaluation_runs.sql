-- Async evaluation creates a durable queued row before its worker starts.
-- Keep the database lifecycle contract aligned with the API and UI polling states.
alter table rag_lab.evaluation_runs
  drop constraint if exists evaluation_runs_status_check;

alter table rag_lab.evaluation_runs
  add constraint evaluation_runs_status_check
  check (status = any (array['queued', 'running', 'completed', 'failed', 'interrupted']::varchar[]));
