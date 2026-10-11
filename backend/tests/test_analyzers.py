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
