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

Training pull (real examples for detector v5): `commons-train` downloads the same kind of
camera originals to DATA_DIR/../train_real/commons/, from other devices than the calibration
set and from none of its photographers, and `plan-train` adds them to plan_train.json as
"trainreal_" chunks (a tenth by content hash goes to the calibration split, as for other
sources), so `extract_features.py --split train --features native` extracts them with random
crop spots and random JPEG quality and scale, like every training image.

    python real_photos.py commons-train --per-device 12
    python real_photos.py plan-train
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
TRAIN_ROOT = DATA_DIR.parent / "train_real"
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

# Training pull: 2017-2026 devices that are not in COMMONS_CATEGORIES (nor a VISION phone).
TRAIN_DEVICES = """
iPhone 8|iPhone 8 Plus|iPhone X|iPhone XR|iPhone XS|iPhone XS Max|iPhone 11|iPhone 11 Pro|
iPhone 11 Pro Max|iPhone SE (2nd generation)|iPhone SE (3rd generation)|iPhone 12|
iPhone 12 Pro Max|iPhone 13 Pro|iPhone 14 Plus|iPhone 14 Pro Max|iPhone 15|iPhone 15 Plus|
iPhone 15 Pro|iPhone 16|iPhone 16 Plus|iPhone 16 Pro Max|iPhone 16e|iPhone 17|iPhone Air|
iPhone 17 Pro Max|
Samsung Galaxy S8|Samsung Galaxy S9|Samsung Galaxy S9+|Samsung Galaxy S10|Samsung Galaxy S10e|
Samsung Galaxy S10+|Samsung Galaxy S20|Samsung Galaxy S20 FE|Samsung Galaxy S20 Ultra 5G|
Samsung Galaxy S21 5G|Samsung Galaxy S21 FE 5G|Samsung Galaxy S22 Ultra 5G|Samsung Galaxy S23 FE|
Samsung Galaxy S24 FE|Samsung Galaxy S25|Samsung Galaxy S25 Edge|
Samsung Galaxy Note 8|Samsung Galaxy Note 9|Samsung Galaxy Note 10+|
Samsung Galaxy Note 20 Ultra 5G|Samsung Galaxy A7 (2017)|Samsung Galaxy A20|Samsung Galaxy A50|
Samsung Galaxy A51|Samsung Galaxy A52|Samsung Galaxy A52s 5G|Samsung Galaxy A71|
Samsung Galaxy A72|Samsung Galaxy A33 5G|Samsung Galaxy A34 5G|Samsung Galaxy A35 5G|
Samsung Galaxy A55 5G|Samsung Galaxy A16|Samsung Galaxy A57 5G|Samsung Galaxy M31|
Samsung Galaxy Z Fold4|Samsung Galaxy Z Flip3 5G|
Google Pixel 2|Google Pixel 2 XL|Google Pixel 3|Google Pixel 3a|Google Pixel 4|Google Pixel 4a|
Google Pixel 5|Google Pixel 5a|Google Pixel 6a|Google Pixel 7a|Google Pixel 8|Google Pixel 8a|
Google Pixel 9|Google Pixel 9 Pro|Google Pixel 9 Pro XL|Google Pixel 10 Pro|
Xiaomi Mi A1|Xiaomi Mi A2|Xiaomi Mi A3|Xiaomi Mi 9|Xiaomi Mi 9T|Xiaomi Mi 10|Xiaomi 11T Pro|
Xiaomi 12|Xiaomi 13T|Xiaomi 13T Pro|Xiaomi 14|Xiaomi 14T Pro|Xiaomi 15|Xiaomi Redmi Note 7|
Xiaomi Redmi Note 9 Pro|Xiaomi Redmi Note 10 Pro|Xiaomi Redmi Note 11|Xiaomi Redmi Note 12|
Xiaomi Redmi Note 13 Pro|Xiaomi Redmi 10A|Xiaomi Poco X3 Pro|
OnePlus 6|OnePlus 6T|OnePlus 7 Pro|OnePlus 7T|OnePlus 8|OnePlus 8 Pro|OnePlus 8T|OnePlus 12R|
OnePlus Nord 3 5G|Huawei P20|Huawei P20 Pro|Huawei P30|Huawei P30 Lite|Huawei P40 Pro|
Huawei Mate 10 Pro|Huawei Mate 30 Pro|Huawei Nova 11|Huawei Pura 70 Ultra|Honor 90|
Oppo A9 2020|Oppo Find X5 Pro|Vivo X80 Pro|Vivo X100 Pro|Vivo X200 Pro|Realme 8 Pro|
Realme 9 Pro+|Realme GT 2 Pro|Motorola Edge 60 Pro|Motorola Moto G7|Motorola Moto G9 Plus|
Motorola Edge 40|Sony Xperia 5 II|Sony Xperia 1 IV|Sony Xperia 10 III|Sony Xperia XZ1|
Nokia 7 Plus|Nokia 8|Asus Zenfone 9|Fairphone 3|Fairphone 5|Nothing Phone (1)|Nothing Phone (2)|
Canon EOS 5D Mark IV|Canon EOS 6D Mark II|Canon EOS 77D|Canon EOS 80D|Canon EOS 200D|
Canon EOS 250D|Canon EOS 800D|Canon EOS 850D|Canon EOS 2000D|Canon EOS M50|Canon EOS M6 Mark II|
Canon EOS R|Canon EOS R3|Canon EOS R7|Canon EOS R8|Canon EOS R10|Canon EOS R50|
Canon EOS R6 Mark II|Canon EOS R5 Mark II|Canon EOS-1D X Mark III|Canon PowerShot G7 X Mark III|
Canon PowerShot G5 X Mark II|Nikon D780|Nikon D500|Nikon D5600|Nikon D3500|Nikon D6|Nikon Z 5|
Nikon Z 6 II|Nikon Z 7|Nikon Z 9|Nikon Z fc|Nikon Z 50|Nikon Z f|Nikon Z 30|
Sony ILCE-7M3|Sony ILCE-7M4|Sony ILCE-7RM3|Sony ILCE-7RM4|Sony ILCE-7RM5|Sony ILCE-7M5|
Sony ILCE-9|Sony ILCE-9M2|Sony ILCE-6100|Sony ILCE-6600|Sony ILCE-6700|Sony ILCE-7CR|
Sony ILCE-7CM2|Sony DSC-RX100 VII|Fujifilm X-T3|Fujifilm X-T30|Fujifilm X-T5|Fujifilm X-T50|
Fujifilm X-H2|Fujifilm X-H2S|Fujifilm X-S20|Fujifilm X-E3|Fujifilm X-E4|Fujifilm X100V|
Fujifilm X100VI|Fujifilm X-T20|Fujifilm X-T100|Olympus E-M10 Mark III|Olympus E-M10 Mark IV|
Olympus E-M1 Mark III|Olympus E-M1X|OM System OM-1|OM System OM-5|Olympus PEN-F|
Panasonic Lumix DC-GH5|Panasonic Lumix DC-GX9|Panasonic Lumix DC-S5|Panasonic Lumix DC-FZ1000 II|
Panasonic Lumix DC-S1R|Ricoh GR III|Ricoh GR IIIx|Leica Q2|Leica M11|Leica Q3
"""
TRAIN_CATEGORIES = [f"Taken with {d.strip()}" for d in TRAIN_DEVICES.split("|") if d.strip()]
assert not set(TRAIN_CATEGORIES) & set(COMMONS_CATEGORIES)


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


