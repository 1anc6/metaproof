from pathlib import Path

from app.analyzers.base import MediaInfo, Signal, Strength
from app.analyzers.c2pa_check import C2paAnalyzer, findings_for, summarize
from app.analyzers.metadata import MetadataAnalyzer
from tests.helpers import jpeg_bytes, png_bytes

SOFTWARE, MAKE, MODEL, DATETIME, DATETIME_ORIGINAL = 305, 271, 272, 306, 36867


def _media(tmp_path: Path, data: bytes, name: str, mime: str) -> MediaInfo:
    path = tmp_path / name
    path.write_bytes(data)
    return MediaInfo(path, mime, 64, 48)


def _codes(result) -> set[str]:
    return {f.code for f in result.findings}


# --- metadata -------------------------------------------------------------------------------

def test_stripped_image_is_neutral(tmp_path):
    result = MetadataAnalyzer().run(_media(tmp_path, jpeg_bytes(), "a.jpg", "image/jpeg"))
    assert _codes(result) == {"meta.stripped"}
    assert result.findings[0].signal == Signal.neutral


def test_camera_exif_is_weak_authentic(tmp_path):
    data = jpeg_bytes(exif={MAKE: "Canon", MODEL: "EOS R6"},
                      exif_ifd={DATETIME_ORIGINAL: "2026:01:02 10:00:00"})
    result = MetadataAnalyzer().run(_media(tmp_path, data, "a.jpg", "image/jpeg"))
    finding = next(f for f in result.findings if f.code == "meta.camera_capture")
    assert finding.strength == Strength.weak
    assert result.raw["fields"]["make"] == "Canon"


def test_editor_software_tag(tmp_path):
    data = jpeg_bytes(exif={SOFTWARE: "Adobe Photoshop 26.0"})
    result = MetadataAnalyzer().run(_media(tmp_path, data, "a.jpg", "image/jpeg"))
    assert "meta.editor_tag" in _codes(result)


def test_diffusion_parameters_in_png(tmp_path):
    data = png_bytes({"parameters": "a cat, Steps: 20, Sampler: Euler a"})
    result = MetadataAnalyzer().run(_media(tmp_path, data, "a.png", "image/png"))
    finding = next(f for f in result.findings if f.code == "meta.diffusion_parameters")
    assert finding.signal == Signal.ai and finding.strength == Strength.strong


def test_iptc_ai_source_type_in_xmp(tmp_path):
    xmp = ('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description '
           'Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/'
           'trainedAlgorithmicMedia"/></rdf:RDF></x:xmpmeta>')
    data = jpeg_bytes(xmp=xmp)
    result = MetadataAnalyzer().run(_media(tmp_path, data, "a.jpg", "image/jpeg"))
    assert "meta.iptc_ai_source" in _codes(result)


def test_gps_coordinates_are_never_stored(tmp_path):
    result = MetadataAnalyzer().run(_media(tmp_path, jpeg_bytes(), "a.jpg", "image/jpeg"))
    assert "has_gps" in result.raw["fields"]
    assert not any("GPS" in k for k in result.raw.get("exiftool", {}))


# --- C2PA -----------------------------------------------------------------------------------

def test_no_manifest_is_neutral(tmp_path):
    result = C2paAnalyzer().run(_media(tmp_path, jpeg_bytes(), "a.jpg", "image/jpeg"))
    assert _codes(result) == {"c2pa.absent"}
    assert result.raw == {"present": False}


def _store(actions, status=None, state="Valid"):
    return {
        "active_manifest": "urn:test",
        "validation_state": state,
        "validation_status": status or [],
        "manifests": {"urn:test": {
            "claim_generator": "TestCam/1.0",
            "signature_info": {"issuer": "Test CA", "time": "2026-01-01T00:00:00Z"},
            "assertions": [{"label": "c2pa.actions.v2", "data": {"actions": actions}}],
        }},
    }


IPTC = "http://cv.iptc.org/newscodes/digitalsourcetype/"


def test_signed_ai_generation_is_conclusive():
    summary = summarize(_store([{"action": "c2pa.created",
                                 "digitalSourceType": IPTC + "trainedAlgorithmicMedia"}]))
    findings = findings_for(summary)
    assert findings[0].code == "c2pa.ai_generated"
    assert findings[0].strength == Strength.conclusive


def test_signed_capture_without_edits_is_strong_authentic():
    summary = summarize(_store([{"action": "c2pa.created",
                                 "digitalSourceType": IPTC + "digitalCapture"}]))
    assert [f.code for f in findings_for(summary)] == ["c2pa.signed_capture"]


