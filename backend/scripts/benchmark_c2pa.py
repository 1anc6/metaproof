"""C2PA benchmark: detection and validation on valid, tampered, stripped and credential-free files.

Downloads published sample images from the C2PA project (contentauth/c2pa-rs, pinned to one
commit; dual-licensed MIT / Apache-2.0, licence texts are saved next to the samples) and builds
four groups from them:

  valid     signed samples, untouched
  tampered  JPEG samples with one bit flipped in the compressed pixel data after signing, so
            the pixels change but the manifest is left in place (hash mismatch expected)
  stripped  the signed samples re-saved with Pillow, which drops the manifest
  none      published samples that never had a manifest

Each file goes through backend/app/analyzers/c2pa_check.py exactly as the API runs it. The
script reports, per group, how many files are detected as having credentials, the validation
outcome, and the analyzer's run time. Group membership is checked from the bytes (a manifest
store contains a "jumb" box), not from the analyzer's answer.

    python scripts/benchmark_c2pa.py --dir D:/metaproof/data/c2pa_samples

--dir must not exist or be empty on the first run (downloads go only there); later runs reuse
what is in it. Uses no database.
"""

import argparse
import hashlib
import io
import json
import os
import statistics
import sys
import time
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:test@localhost:54329/metaproof_e2e")

from PIL import Image

from app.analyzers.base import MediaInfo
from app.analyzers.c2pa_check import C2paAnalyzer

REPO = "contentauth/c2pa-rs"
COMMIT = "60f7cbdc69ab7a2554fcc87eb4df77050814b2cf"
RAW = f"https://raw.githubusercontent.com/{REPO}/{COMMIT}/"
FIXTURES = "sdk/tests/fixtures/"
LICENCES = ["LICENSE-MIT", "LICENSE-APACHE"]
SIGNED = [
    "C.jpg", "CA.jpg", "CACA.jpg", "CACAE-uri-CA.jpg", "CIE-sig-CA.jpg", "E-sig-CA.jpg",
    "XCA.jpg", "adobe-20220124-E-clm-CAICAI.jpg", "boxhash.jpg", "legacy_ingredient_hash.jpg",
    "ocsp.jpg", "prerelease.jpg", "update_manifest.jpg",
]
UNSIGNED = [
    "IMG_0003.jpg", "thumbnail.jpg", "P1000827.jpg", "earth_apollo17.jpg", "libpng-test.png",
    "sample1.png", "sample1.webp", "mars.webp", "test.webp",
]
MIME = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
REPEATS = 20


def has_manifest(data: bytes) -> bool:
    return b"jumb" in data and b"c2pa" in data


def download(dest: Path) -> None:
    if dest.exists() and any(dest.iterdir()):
        return
    src = dest / "source"
    src.mkdir(parents=True)
    for name in SIGNED + UNSIGNED:
        urllib.request.urlretrieve(RAW + FIXTURES + name.replace(" ", "%20"), src / name)
    for name in LICENCES:
        urllib.request.urlretrieve(RAW + name, dest / name)
    (dest / "SOURCE.txt").write_text(
        f"Files from https://github.com/{REPO}/tree/{COMMIT}/{FIXTURES}\n"
        "Licensed MIT or Apache-2.0, see LICENSE-MIT and LICENSE-APACHE.\n")


def tamper_jpeg(data: bytes) -> bytes | None:
    """Flip one bit in the compressed pixel data (not the manifest) so pixels change but the
    file still decodes. Returns None if no flip that keeps it decodable and different is found."""
    sos = data.rfind(b"\xff\xda")
    if sos < 0:
        return None
    start = sos + 2 + int.from_bytes(data[sos + 2:sos + 4], "big")
    end = data.rfind(b"\xff\xd9")
    original = Image.open(io.BytesIO(data)).convert("RGB").tobytes()
    for frac in (0.5, 0.4, 0.6, 0.3, 0.7):
        i = start + int((end - start) * frac)
        if data[i] in (0x00, 0xFF) or data[i - 1] == 0xFF or data[i + 1] == 0x00:
            continue
        out = bytearray(data)
        out[i] ^= 0x04
        try:
            if Image.open(io.BytesIO(bytes(out))).convert("RGB").tobytes() != original:
                return bytes(out)
        except Exception:
            continue
    return None


