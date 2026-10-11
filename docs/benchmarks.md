# Benchmarks

Measured on 2026-10-11. Detector accuracy is in [`ml/README.md`](../ml/README.md).

## Database

PostgreSQL 17 + pgvector 0.8, seeded with **real CLIP ViT-B/16 embeddings** from the training
data. Times are server-side execution time (`EXPLAIN ANALYZE`), so network latency is
excluded. Query plans were checked for each case. Reproduce with
[`backend/scripts/benchmark_db.py`](../backend/scripts/benchmark_db.py).

p50 / p95 in milliseconds:

| Analyses | Hash lookup (unique index) | Hash lookup (seq scan) | Seen-before (HNSW) | Seen-before (exact scan) | HNSW recall@5 | Same top match | HNSW build |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10,000 | 0.01 / 0.02 | 0.46 / 0.53 | 0.44 / 0.62 | 16.61 / 18.12 | 99.7% | 100% | 2.2 s |
| 30,000 | 0.01 / 0.04 | 1.43 / 1.81 | 0.63 / 0.98 | 51.92 / 55.66 | 99.6% | 100% | 13.8 s |

- **Deduplication** uses the unique index on `media_files.sha256`: about 140× faster than a
  scan at 30K rows, and the gap grows linearly with the table.
- **Seen-before search** queries simulate a recompressed copy (stored embedding plus noise).
  The HNSW index is about 80× faster than an exact scan at 30K rows while returning the same
  best match in every query; exact search grows linearly (16.6 → 51.9 ms), HNSW barely
  (0.44 → 0.63 ms).
- An earlier run with random vectors gave only 39–68% recall: random 512-d vectors have no
  neighbourhood structure, so they are a misleading test for approximate search. Real
  embeddings cluster, which is what HNSW exploits.

### Storage

Per analysis: ~6 KB for the media row and embedding, plus ~7 KB of WebP thumbnail and a few KB
of findings and analyzer output. Originals are never stored. Neon's free tier (0.5 GB)
therefore holds roughly 25,000–30,000 analyses; at the time of writing the database used
8.5 MB.

## Analysis pipeline (live)

One analysis on the production setup (Render free instance, ~0.1 CPU and 512 MB RAM; Neon in
the same region):

| Stage | Time |
| --- | --- |
| Upload, hashing, validation, enqueue | ~1.7 s from India (network-bound) |
| Metadata (Pillow + ExifTool) | 0.7–0.9 s |
| C2PA validation | < 0.01 s without credentials |
| AI detector (CLIP ViT-B/16, 8-bit weight-only ONNX) | ~5.3 s warm, ~8.4 s on first use (model load) |
| Upload to finished report | ~9 s |

The same detector runs in 0.5 s per image on a laptop CPU (one thread); the free instance's
fractional CPU is the bottleneck. Peak API memory with the detector loaded and a 12 MP photo
is ~350 MB, under the 512 MB limit (the fp32 model peaked at 557 MB and did not fit).

## Tests

52 tests: 41 unit tests plus 11 integration tests that run in CI against a Postgres + pgvector
service container. They cover the upload → queue → worker → report flow, deduplication, rate
limits, restart recovery, near-duplicate search and **12 jobs processed by 6 concurrent
workers with no job claimed twice** (`FOR UPDATE SKIP LOCKED`).
