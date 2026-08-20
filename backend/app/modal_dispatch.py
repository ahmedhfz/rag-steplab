"""Dispatch boundary between FastAPI and the deployed Modal worker."""

from __future__ import annotations

from .config import Settings, get_settings


class ModalDispatchError(RuntimeError):
    """Raised when a parse cannot be handed to Modal."""


def parse_call_terminal_failure(dispatch_id: str) -> bool:
    """Return true only when Modal reports a durable terminal call failure.

    Poll timeouts, expired output retention, authentication, and connectivity
    errors are deliberately treated as unknown. They must not turn a healthy
    durable parse run into a false failure.
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
    except modal.exception.Error:
        return False


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
        raise ModalDispatchError("Modal could not accept the parse job.") from exc

    dispatch_id = getattr(call, "object_id", None) or getattr(call, "id", None)
    return str(dispatch_id or "modal-submitted")