def build(dest: Path) -> dict[str, list[Path]]:
    groups = {g: dest / g for g in ("valid", "tampered", "stripped", "none")}
    for p in groups.values():
        p.mkdir(exist_ok=True)
    src = dest / "source"
    skipped = []
    for name in SIGNED:
        data = (src / name).read_bytes()
        assert has_manifest(data), f"{name} has no manifest bytes"
        (groups["valid"] / name).write_bytes(data)
        if name.endswith(".jpg"):
            t = tamper_jpeg(data)
            if t is None:
                skipped.append(name)
            else:
                (groups["tampered"] / name).write_bytes(t)
        img = Image.open(io.BytesIO(data))
        out = groups["stripped"] / name
        if name.endswith(".jpg"):
            img.convert("RGB").save(out, quality=95)
        elif name.endswith(".webp"):
            img.save(out, quality=95)
        else:
            img.save(out)
        assert not has_manifest(out.read_bytes()), f"{name} still has a manifest after re-save"
    for name in UNSIGNED:
        data = (src / name).read_bytes()
        assert not has_manifest(data), f"{name} unexpectedly has manifest bytes"
        (groups["none"] / name).write_bytes(data)
    if skipped:
        print("could not tamper:", skipped)
    return {g: sorted(p.iterdir()) for g, p in groups.items()}


def run_file(analyzer: C2paAnalyzer, path: Path) -> dict:
    with Image.open(path) as img:
        w, h = img.size
    media = MediaInfo(path, MIME[path.suffix.lower()], w, h)
    times = []
    for _ in range(REPEATS):
        t0 = time.perf_counter()
        result = analyzer.run(media)
        times.append((time.perf_counter() - t0) * 1000)
    raw = result.raw
    return {
        "file": path.name,
        "kb": round(path.stat().st_size / 1024),
        "detected": bool(raw.get("present")),
        "validation_state": raw.get("validation_state") or ("error" if raw.get("error") else None),
        "failures": raw.get("validation_failures", []),
        "signer_trusted": raw.get("signer_trusted"),
        "findings": [f.code for f in result.findings],
        "ms": times,
    }


def pct(values: list[float], q: float) -> float:
    s = sorted(values)
    return s[min(len(s) - 1, int(q * len(s)))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="empty or non-existent on first run")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent / "results_c2pa.json"))
    args = ap.parse_args()
    dest = Path(args.dir)

    download(dest)
    groups = build(dest)
    analyzer = C2paAnalyzer()
    first = next(iter(groups["valid"]))
    run_file(analyzer, first)  # warm up the SDK so the first file isn't charged for loading

    results = {"source": f"{REPO}@{COMMIT}", "repeats": REPEATS, "groups": {}}
    for group, files in groups.items():
        rows = [run_file(analyzer, f) for f in files]
        all_ms = [m for r in rows for m in r["ms"]]
        codes = Counter(c for r in rows for c in r["findings"])
        results["groups"][group] = {
            "files": len(rows),
            "detected": sum(r["detected"] for r in rows),
            "validation_state": dict(Counter(str(r["validation_state"]) for r in rows)),
            "finding_codes": dict(codes),
            "ms_p50": round(statistics.median(all_ms), 2),
            "ms_p95": round(pct(all_ms, 0.95), 2),
            "rows": [{**r, "ms": round(statistics.median(r["ms"]), 2)} for r in rows],
        }
        g = results["groups"][group]
        print(f"{group:<9} files={g['files']:>2} detected={g['detected']:>2} "
              f"state={g['validation_state']} codes={g['finding_codes']} "
              f"p50={g['ms_p50']}ms p95={g['ms_p95']}ms")
    # Some published samples are deliberate negatives (bad signature, missing ingredients, a
    # pre-release format), so also report tampering detection on files that validated untouched.
    ok = {r["file"] for r in results["groups"]["valid"]["rows"] if r["validation_state"] == "Valid"}
    tam = [r for r in results["groups"]["tampered"]["rows"] if r["file"] in ok]
    results["tamper_detection_on_originally_valid"] = {
        "files": len(tam), "flagged_invalid": sum("c2pa.invalid" in r["findings"] for r in tam)}
    print("tampered, originally valid:", results["tamper_detection_on_originally_valid"])
    results["sha256"] = {f.name: hashlib.sha256(f.read_bytes()).hexdigest()[:16]
                         for f in (dest / "source").iterdir()}
    Path(args.out).write_text(json.dumps(results, indent=2))
    print("wrote", args.out)


if __name__ == "__main__":
    main()