def write_manifest(src: str, rows: list[dict], root: Path = ROOT) -> None:
    out = root / src / "manifest.jsonl"
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


def api(s: requests.Session, params: dict, tries: int = 6) -> dict:
    """One Commons API query, POSTed (50 long titles overflow a URL), retried when throttled."""
    for attempt in range(tries):
        try:
            r = s.post(COMMONS_API, data={**params, "format": "json", "maxlag": 5}, timeout=60)
            if r.status_code == 200 and "error" not in (j := r.json()):
                return j
        except (requests.RequestException, ValueError) as exc:
            print(f"api retry: {exc}", file=sys.stderr)
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"Commons API failed: {params.get('list') or params.get('prop')}")


def commons_members(s: requests.Session, category: str, limit: int = 400) -> list[str]:
    titles, cont = [], {}
    while len(titles) < limit:
        r = api(s, {"action": "query", "list": "categorymembers",
                    "cmtitle": f"Category:{category}", "cmtype": "file", "cmlimit": 500, **cont})
        titles += [m["title"] for m in r.get("query", {}).get("categorymembers", [])]
        if "continue" not in r:
            break
        cont = r["continue"]
    return [t for t in titles if t.lower().endswith((".jpg", ".jpeg"))]


def commons_info(s: requests.Session, titles: list[str]) -> list[dict]:
    """Licence, author, size and EXIF for up to 50 files per request."""
    out = []
    for i in range(0, len(titles), 50):
        r = api(s, {"action": "query", "titles": "|".join(titles[i:i + 50]), "prop": "imageinfo",
                    "iiprop": "url|size|mime|extmetadata|metadata"})
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


