"""Database benchmarks: duplicate lookup and near-duplicate search at scale.

Runs against a THROWAWAY database (it truncates tables). Seeds analyses with REAL CLIP
embeddings (the ~33K vectors extracted in ml/, read from METAPROOF_FEATURES) or, if those
are unavailable, random unit vectors. Then measures, on the server (EXPLAIN ANALYZE, so
network latency is excluded):
  - SHA-256 lookup (deduplication) with the unique index vs a forced sequential scan
  - "seen before" k-NN search with the HNSW index vs an exact scan, and HNSW recall@5
    for queries that simulate a recompressed copy (stored embedding + small noise)
  - HNSW build time and storage per analysis

    TEST_DATABASE_URL=postgresql://postgres:test@localhost:54329/metaproof_test \
        python scripts/benchmark_db.py --sizes 10000 30000
"""

import argparse
import os
import statistics
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

if not os.environ.get("TEST_DATABASE_URL"):
    sys.exit("Set TEST_DATABASE_URL to a throwaway database; this script deletes all rows.")
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text

from app.config import get_settings

FEATURES = Path(os.environ.get("METAPROOF_FEATURES", "D:/metaproof/data/features"))
QUERIES = 200
K = 5
NOISE = 0.02  # per-dimension noise on a unit vector: cosine ~0.9 to the original, like a recompressed copy

# No client-side prepared statements: a cached plan would ignore the planner settings below.
engine = create_engine(get_settings().database_url, connect_args={"prepare_threshold": None})


def load_vectors(n: int, rng: np.random.Generator) -> tuple[np.ndarray, str]:
    files = sorted(FEATURES.glob("*_vitb16/*.npz"))
    if files:
        vecs = np.concatenate([np.load(f)["features"] for f in files]).astype(np.float32)
        if len(vecs) >= n:
            return vecs[rng.choice(len(vecs), n, replace=False)], "real CLIP ViT-B/16 embeddings"
    v = rng.standard_normal((n, 512)).astype(np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True), "random unit vectors"


def literal(v: np.ndarray) -> str:
    return "[" + ",".join(f"{x:.5f}" for x in v) + "]"


def seed(n: int, vecs: np.ndarray) -> float:
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE media_files CASCADE"))
        conn.execute(text("DROP INDEX IF EXISTS ix_media_embeddings_hnsw"))
        conn.execute(text("""
            INSERT INTO media_files (id, sha256, mime_type, size_bytes, width, height, thumbnail)
            SELECT gen_random_uuid(), encode(sha256(convert_to('bench' || i, 'UTF8')), 'hex'),
                   'image/jpeg', 250000, 1200, 800, decode(repeat('00', 7000), 'hex')
            FROM generate_series(1, :n) AS i
        """), {"n": n})
        ids = conn.execute(text("SELECT id FROM media_files ORDER BY sha256")).scalars().all()
        rows = [{"id": i, "v": literal(v)} for i, v in zip(ids, vecs)]
        for start in range(0, len(rows), 2000):
            conn.execute(text("INSERT INTO media_embeddings (media_id, model, embedding) "
                              "VALUES (:id, 'bench', CAST(:v AS vector))"), rows[start:start + 2000])
        conn.execute(text("ANALYZE media_files"))
        conn.execute(text("ANALYZE media_embeddings"))
    with engine.begin() as conn:
        t = time.perf_counter()
        conn.execute(text("CREATE INDEX ix_media_embeddings_hnsw "
                          "ON media_embeddings USING hnsw (embedding vector_cosine_ops)"))
        return time.perf_counter() - t


def measure(sql: str, params_list: list[dict], setup: str = "") -> tuple[list[float], list, str]:
    """Server-side execution time per query (EXPLAIN ANALYZE), the rows, and the plan used."""
    times, results, plan = [], [], ""
    with engine.connect() as conn:
        for params in params_list:
            with conn.begin():
                if setup:
                    conn.execute(text(setup))
                explained = conn.execute(text("EXPLAIN (ANALYZE, FORMAT JSON) " + sql), params).scalar()
                times.append(explained[0]["Execution Time"])
                plan = plan or describe(explained[0]["Plan"])
                results.append(conn.execute(text(sql), params).scalars().all())
    return times, results, plan


