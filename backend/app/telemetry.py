"""Small dependency-free resource measurements for parse worker benchmarks."""

from __future__ import annotations

import contextlib
import os
import time
from dataclasses import dataclass
from typing import Iterator

try:
    import resource
except ImportError:  # pragma: no cover - Windows local development
    resource = None  # type: ignore[assignment]


def _rss_bytes() -> int | None:
    """Return current RSS where the host exposes it without extra packages."""

    proc_status = "/proc/self/status"
    try:
        with open(proc_status, encoding="utf-8") as stream:
            for line in stream:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) * 1024
    except (FileNotFoundError, OSError, ValueError):
        pass
    return None


@dataclass(frozen=True)
class ResourceMeasurement:
    elapsed_ms: int
    peak_rss_mb: float | None
    cpu_user_ms: int
    cpu_system_ms: int

    def as_dict(self) -> dict[str, int | float | None]:
        return {
            "elapsedMs": self.elapsed_ms,
            "peakRssMb": self.peak_rss_mb,
            "cpuUserMs": self.cpu_user_ms,
            "cpuSystemMs": self.cpu_system_ms,
        }


@contextlib.contextmanager
def measure_resource_usage() -> Iterator[dict[str, int | float | None]]:
    """Measure one parse invocation and expose a mutable result dictionary."""

    started = time.perf_counter()
    usage_before = resource.getrusage(resource.RUSAGE_SELF) if resource is not None else None
    rss_before = _rss_bytes()
    result: dict[str, int | float | None] = {}
    try:
        yield result
    finally:
        elapsed_ms = max(0, int((time.perf_counter() - started) * 1000))
        usage_after = resource.getrusage(resource.RUSAGE_SELF) if resource is not None else None
        rss_after = _rss_bytes()
        peak_rss = usage_after.ru_maxrss if usage_after is not None else 0
        # Linux reports KiB, macOS reports bytes. Modal's worker is Linux, but
        # keeping the conversion portable makes local measurements comparable.
        if peak_rss:
            peak_bytes = peak_rss * 1024 if os.name != "posix" or rss_after is None else peak_rss * 1024
            if rss_before is not None and rss_after is not None:
                peak_bytes = max(peak_bytes, rss_before, rss_after)
            peak_rss_mb = round(peak_bytes / (1024 * 1024), 2)
        else:
            peak_rss_mb = None
        result.update(
            ResourceMeasurement(
                elapsed_ms=elapsed_ms,
                peak_rss_mb=peak_rss_mb,
                cpu_user_ms=(
                    max(0, int((usage_after.ru_utime - usage_before.ru_utime) * 1000))
                    if usage_after is not None and usage_before is not None
                    else 0
                ),
                cpu_system_ms=(
                    max(0, int((usage_after.ru_stime - usage_before.ru_stime) * 1000))
                    if usage_after is not None and usage_before is not None
                    else 0
                ),
            ).as_dict()
        )
