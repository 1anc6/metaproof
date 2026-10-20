"""Build the real-photo calibration set: unedited camera photos at original resolution.

The detector's costliest mistake is flagging a real photo, and the test sets used for training
decisions hold mostly small web JPEGs. This set holds what users actually upload: original
phone and camera files, many devices, each with a known licence. Two sources:

  vision   VISION dataset (Shullani et al. 2017, CC BY-SA 4.0): 35 phones of 11 brands from
           2012-2016, "nat" (natural scene) images, original JPEGs straight from the phone.
  commons  Wikimedia Commons, "Taken with <device>" categories for recent phones and cameras
           (2017-2026). Only free licences (CC0, PD, CC BY, CC BY-SA), only JPEGs whose EXIF
           names the device and no editing software, at the device's full size.

Files go to DATA_DIR/../calib_real/<source>/ with manifest.jsonl (url, device, licence,
author). `social` writes a social-media copy of each (long side 1080 px, JPEG quality 75),
and `plan` writes plan_realcal.json and plan_realcal-social.json for extract_features.py.

    python real_photos.py vision --per-device 22
    python real_photos.py commons --per-device 25
    python real_photos.py social
    python real_photos.py plan
"""

import argparse
import io
import json
import random
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

import requests
from PIL import Image, ImageOps

from common import DATA_DIR, SEED

Image.MAX_IMAGE_PIXELS = 200_000_000  # as in extract_features.py (200 MP phones exist)
ROOT = DATA_DIR.parent / "calib_real"
UA = "MetaProof-calibration/1.0 (https://github.com/1anc6/metaproof; research)"
VISION_LIST = "https://lesc.dinfo.unifi.it/VISION/VISION_files.txt"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
FREE = re.compile(r"^(cc0|cc[- ]by(-sa)?[- ][0-9.]+|public domain|pd)", re.I)
EDITORS = re.compile(r"photoshop|lightroom|gimp|snapseed|picsart|darktable|capture one|"
                     r"luminar|affinity|paint\.net|pixelmator|dxo|on1|topaz|canva|"
                     r"meitu|facetune|vsco|polarr|rawtherapee|silkypix|acdsee|hugin|"
                     r"ptgui|picasa|photos legacy|photo editor|lr ", re.I)

# Recent phones (computational photography: the case that worries us) and cameras.
COMMONS_CATEGORIES = [
    # Phones, 2020-2026
    "Taken with iPhone 12 Pro", "Taken with iPhone 13", "Taken with iPhone 13 Pro Max",
    "Taken with iPhone 14", "Taken with iPhone 14 Pro", "Taken with iPhone 15 Pro Max",
    "Taken with iPhone 16 Pro", "Taken with iPhone 17 Pro",
    "Taken with Samsung Galaxy S21 Ultra 5G", "Taken with Samsung Galaxy S22 5G",
    "Taken with Samsung Galaxy S23", "Taken with Samsung Galaxy S23 Ultra",
    "Taken with Samsung Galaxy S24", "Taken with Samsung Galaxy S24 Ultra",
    "Taken with Samsung Galaxy S25 Ultra", "Taken with Samsung Galaxy S26 Ultra",
    "Taken with Samsung Galaxy A53 5G", "Taken with Samsung Galaxy A54 5G",
    "Taken with Google Pixel 6", "Taken with Google Pixel 6 Pro", "Taken with Google Pixel 7",
    "Taken with Google Pixel 7 Pro", "Taken with Google Pixel 8 Pro", "Taken with OnePlus Nord",
    "Taken with OnePlus 9 Pro 5G", "Taken with OnePlus 10 Pro 5G", "Taken with OnePlus 11 5G",
    "Taken with OnePlus 12", "Taken with OnePlus 13", "Taken with OnePlus Nord 2T 5G",
    "Taken with Xiaomi 12T", "Taken with Xiaomi 13", "Taken with Xiaomi 14 Ultra",
    "Taken with Xiaomi 15 Ultra", "Taken with Xiaomi 17 Ultra",
    "Taken with Xiaomi Redmi Note 8 Pro", "Taken with Huawei P30 Pro",
    "Taken with Huawei Mate 20 Pro", "Taken with Honor Magic5 Pro",
    "Taken with Honor Magic 6 Pro", "Taken with Honor 200 Pro", "Taken with Nothing Phone (2a)",
    "Taken with Nothing Phone (3)", "Taken with Motorola Edge 30 Neo", "Taken with Vivo V21",
    "Taken with Oppo A5 2020", "Taken with Fairphone 4", "Taken with Sony Xperia 1 II",
    # Cameras, 2017-2023
    "Taken with Canon EOS R5", "Taken with Canon EOS R6", "Taken with Canon EOS 90D",
    "Taken with Canon EOS RP", "Taken with Nikon Z 6", "Taken with Nikon Z 7 II",
    "Taken with Nikon Z 8", "Taken with Nikon D850", "Taken with Nikon D7500",
    "Taken with Sony ILCE-7C", "Taken with Sony ILCE-6400", "Taken with Sony ILCE-1",
    "Taken with Fujifilm X-T4", "Taken with Fujifilm X-S10", "Taken with Olympus E-M1 Mark II",
    "Taken with Panasonic Lumix DC-G9", "Taken with Sony DSC-RX100 VI",
    "Taken with Canon PowerShot G7 X Mark II",
]


