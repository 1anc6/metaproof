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
8.5 MB. Images not analyzed for 90 days are deleted (`RETENTION_DAYS`), and the API logs a
warning once the database passes 400 MB (`STORAGE_WARN_MB`).

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

### Per-analyzer time, measured locally

Reproduce with [`backend/scripts/benchmark_pipeline.py`](../backend/scripts/benchmark_pipeline.py)
(throwaway Postgres, real API with the in-process worker, 15 distinct JPEGs per size resized
from one real photo, detector = the 8-bit ONNX model, one CPU thread; Windows laptop, not the
Render instance). Analyzer times are the durations the worker stores in `analyzer_runs`
(whole milliseconds), p50 / p95:

| Image | Upload (POST returns) | Metadata | Structure | C2PA | Watermark | AI detector | Upload to finished report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 MP (~300 KB) | 105 / 108 ms | 28 / 38 ms | 5 / 8 ms | 2 / 3 ms | 94 / 101 ms | 752 / 780 ms | 1.03 / 1.07 s |
| 4 MP (~760 KB) | 118 / 253 ms | 22 / 38 ms | 6 / 7 ms | 3 / 4 ms | 367 / 383 ms | 774 / 839 ms | 1.34 / 1.48 s |
| 12 MP (~1.6 MB) | 165 / 172 ms | 29 / 36 ms | 7 / 8 ms | 6 / 7 ms | 685 / 745 ms | 875 / 952 ms | 1.82 / 1.94 s |

The first upload after startup also loads the model: 1.35 s for the detector (against
0.75 s warm) and 94 ms for the C2PA library's first call. The detector time barely depends on
image size because every image is shrunk to 256 px before inference; decoding and resizing add
the small difference. The watermark analyzer scales with pixel count since it works on the full
image. The structure analyzer (file-structure checks) was measured from the structure-analyzer
code that was then uncommitted in a sibling worktree; it is now in `main`. The local detector time is
higher than the 0.5 s quoted above because here it competes with the polling client and the
database in one process. The source photo is 0.78 MP, so every size is upsampled
and the images are timing inputs only, not detection inputs.

## Tests

100 tests: 77 unit tests plus 23 integration tests that run in CI against a Postgres + pgvector
service container. They cover the upload → queue → worker → report flow, deduplication, rate
limits, restart recovery, near-duplicate search and **12 jobs processed by 6 concurrent
workers with no job claimed twice** (`FOR UPDATE SKIP LOCKED`).
