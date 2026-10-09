"""Dispatch boundary between FastAPI and the deployed Modal worker."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

from .config import Settings, get_settings

logger = logging.getLogger(__name__)


class ModalDispatchError(RuntimeError):
    """Raised when a parse cannot be handed to Modal."""


_local_parse_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="rag-local-parse")
_local_pipeline_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="rag-local-pipeline")


def dispatch_local_parse_run(parse_run_id: str) -> str:
    """Run the real Docling worker asynchronously for development-only memory mode."""

    def run_worker() -> None:
        from .pipeline import run_parse_worker

        run_parse_worker(parse_run_id, worker_name="local")

    try:
        _local_parse_executor.submit(run_worker)
    except RuntimeError as exc:  # executor is shutting down during process exit
        raise ModalDispatchError("The local parse worker could not be started.") from exc
    return f"local-{parse_run_id}"


def call_terminal_failure(dispatch_id: str) -> bool:
    """Return true only when Modal reports a durable terminal call failure.

    Poll timeouts, expired output retention, authentication, and connectivity
    errors are deliberately treated as unknown. They must not turn a healthy
    durable run into a false failure.
    """

    try:
        import modal
    except ImportError:  # pragma: no cover - API image includes Modal
        return False

    try:
        modal.FunctionCall.from_id(dispatch_id).get(timeout=0)
        return False
    except (TimeoutError, modal.exception.TimeoutError, modal.exception.OutputExpiredError):
        return False
    except (
        modal.exception.FunctionTimeoutError,
        modal.exception.InputCancellation,
        modal.exception.RemoteError,
        modal.exception.SandboxTerminatedError,
        modal.exception.UserCodeException,
    ):
        return True
    except Exception:
        # Transport/auth/SDK errors are "unknown", never a 500 on a poll.
        logger.warning("modal_call_status_unknown dispatch_id=%s", dispatch_id, exc_info=True)
        return False


# Backwards-compatible name used by the parse polling path.
parse_call_terminal_failure = call_terminal_failure


def dispatch_parse_run(parse_run_id: str, *, settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    if not settings.modal_dispatch_enabled:
        raise ModalDispatchError("Modal parse dispatch is disabled.")
    try:
        import modal
    except ImportError as exc:  # pragma: no cover - API image includes Modal
        raise ModalDispatchError("The Modal client is not installed.") from exc

    try:
        function = modal.Function.from_name(
            settings.modal_app_name,
            settings.modal_parse_function_name,
        )
        call = function.spawn(parse_run_id)
    except Exception as exc:  # Modal SDK errors must become a visible failed run.
        logger.warning("modal_parse_dispatch_failed parse_run_id=%s", parse_run_id, exc_info=True)
        raise ModalDispatchError("Modal could not accept the parse job.") from exc

    dispatch_id = getattr(call, "object_id", None) or getattr(call, "id", None)
    return str(dispatch_id or "modal-submitted")


def dispatch_pipeline_run(
    kind: str,
    run_id: str,
    lease_token: str,
    *,
    settings: Settings | None = None,
) -> str:
    """Dispatch an experiment/evaluation worker with its fencing token."""

    settings = settings or get_settings()
    if settings.app_env == "development" and not settings.database_url:
        def run_worker() -> None:
            from .pipeline import run_pipeline_worker

            run_pipeline_worker(kind, run_id, lease_token)

        try:
            _local_pipeline_executor.submit(run_worker)
        except RuntimeError as exc:
            raise ModalDispatchError("The local pipeline worker could not be started.") from exc
        return f"local-pipeline-{kind}-{run_id}"
    if not settings.modal_dispatch_enabled:
        raise ModalDispatchError("Modal pipeline dispatch is disabled.")
    try:
        import modal
    except ImportError as exc:  # pragma: no cover - API image includes Modal
        raise ModalDispatchError("The Modal client is not installed.") from exc
    try:
        function = modal.Function.from_name(settings.modal_app_name, "pipeline_worker")
        call = function.spawn(kind, run_id, lease_token)
    except Exception as exc:
        logger.warning("modal_pipeline_dispatch_failed kind=%s run_id=%s", kind, run_id, exc_info=True)
        raise ModalDispatchError("Modal could not accept the pipeline job.") from exc
    dispatch_id = getattr(call, "object_id", None) or getattr(call, "id", None)
    return str(dispatch_id or "modal-submitted")