def test_signed_edits_are_reported():
    summary = summarize(_store([
        {"action": "c2pa.created", "digitalSourceType": IPTC + "digitalCapture"},
        {"action": "c2pa.cropped"},
    ]))
    assert [f.code for f in findings_for(summary)] == ["c2pa.signed_edits"]


def test_hash_mismatch_means_tampered():
    summary = summarize(_store([{"action": "c2pa.created"}],
                               status=[{"code": "assertion.dataHash.mismatch"}], state="Invalid"))
    findings = findings_for(summary)
    assert findings[0].code == "c2pa.invalid" and findings[0].signal == Signal.edited


def test_untrusted_signer_is_not_tampering():
    summary = summarize(_store([{"action": "c2pa.created"}],
                               status=[{"code": "signingCredential.untrusted"}]))
    assert summary["signer_trusted"] is False
    assert "c2pa.invalid" not in {f.code for f in findings_for(summary)}


def _gemini_store(parent_actions, relationship="parentOf"):
    """Shaped like a Gemini download: the file records opened -> edited (composite) ->
    converted, and its parent ingredient's own manifest declares how the picture was made."""
    store = _store([
        {"action": "c2pa.opened"},
        {"action": "c2pa.edited", "digitalSourceType": IPTC + "composite"},
        {"action": "c2pa.converted"},
    ], status=[{"code": "signingCredential.untrusted"}])
    store["manifests"]["urn:test"]["ingredients"] = [
        {"title": "image.png", "relationship": relationship, "active_manifest": "urn:parent"},
    ]
    store["manifests"]["urn:parent"] = {
        "claim_generator": "Google C2PA Core Generator Library",
        "assertions": [{"label": "c2pa.actions.v2", "data": {"actions": parent_actions}}],
    }
    return store


def test_ai_origin_in_the_edit_history_is_conclusive():
    summary = summarize(_gemini_store([
        {"action": "c2pa.created", "digitalSourceType": IPTC + "trainedAlgorithmicMedia"},
    ]))
    assert summary["history_actions"][0]["digital_source_type"] == "trainedAlgorithmicMedia"
    findings = findings_for(summary)
    assert [f.code for f in findings] == ["c2pa.ai_generated", "c2pa.signed_edits"]
    assert findings[0].strength == Strength.conclusive
    assert "AI-generated original" in findings[0].message
    assert findings[1].message.startswith("After it was generated")

    from app import engine
    assert engine.decide(findings).label == "likely_ai_generated"  # not "edited"


def test_edited_camera_photo_stays_edited():
    summary = summarize(_gemini_store([
        {"action": "c2pa.created", "digitalSourceType": IPTC + "digitalCapture"},
    ]))
    findings = findings_for(summary)
    assert [f.code for f in findings] == ["c2pa.signed_edits"]
    assert findings[0].message.startswith("Signed edit history")


def test_only_parent_ingredients_count_as_the_origin():
    # A placed component (componentOf) is not what the picture was made from.
    summary = summarize(_gemini_store([
        {"action": "c2pa.created", "digitalSourceType": IPTC + "trainedAlgorithmicMedia"},
    ], relationship="componentOf"))
    assert summary["history_actions"] == []


def test_history_walk_survives_loops():
    store = _gemini_store([{"action": "c2pa.created"}])
    store["manifests"]["urn:parent"]["ingredients"] = [
        {"relationship": "parentOf", "active_manifest": "urn:test"},     # points back at the file
        {"relationship": "parentOf", "active_manifest": "urn:parent"},   # and at itself
    ]
    assert [a["action"] for a in summarize(store)["history_actions"]] == ["c2pa.created"]


def test_real_signed_file_with_an_ai_original_is_ai_not_edited():
    # A real C2PA file read by the official SDK (tests/fixtures/make_c2pa_chain.py): the
    # bug was calling Gemini downloads "edited" because only the top manifest was read.
    from app import engine

    path = Path(__file__).parent / "fixtures" / "c2pa_ai_original_then_edited.png"
    result = C2paAnalyzer().run(MediaInfo(path, "image/png", 640, 384))
    assert result.raw["validation_state"] == "Valid" and result.raw["signer_trusted"] is False
    assert [a["action"] for a in result.raw["actions"]] == ["c2pa.opened", "c2pa.edited", "c2pa.converted"]
    assert result.raw["history_actions"][0]["digital_source_type"] == "trainedAlgorithmicMedia"
    assert engine.decide(result.findings).label == "likely_ai_generated"
