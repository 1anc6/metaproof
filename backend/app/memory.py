"""Staying inside Render's 512 MB: one full-size image in memory at a time, and freed memory
handed back to the OS. A 30 MP photo takes 115 MB once decoded."""

import ctypes
import threading

# Held while an upload is decoded (in FastAPI's thread pool) and while each analyzer runs (on
# the worker thread). Without it the two overlap and the peak doubles; with it an upload waits
# a few seconds for the analyzer in progress.
big_image_lock = threading.Lock()

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
