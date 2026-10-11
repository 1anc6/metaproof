"""Evidence engine: turns findings from all analyzers into one explainable verdict.

v0.1 is rule-based. When the AI detector lands, its calibrated probability enters as one
more weighted score, and the thresholds below are fitted on a validation set.
"""

from dataclasses import dataclass

from app.analyzers.base import Finding, Signal, Strength

ENGINE_VERSION = "0.1.0-rules"

WEIGHTS = {Strength.weak: 0.5, Strength.moderate: 1.0, Strength.strong: 2.0}

# A label needs this much total support...
MIN_SUPPORT = 1.0
# ...and this much more than the runner-up, otherwise the honest answer is "inconclusive".
MIN_MARGIN = 0.75
# Claiming "authentic" needs more than easily forged camera EXIF.
MIN_AUTHENTIC_SUPPORT = 2.0

LABELS = {
    Signal.authentic: "likely_authentic",
    Signal.edited: "edited",
    Signal.ai: "likely_ai_generated",
}


@dataclass
class Decision:
    label: str
    confidence: float | None
    scores: dict[str, float]
    top_reasons: list[dict]


def decide(findings: list[Finding]) -> Decision:
    scores = {s.value: 0.0 for s in LABELS}
    for f in findings:
        if f.signal in LABELS and f.strength in WEIGHTS:
            scores[f.signal.value] += WEIGHTS[f.strength]

    reasons = _rank(findings)

    # Hard evidence (e.g. a signed C2PA AI-generation claim) settles the question.
    conclusive = [f for f in findings if f.strength == Strength.conclusive and f.signal in LABELS]
    if conclusive:
        return Decision(LABELS[conclusive[0].signal], 0.99, scores, reasons)

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    (best, best_score), (_, runner_up) = ranked[0], ranked[1]
    needed = MIN_AUTHENTIC_SUPPORT if best == Signal.authentic.value else MIN_SUPPORT

    if best_score < needed or best_score - runner_up < MIN_MARGIN:
        return Decision("inconclusive", None, scores, reasons)

    # Rule-based scores are not probabilities, so confidence stays empty until calibration.
    return Decision(LABELS[Signal(best)], None, scores, reasons)


def _rank(findings: list[Finding], limit: int = 5) -> list[dict]:
    order = {Strength.conclusive: 4, Strength.strong: 3, Strength.moderate: 2, Strength.weak: 1}
    informative = [f for f in findings if f.signal != Signal.neutral]
    neutral = [f for f in findings if f.signal == Signal.neutral]
    ranked = sorted(informative, key=lambda f: order[f.strength], reverse=True) + neutral
    return [
        {"code": f.code, "signal": f.signal.value, "strength": f.strength.value, "message": f.message}
        for f in ranked[:limit]
    ]
