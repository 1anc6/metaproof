"""Staying inside Render's 512 MB: one full-size image in memory at a time, and freed memory
handed back to the OS. A 30 MP photo takes 115 MB once decoded."""

import ctypes
import threading
from collections.abc import Callable
from pathlib import Path

# Held while an upload is decoded (in FastAPI's thread pool) and while each analyzer runs (on
# the worker thread). Without it the two overlap and the peak doubles; with it an upload waits
# a few seconds for the analyzer in progress.
big_image_lock = threading.Lock()

_malloc_trim: Callable[[int], int] | None
try:  # glibc, as in the Docker image; elsewhere there is nothing to call
    _malloc_trim = ctypes.CDLL("libc.so.6").malloc_trim
    _malloc_trim.argtypes = [ctypes.c_size_t]
except (OSError, AttributeError):
    _malloc_trim = None


def release_freed_memory() -> None:
    """Give memory that has been freed back to the OS. glibc keeps it for reuse otherwise, and
    the process stays as large as its biggest job."""
    if _malloc_trim is not None:
        _malloc_trim(0)


def process_memory_mb(status_file: Path = Path("/proc/self/status")) -> tuple[float | None, float | None]:
    """This process's resident memory now and at its highest since it started, in MB, for the
    status page. Read from /proc (Linux, as in the Docker image); (None, None) elsewhere."""
    try:
        fields = dict(line.split(":", 1) for line in status_file.read_text().splitlines() if ":" in line)
        now_kb, peak_kb = (int(fields[k].split()[0]) for k in ("VmRSS", "VmHWM"))
    except (OSError, KeyError, ValueError):
        return None, None
    return round(now_kb / 1024, 1), round(peak_kb / 1024, 1)
