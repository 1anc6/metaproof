"""Error tracking: unhandled API errors and anything logged at ERROR level (failed analyzers,
worker crashes) go to Sentry, if SENTRY_DSN is set. Off by default.

MetaProof promises not to keep uploads or visitors' details, so the reports carry neither: no IP
addresses or cookies, no request bodies, and no local variables from stack frames (which could
hold image bytes or file paths). Only the error, its stack trace and the request's path.
"""

import logging

from app.config import Settings

log = logging.getLogger("metaproof.monitoring")


def init_error_tracking(settings: Settings) -> bool:
    """Start Sentry when a DSN is configured. Returns whether it was started."""
    if not settings.sentry_dsn:
        return False
    import sentry_sdk  # only when used: it costs memory on a 512 MB instance

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        release=f"metaproof-api@{settings.pipeline_version}",
        send_default_pii=False,
        max_request_body_size="never",
        include_local_variables=False,
        traces_sample_rate=0,  # errors only; performance tracing would use up the free quota
    )
    log.info("error tracking on (%s)", settings.sentry_environment)
    return True