def describe(node: dict) -> str:
    while node.get("Node Type") in ("Limit", "Result") and node.get("Plans"):
        node = node["Plans"][0]
    return f"{node['Node Type']} {node.get('Index Name', '')}".strip()


def p50_p95(ms: list[float]) -> str:
    s = sorted(ms)
    return f"{statistics.median(s):.2f} / {s[int(len(s) * 0.95) - 1]:.2f}"


NO_INDEX = ("SET LOCAL enable_indexscan = off; SET LOCAL enable_bitmapscan = off; "
            "SET LOCAL enable_indexonlyscan = off")


def run(n: int, rng: np.random.Generator) -> dict:
    vecs, source = load_vectors(n, rng)
    build_s = seed(n, vecs)
    with engine.connect() as conn:
        shas = conn.execute(text("SELECT sha256 FROM media_files ORDER BY random() LIMIT :q"),
                            {"q": QUERIES}).scalars().all()

    lookup = "SELECT id FROM media_files WHERE sha256 = :sha"
    idx_t, _, idx_plan = measure(lookup, [{"sha": s} for s in shas])
    seq_t, _, seq_plan = measure(lookup, [{"sha": s} for s in shas], NO_INDEX)

    picks = rng.choice(n, QUERIES, replace=False)
    noisy = vecs[picks] + rng.standard_normal((QUERIES, vecs.shape[1])).astype(np.float32) * NOISE
    noisy /= np.linalg.norm(noisy, axis=1, keepdims=True)
    knn = "SELECT media_id FROM media_embeddings ORDER BY embedding <=> CAST(:v AS vector) LIMIT :k"
    params = [{"v": literal(q), "k": K} for q in noisy]
    hnsw_t, hnsw_r, hnsw_plan = measure(knn, params, "SET LOCAL hnsw.ef_search = 40")
    exact_t, exact_r, exact_plan = measure(knn, params, NO_INDEX)
    recall = statistics.mean(len(set(a) & set(b)) / K for a, b in zip(hnsw_r, exact_r))
    top1 = statistics.mean(a[0] == b[0] for a, b in zip(hnsw_r, exact_r))

    with engine.begin() as conn:
        files_b, emb_b, hnsw_b = conn.execute(text(
            "SELECT pg_total_relation_size('media_files'), pg_total_relation_size('media_embeddings'), "
            "pg_relation_size('ix_media_embeddings_hnsw')")).one()
        conn.execute(text("TRUNCATE media_files CASCADE"))

    print(f"n={n:,} ({source}) plans: [{idx_plan}] vs [{seq_plan}]; [{hnsw_plan}] vs [{exact_plan}]")
    return {"n": n, "lookup_idx": p50_p95(idx_t), "lookup_seq": p50_p95(seq_t),
            "knn_hnsw": p50_p95(hnsw_t), "knn_exact": p50_p95(exact_t), "recall": recall,
            "top1": top1, "build_s": build_s, "kb_per_row": (files_b + emb_b) / n / 1024,
            "hnsw_mb": hnsw_b / 1e6}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sizes", type=int, nargs="+", default=[10_000, 30_000])
    args = ap.parse_args()
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    command.upgrade(cfg, "head")
    rng = np.random.default_rng(0)

    rows = [run(n, rng) for n in args.sizes]
    print("\nServer-side execution time, p50 / p95 in ms\n")
    print("| Analyses | Hash lookup (unique index) | Hash lookup (seq scan) | Seen-before, HNSW "
          "| Seen-before, exact | HNSW recall@5 | Same top match | HNSW build | Storage / analysis |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for r in rows:
        print(f"| {r['n']:,} | {r['lookup_idx']} | {r['lookup_seq']} | {r['knn_hnsw']} | "
              f"{r['knn_exact']} | {r['recall']:.1%} | {r['top1']:.1%} | {r['build_s']:.1f} s "
              f"| {r['kb_per_row']:.1f} KB |")


if __name__ == "__main__":
    main()
