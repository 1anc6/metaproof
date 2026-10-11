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
