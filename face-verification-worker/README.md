# UnifiedTree Face Verification Worker

Self-hosted FastAPI service used by the Spring `attendance-face` module
for 1:1 face verification on attendance punch-in. Stateless; the Spring
side owns persistence, tenants, RBAC, and audit.

## What this worker does
- Detects faces in an uploaded image (YuNet)
- Computes a 128-D L2-normalised embedding (SFace)
- Returns a quality + liveness score
- For verify calls, compares against a list of candidate embeddings
  and returns the best cosine-similarity score mapped to 0..1.

NEVER persists images, embeddings, or PII. All state lives on the
Spring side.

## Local run

```bash
cd C:\com\Unified\face-verification-worker
python -m venv .venv
.venv\Scripts\activate          # PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt

mkdir models
# Download the two ONNX files:
curl -L -o models/face_detection_yunet_2023mar.onnx ^
    https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
curl -L -o models/face_recognition_sface_2021dec.onnx ^
    https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx

uvicorn app.main:app --host 0.0.0.0 --port 8091
```

Verify the worker came up healthy AND found its models:

```bash
curl -s http://localhost:8091/health
# expected: {"status":"ok","models_loaded":true,...}
```

If `models_loaded` is `false`, all face endpoints will return a
`MODEL_NOT_LOADED` body and the Spring side will translate that into
HTTP 503 `FACE_WORKER_UNAVAILABLE` for the App.

## Docker

```bash
docker build -t unifiedtree-face-worker .
docker run --rm -p 8091:8091 \
    -v "$PWD/models:/worker/models:ro" \
    unifiedtree-face-worker
```

## API

| Method | Path                   | Purpose                                    |
|--------|------------------------|--------------------------------------------|
| GET    | `/health`              | Liveness probe + `models_loaded` flag      |
| POST   | `/face/quality`        | Fast detect + quality score, no embedding  |
| POST   | `/face/enroll/sample`  | Detect + quality + liveness + EMBEDDING    |
| POST   | `/face/verify`         | 1:1 best-match against candidate embeddings|

### Request / response shapes
See `app/main.py`. Inputs are JSON with `imageBase64` (raw base64 of a
JPEG / PNG). Embeddings are 128 floats encoded as little-endian
float32 + base64. Spring decrypts the candidate embeddings before
forwarding them to `/face/verify`.

`/face/verify` returns the full score distribution, not just the best:

```jsonc
{
  "face_detected": true,
  "exactly_one_face": true,
  "quality_score": 0.74,
  "liveness_score": 0.58,
  "match_score":  0.91,                           // best across templates
  "match_scores": [0.91, 0.87, 0.84, 0.71, 0.68], // all, sorted desc
  "match_mean":   0.802,
  "candidate_count": 5,
  "model_name": "sface",
  "model_version": "sface-1.0",
  "latency_ms": 142
}
```

The Spring side rejects a verification unless ALL of:

  - `match_score >= unifiedtree.face.match-threshold`      (default 0.85)
  - `match_mean  >= match-threshold - match-mean-gap`      (default mean >= 0.80)
  - `>= match-quorum templates >= match-threshold - match-template-gap`
      (default: 4 of 5 templates must score >= 0.81)
  - `quality_score >= min-quality`                          (default 0.60)
  - `liveness_score >= liveness-threshold`                  (default 0.35)
  - `exactly_one_face == true`

The quorum rule is the single strongest impostor defence: a stranger
might get lucky on ONE captured angle but very rarely matches across
4 of 5 different angles of the genuine employee.

### Anti-impersonation tuning

| Env var                         | Default | Effect                              |
|---------------------------------|---------|-------------------------------------|
| `FACE_MIN_AREA_RATIO`           | 0.06    | Reject faces smaller than 6% of the frame; blocks "hold a phone with someone else's photo across the room" attacks. |
| `UNIFIEDTREE_FACE_MATCH_THRESHOLD` | 0.85 | Hard floor for the best single template. Higher = fewer false accepts, more legitimate rejects. |
| `UNIFIEDTREE_FACE_MATCH_QUORUM`    | 4    | Number of enrolled templates that must agree. With 5 samples, 4 is the high-security default. |
| `UNIFIEDTREE_FACE_MATCH_MEAN_GAP`  | 0.05 | How much the mean is allowed to fall below the threshold. Lower = stricter. |
| `UNIFIEDTREE_FACE_LIVENESS_THRESHOLD` | 0.35 | Phase-1 liveness gate. Raise to 0.5+ once a real anti-spoof model lands. |

## Liveness

Phase 1 uses passive heuristics + light landmark-based geometry checks
(`app/liveness.py`). Pure still photos and many replay attacks score
below 0.5 because of low Laplacian variance and absent reflectance
noise. This is NOT production-grade anti-spoof on its own.

TODO(production): swap `liveness.py` for a real anti-spoof ONNX model
(e.g. Silent-Face-Anti-Spoofing). The worker.json contract stays.

## Performance

| CPU              | p50  | p95  |
|------------------|------|------|
| 4-core Intel x86 | ~120 ms | ~280 ms |
| GPU (onnxruntime-gpu) | ~25 ms | ~60 ms |

Verify endpoint targets <700 ms p95 on CPU per the project spec.

## Load test

```bash
python scripts/load_test.py --url http://localhost:8091 \
    --n 500 --concurrency 16
```

Reports total wall time, p50/p95/p99 latency, error rate.

## Security notes

- The worker has NO auth of its own. Bind to `127.0.0.1` or to a
  private docker network; expose ONLY to the Spring backend.
- Never proxy this worker through a public LB.
- Logs intentionally do NOT include base64 image data.
- The encryption-at-rest of embeddings is the Spring side's job;
  this worker only sees plaintext during the in-memory compare.
