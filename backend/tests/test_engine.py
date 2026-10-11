from app.analyzers.base import Finding, Signal, Strength
from app.engine import decide


def f(signal: Signal, strength: Strength, code: str = "x") -> Finding:
    return Finding(code, signal, strength, "message")


def test_no_evidence_is_inconclusive():
    assert decide([]).label == "inconclusive"
    assert decide([f(Signal.neutral, Strength.weak)]).label == "inconclusive"


def test_conclusive_evidence_wins_over_everything():
    d = decide([
        f(Signal.authentic, Strength.strong),
        f(Signal.authentic, Strength.strong),
        f(Signal.ai, Strength.conclusive, "c2pa.ai_generated"),
    ])
    assert d.label == "likely_ai_generated"
    assert d.top_reasons[0]["code"] == "c2pa.ai_generated"
    # The scores agree with the verdict instead of showing AI at 0.
    assert d.scores["ai"] == 10.0 and d.scores["ai"] > d.scores["authentic"] == 4.0


def test_gemini_like_findings_score_ai_above_its_edits():
    d = decide([
        f(Signal.ai, Strength.conclusive, "c2pa.ai_generated"),
        f(Signal.edited, Strength.moderate, "c2pa.signed_edits"),
        f(Signal.neutral, Strength.weak, "detector.uncertain"),
    ])
    assert d.label == "likely_ai_generated"
    assert d.scores == {"authentic": 0.0, "edited": 1.0, "ai": 10.0}


def test_camera_exif_alone_is_not_enough_for_authentic():
    assert decide([f(Signal.authentic, Strength.weak)]).label == "inconclusive"


def test_strong_signed_capture_is_authentic():
    assert decide([f(Signal.authentic, Strength.strong)]).label == "likely_authentic"


def test_close_competing_evidence_is_inconclusive():
    d = decide([f(Signal.edited, Strength.moderate), f(Signal.ai, Strength.moderate)])
    assert d.label == "inconclusive"


def test_clear_edit_evidence():
    d = decide([f(Signal.edited, Strength.moderate), f(Signal.edited, Strength.weak)])
    assert d.label == "edited"
    assert d.scores["edited"] == 1.5