def session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = UA
    return s


def download(s: requests.Session, url: str, dest: Path, tries: int = 4) -> bool:
    if dest.exists() and dest.stat().st_size > 0:
        return True
    for attempt in range(tries):
        try:
            r = s.get(url, timeout=120)
            if r.status_code == 429:
                time.sleep(30 * (attempt + 1))
                continue
            r.raise_for_status()
            dest.write_bytes(r.content)
            return True
        except requests.RequestException as exc:
            print(f"retry {url}: {exc}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    return False


def write_manifest(src: str, rows: list[dict]) -> None:
    out = ROOT / src / "manifest.jsonl"
    with out.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"{len(rows)} files in {out}")


def vision(per_device: int) -> None:
    """A fixed random sample of each device's natural-scene images."""
    s = session()
    urls = [u for u in s.get(VISION_LIST, timeout=60).text.split()
            if "/images/nat/" in u and u.lower().endswith(".jpg")]
    by_device: dict[str, list[str]] = {}
    for u in urls:
        by_device.setdefault(u.split("/dataset/")[1].split("/")[0], []).append(u)
    rng = random.Random(SEED)
    picks = []
    for device, us in sorted(by_device.items()):
        picks += [(device, u) for u in rng.sample(sorted(us), min(per_device, len(us)))]
    out = ROOT / "vision"
    out.mkdir(parents=True, exist_ok=True)
    rows = []

    def get(item):
        device, url = item
        dest = out / url.rsplit("/", 1)[1]
        return item, dest, download(s, url, dest)

    with ThreadPoolExecutor(4) as pool:
        for (device, url), dest, ok in pool.map(get, picks):
            if ok:
                rows.append({"file": str(dest), "source": "VISION", "device": device,
                             "url": url, "license": "CC BY-SA 4.0",
                             "author": "LESC, University of Florence (Shullani et al. 2017)"})
    write_manifest("vision", rows)


def commons_members(s: requests.Session, category: str, limit: int = 400) -> list[str]:
    titles, cont = [], {}
    while len(titles) < limit:
        r = s.get(COMMONS_API, params={
            "action": "query", "list": "categorymembers", "cmtitle": f"Category:{category}",
            "cmtype": "file", "cmlimit": 500, "format": "json", **cont}, timeout=60).json()
        titles += [m["title"] for m in r.get("query", {}).get("categorymembers", [])]
        if "continue" not in r:
            break
        cont = r["continue"]
    return [t for t in titles if t.lower().endswith((".jpg", ".jpeg"))]


def commons_info(s: requests.Session, titles: list[str]) -> list[dict]:
    """Licence, author, size and EXIF for up to 50 files per request."""
    out = []
    for i in range(0, len(titles), 50):
        r = s.get(COMMONS_API, params={
            "action": "query", "titles": "|".join(titles[i:i + 50]), "prop": "imageinfo",
            "iiprop": "url|size|mime|extmetadata|metadata", "format": "json"}, timeout=60).json()
        for page in r.get("query", {}).get("pages", {}).values():
            if page.get("imageinfo"):
                out.append({"title": page["title"], **page["imageinfo"][0]})
        time.sleep(0.5)
    return out


