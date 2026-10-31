import sentry_sdk

from app.config import Settings
from app.monitoring import init_error_tracking


def test_error_tracking_is_off_without_a_dsn(monkeypatch):
    calls = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: calls.append(kw))
    assert init_error_tracking(Settings(sentry_dsn="")) is False
    assert calls == []


def test_error_reports_carry_no_personal_data(monkeypatch):
    calls = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: calls.append(kw))
    assert init_error_tracking(Settings(sentry_dsn="https://key@o1.ingest.sentry.io/1")) is True
    (options,) = calls
    assert options["send_default_pii"] is False
    assert options["max_request_body_size"] == "never"
    assert options["include_local_variables"] is False