def commons(per_device: int, categories: list[str] = COMMONS_CATEGORIES, root: Path = ROOT,
            avoid: dict | None = None) -> None:
    """`avoid`: urls and photographers whose files must not be picked (the calibration set's)."""
    avoid = avoid or {"url": set(), "author": set()}
    s = session()
    out = root / "commons"
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)
    rows, picks = [], []
    for cat in categories:
        try:
            titles = commons_members(s, cat)
        except Exception as exc:  # missing category or API hiccup
            print(f"{cat}: {exc}")
            continue
        rng.shuffle(titles)
        candidates = [(info, *unedited(info)) for info in commons_info(s, titles[:per_device * 8])]
        candidates = [(info, extra) for info, ok, extra in candidates
                      if ok and info["descriptionurl"] not in avoid["url"]
                      and extra["author"] not in avoid["author"]]
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
    write_manifest("commons", rows, root)


def calibration_set() -> dict:
    """Urls, Commons photographers and devices of the calibration set, to keep training apart."""
    rows = [json.loads(l) for m in ROOT.glob("*/manifest.jsonl")
            for l in m.read_text(encoding="utf-8").splitlines()]
    return {"url": {r["url"] for r in rows},
            "author": {r["author"] for r in rows if r["source"] == "Commons" and r["author"]},
            "device": {r["device"] for r in rows}}


def commons_train(per_device: int) -> None:
    calib = calibration_set()
    devices = {c.removeprefix("Taken with ") for c in TRAIN_CATEGORIES}
    assert not devices & calib["device"], devices & calib["device"]
    print(f"avoiding {len(calib['url'])} calibration files and {len(calib['author'])} photographers")
    commons(per_device, TRAIN_CATEGORIES, TRAIN_ROOT, calib)


def plan_train() -> None:
    """Add the training pull to plan_train.json as one "trainreal_" chunk per device.

    extract_features.py skips chunks it has already extracted, so re-running it on the
    extended plan extracts only these. A tenth of each device's photos (by content hash)
    goes to the calibration split, where the temperature is fitted."""
    path = DATA_DIR / "plan_train.json"
    items = [i for i in json.loads(path.read_text())
             if not i.get("key", "").startswith("trainreal_")]
    calib = calibration_set()
    rows = [json.loads(l) for l in
            (TRAIN_ROOT / "commons" / "manifest.jsonl").read_text(encoding="utf-8").splitlines()]
    assert not {r["url"] for r in rows} & calib["url"]
    assert not {r["device"] for r in rows} & calib["device"]
    by_dev: dict[str, list[str]] = {}
    for r in rows:
        by_dev.setdefault(r["device"], []).append(r["file"])
    for dev, files in sorted(by_dev.items()):
        items.append({"kind": "files", "key": re.sub(r"[^\w]+", "_", f"trainreal_{dev}"),
                      "files": files, "label": 0, "model": "", "source": f"Commons:{dev}",
                      "rows": len(files), "calib_by_hash": 0.1})
    path.write_text(json.dumps(items, indent=1))
    print(f"plan_train.json: +{len(rows)} camera originals from {len(by_dev)} devices")


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
    ap.add_argument("step", choices=["vision", "commons", "social", "plan", "commons-train",
                                     "plan-train"])
    ap.add_argument("--per-device", type=int, default=22)
    a = ap.parse_args()
    {"vision": lambda: vision(a.per_device), "commons": lambda: commons(a.per_device),
     "social": social, "plan": plan, "commons-train": lambda: commons_train(a.per_device),
     "plan-train": plan_train}[a.step]()