def unedited(info: dict) -> tuple[bool, dict]:
    """Free licence, camera EXIF intact, no editing software, not shrunk."""
    ext = info.get("extmetadata", {})
    lic = ext.get("LicenseShortName", {}).get("value", "")
    meta = {m["name"]: m["value"] for m in info.get("metadata") or []
            if isinstance(m.get("value"), (str, int, float))}
    software = str(meta.get("Software", ""))
    ok = (info.get("mime") == "image/jpeg" and bool(FREE.match(lic.strip()))
          and meta.get("Make") and meta.get("Model") and meta.get("DateTimeOriginal")
          and not EDITORS.search(software)
          and max(info["width"], info["height"]) >= 3000
          and info["size"] < 40_000_000)
    author = re.sub(r"<[^>]+>", "", ext.get("Artist", {}).get("value", "")).strip()
    return bool(ok), {"license": lic, "author": author[:200], "make": str(meta.get("Make")),
                      "model": str(meta.get("Model")), "software": software,
                      "date": str(meta.get("DateTimeOriginal"))}


def commons(per_device: int) -> None:
    s = session()
    out = ROOT / "commons"
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)
    rows, picks = [], []
    for cat in COMMONS_CATEGORIES:
        try:
            titles = commons_members(s, cat)
        except Exception as exc:  # missing category or API hiccup
            print(f"{cat}: {exc}")
            continue
        rng.shuffle(titles)
        candidates = [(info, *unedited(info)) for info in commons_info(s, titles[:per_device * 8])]
        candidates = [(info, extra) for info, ok, extra in candidates if ok]
        # A crop has a size of its own; the sensor's full sizes repeat across a device's files.
        sizes = Counter(tuple(sorted((i["width"], i["height"]))) for i, _ in candidates)
        chosen, authors = [], {}
        for info, extra in candidates:
            # At most a third of a device's images from one photographer: more scenes.
            if sizes[tuple(sorted((info["width"], info["height"])))] >= 2 and \
                    authors.get(extra["author"], 0) < max(3, per_device // 3):
                authors[extra["author"]] = authors.get(extra["author"], 0) + 1
                chosen.append((cat, info, extra))
            if len(chosen) >= per_device:
                break
        print(f"{cat}: {len(titles)} JPEGs, {len(chosen)} kept")
        picks += chosen

    def get(item):
        cat, info, extra = item
        name = re.sub(r"[^\w.-]", "_", info["title"].split(":", 1)[1])[-120:]
        dest = out / name
        ok = download(s, info["url"], dest)
        time.sleep(0.2)
        return item, dest, ok

    with ThreadPoolExecutor(3) as pool:
        for (cat, info, extra), dest, ok in pool.map(get, picks):
            if ok:
                rows.append({"file": str(dest), "source": "Commons",
                             "device": cat.removeprefix("Taken with "),
                             "url": info["descriptionurl"], **extra})
    write_manifest("commons", rows)


def social() -> None:
    """Social-media copy: long side 1080 px, JPEG quality 75 (what Instagram/WhatsApp send)."""
    for manifest in ROOT.glob("*/manifest.jsonl"):
        out = manifest.parent / "social"
        out.mkdir(exist_ok=True)
        for line in manifest.read_text(encoding="utf-8").splitlines():
            src = Path(json.loads(line)["file"])
            dest = out / (src.stem + ".jpg")
            if dest.exists():
                continue
            with Image.open(src) as img:
                img = ImageOps.exif_transpose(img).convert("RGB")
                r = 1080 / max(img.size)
                if r < 1:
                    img = img.resize((round(img.width * r), round(img.height * r)), Image.LANCZOS)
                img.save(dest, "JPEG", quality=75)


def plan() -> None:
    """One chunk per device, so extract_features.py records the device as the source."""
    for split, sub in (("realcal", None), ("realcal-social", "social")):
        items = []
        for manifest in sorted(ROOT.glob("*/manifest.jsonl")):
            rows = [json.loads(l) for l in manifest.read_text(encoding="utf-8").splitlines()]
            by_dev: dict[str, list[str]] = {}
            for r in rows:
                f = Path(r["file"])
                if sub:
                    f = f.parent / sub / (f.stem + ".jpg")
                by_dev.setdefault(f"{r['source']}:{r['device']}", []).append(str(f))
            for dev, files in sorted(by_dev.items()):
                key = re.sub(r"[^\w]+", "_", f"{split}_{dev}")
                items.append({"kind": "files", "key": key, "files": files, "label": 0,
                              "model": "", "source": dev, "rows": len(files)})
        (DATA_DIR / f"plan_{split}.json").write_text(json.dumps(items, indent=1))
        print(f"plan_{split}.json: {sum(i['rows'] for i in items)} images, {len(items)} devices")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["vision", "commons", "social", "plan"])
    ap.add_argument("--per-device", type=int, default=22)
    a = ap.parse_args()
    {"vision": lambda: vision(a.per_device), "commons": lambda: commons(a.per_device),
     "social": social, "plan": plan}[a.step]()
