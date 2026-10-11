import pytest

from app.ratelimit import RateLimited, SlidingWindowLimiter


class FakeClock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_allows_up_to_the_limit_then_blocks():
    clock = FakeClock()
    limiter = SlidingWindowLimiter(3, window_s=3600, clock=clock)
    for _ in range(3):
        limiter.check("1.2.3.4")
    with pytest.raises(RateLimited) as exc:
        limiter.check("1.2.3.4")
    assert 0 < exc.value.retry_after <= 3601


def test_clients_are_limited_independently():
    limiter = SlidingWindowLimiter(1, clock=FakeClock())
    limiter.check("a")
    limiter.check("b")  # a different IP is unaffected
    with pytest.raises(RateLimited):
        limiter.check("a")


def test_window_slides():
    clock = FakeClock()
    limiter = SlidingWindowLimiter(2, window_s=3600, clock=clock)
    limiter.check("a")
    clock.t += 1800
    limiter.check("a")
    clock.t += 1801  # the first hit has left the window
    limiter.check("a")
    with pytest.raises(RateLimited):
        limiter.check("a")


# --- client IP ------------------------------------------------------------------------------

def make_request(headers: dict[str, str], peer: str = "10.0.0.5"):
    from starlette.requests import Request

    return Request({"type": "http", "client": (peer, 1234),
                    "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()]})


def test_client_ip_prefers_the_header_the_client_cannot_forge():
    from app.ratelimit import client_ip

    request = make_request({"CF-Connecting-IP": "203.0.113.7", "X-Forwarded-For": "1.2.3.4"})
    assert client_ip(request, "cf-connecting-ip") == "203.0.113.7"


def test_client_ip_falls_back_to_the_connection_without_a_valid_header():
    from app.ratelimit import client_ip

    assert client_ip(make_request({}), "cf-connecting-ip") == "10.0.0.5"
    assert client_ip(make_request({"CF-Connecting-IP": "not-an-ip"}), "cf-connecting-ip") == "10.0.0.5"
    assert client_ip(make_request({"CF-Connecting-IP": "203.0.113.7"}), "") == "10.0.0.5"


def test_client_ip_normalizes_ipv6():
    from app.ratelimit import client_ip

    request = make_request({"CF-Connecting-IP": "2001:DB8:0:0::1"})
    assert client_ip(request, "cf-connecting-ip") == "2001:db8::1"
