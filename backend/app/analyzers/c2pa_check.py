"""C2PA analyzer: reads and validates Content Credentials with the official c2pa-python SDK.

A missing manifest is neutral: most images have none, and credentials are often stripped
by normal re-saving. A manifest proves who signed it and that the file has not changed
since; it does not prove the scene is real.
"""

import json

import c2pa

from app.analyzers.base import AnalyzerResult, Finding, MediaInfo, Signal, Strength

IPTC_AI = "trainedalgorithmicmedia"
IPTC_AI_COMPOSITE = "compositewithtrainedalgorithmicmedia"
IPTC_CAPTURE = "digitalcapture"
# Actions that do not change pixels; anything else counts as a signed edit.
NON_EDIT_ACTIONS = {"c2pa.created", "c2pa.opened", "c2pa.placed", "c2pa.published"}
# How far back to follow an edit history (ingredient -> its own manifest -> ...).
MAX_HISTORY_DEPTH = 8


class C2paAnalyzer:
    name = "c2pa"
    version = "0.2.0"

    def run(self, media: MediaInfo) -> AnalyzerResult:
        try:
            reader = c2pa.Reader.try_create(str(media.path))
        except c2pa.C2paError as exc:
            return AnalyzerResult(
                raw={"present": True, "error": str(exc)},
                findings=[Finding("c2pa.unreadable", Signal.edited, Strength.moderate,
                                  "Content Credentials are present but could not be read. "
                                  "The manifest may be corrupted or tampered with.")],
            )

        if reader is None:
            return AnalyzerResult(
                raw={"present": False},
                findings=[Finding("c2pa.absent", Signal.neutral, Strength.weak,
                                  "No Content Credentials (C2PA). Most images have none, so "
                                  "this is not evidence either way.")],
            )

        try:
            store = json.loads(reader.json())
        finally:
            reader.close()

        summary = summarize(store)
        return AnalyzerResult(raw=summary, findings=findings_for(summary))


def _actions(manifest: dict) -> list[dict]:
    actions = []
    for assertion in manifest.get("assertions", []):
        if assertion.get("label", "").startswith("c2pa.actions"):
            for action in assertion.get("data", {}).get("actions", []):
                actions.append({
                    "action": action.get("action"),
                    "digital_source_type": (action.get("digitalSourceType") or "").rsplit("/", 1)[-1],
                    "software_agent": _agent_name(action.get("softwareAgent")),
                })
    return actions


def _history(store: dict, manifest: dict) -> list[dict]:
    """Actions recorded by the manifests this file was made from, oldest last.

    An edited file's manifest says what was done to it; what the original was is declared in
    the parent ingredient's own manifest. Gemini, for example, signs "opened, edited
    (composite), converted" on the file and keeps "created, trainedAlgorithmicMedia" on its
    parent, so reading only the top manifest would miss that the picture was AI-generated.
    """
    manifests = store.get("manifests", {})
    seen = {store.get("active_manifest")}
    history: list[dict] = []
    frontier = [manifest]
    for _ in range(MAX_HISTORY_DEPTH):
        parents = []
        for m in frontier:
            for ingredient in m.get("ingredients", []):
                label = ingredient.get("active_manifest") or ingredient.get("manifest")
                if ingredient.get("relationship", "parentOf") != "parentOf" or label in seen:
                    continue
                seen.add(label)
                parent = manifests.get(label)
                if parent:
                    history.extend(_actions(parent))
                    parents.append(parent)
        if not parents:
            break
        frontier = parents
    return history


def summarize(store: dict) -> dict:
    """Reduce a manifest store to the fields the report and the engine need."""
    manifest = store.get("manifests", {}).get(store.get("active_manifest"), {})
    actions = _actions(manifest)

    generator = manifest.get("claim_generator")
    if not generator and manifest.get("claim_generator_info"):
        generator = manifest["claim_generator_info"][0].get("name")

    signature = manifest.get("signature_info", {})
    codes = [s.get("code") or "" for s in store.get("validation_status", [])]
    # An untrusted signer means "not on our trust list", not tampering; report it separately.
    untrusted = "signingCredential.untrusted" in codes
    failures = [
        c for c in codes
        if c and c != "signingCredential.untrusted"
        and not c.endswith((".match", ".validated", ".trusted"))
    ]
    return {
        "present": True,
        "validation_state": store.get("validation_state"),
        "validation_failures": failures,
        "signer_trusted": not untrusted,
        "claim_generator": generator,
        "signer": signature.get("issuer") or signature.get("common_name"),
        "signed_at": signature.get("time"),
        "actions": actions,
        "history_actions": _history(store, manifest),
        "ingredient_count": len(manifest.get("ingredients", [])),
    }


def findings_for(s: dict) -> list[Finding]:
    signer = s.get("signer") or "an unknown signer"
    if s.get("validation_state") == "Invalid" or s.get("validation_failures"):
        codes = ", ".join(s.get("validation_failures") or []) or "validation failed"
        return [Finding("c2pa.invalid", Signal.edited, Strength.strong,
                        f"Content Credentials fail validation ({codes}). The file was probably "
                        "changed after it was signed.")]

    out: list[Finding] = []
    source_types = {a["digital_source_type"].lower() for a in s["actions"]}
    origin_types = {a["digital_source_type"].lower() for a in s.get("history_actions", [])}
    edits = [a["action"] for a in s["actions"] if a["action"] not in NON_EDIT_ACTIONS]

    if IPTC_AI in source_types:
        out.append(Finding("c2pa.ai_generated", Signal.ai, Strength.conclusive,
                           f"Signed Content Credentials from {signer} declare this image "
                           "AI-generated."))
    elif IPTC_AI in origin_types:
        out.append(Finding("c2pa.ai_generated", Signal.ai, Strength.conclusive,
                           f"Signed Content Credentials from {signer} show this image was "
                           "made from an AI-generated original."))
    elif IPTC_AI_COMPOSITE in source_types | origin_types:
        out.append(Finding("c2pa.ai_composite", Signal.ai, Strength.strong,
                           f"Signed Content Credentials from {signer} declare AI-generated "
                           "elements in this image."))

    if edits:
        recorded = ", ".join(sorted(set(edits)))
        after = "After it was generated, the signed" if IPTC_AI in origin_types else "Signed"
        out.append(Finding("c2pa.signed_edits", Signal.edited, Strength.moderate,
                           f"{after} edit history records: {recorded}."))
    elif IPTC_CAPTURE in source_types and not origin_types - {IPTC_CAPTURE, ""}:
        out.append(Finding("c2pa.signed_capture", Signal.authentic, Strength.strong,
                           f"Signed Content Credentials from {signer} record a camera capture "
                           "with no later edits."))

    if not out:
        out.append(Finding("c2pa.valid", Signal.neutral, Strength.weak,
                           f"Valid Content Credentials signed by {signer}."))
    return out


def _agent_name(agent) -> str | None:
    if isinstance(agent, dict):
        return agent.get("name")
    return agent
