"""
UnifiedTree face-verification worker.

Self-hosted FastAPI service that does the CPU-heavy face work for the
Spring `attendance-face` module:

  GET  /health                  liveness probe + model load status
  POST /face/enroll/sample      detect + quality + liveness + embed one sample
  POST /face/verify             same plus 1:1 match against candidate embeddings
  POST /face/quality            cheap quality check (no embedding)

The Spring side is the source of truth for tenants / employees / audit /
encrypted embedding storage. This worker is stateless: take a base64
image, return a verdict. NEVER writes to disk by default.

Models (download to ./models/ before first run):
  - YuNet face detection:
      https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
  - SFace recognition:
      https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx

Both are Apache-2.0 / MIT-equivalent. See README.md.
"""
from __future__ import annotations

import base64
import logging
import os
import time
from typing import List, Optional

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .detector import YuNetDetector
from .embedder import SFaceEmbedder
from .liveness import liveness_score

log = logging.getLogger("face-worker")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

MODEL_DIR = os.getenv("FACE_MODEL_DIR", "models")
DETECTOR_PATH = os.path.join(MODEL_DIR, "face_detection_yunet_2023mar.onnx")
EMBEDDER_PATH = os.path.join(MODEL_DIR, "face_recognition_sface_2021dec.onnx")

app = FastAPI(title="UnifiedTree Face Worker", version="1.0.0")

# Lazy singletons so /health works even if models are missing - the worker
# reports `models_loaded=false` instead of crashing at boot, which lets the
# operator see the issue from the Spring health probe.
_detector: Optional[YuNetDetector] = None
_embedder: Optional[SFaceEmbedder] = None
_models_loaded = False


def _load_models() -> None:
    global _detector, _embedder, _models_loaded
    if _models_loaded:
        return
    if not (os.path.exists(DETECTOR_PATH) and os.path.exists(EMBEDDER_PATH)):
        log.warning(
            "Face models not found. Download both ONNX files into %s "
            "(see README). Endpoints will return MODEL_NOT_LOADED.",
            MODEL_DIR,
        )
        return
    log.info("Loading face models from %s ...", MODEL_DIR)
    _detector = YuNetDetector(DETECTOR_PATH)
    _embedder = SFaceEmbedder(EMBEDDER_PATH)
    _models_loaded = True
    log.info("Face models loaded.")


@app.on_event("startup")
def _startup() -> None:
    _load_models()


# ----------------------------------------------------------------------
# Schemas (intentionally permissive on input; strict on output)
# ----------------------------------------------------------------------


class SampleRequest(BaseModel):
    imageBase64: str = Field(..., min_length=64)
    captureAngle: Optional[str] = None
    challenge: Optional[str] = None


class VerifyRequest(BaseModel):
    imageBase64: str = Field(..., min_length=64)
    challenge: Optional[str] = None
    candidateEmbeddingsBase64: List[str] = Field(default_factory=list)
    embeddingDim: int = 128
    modelName: str = "sface"
    modelVersion: str = "sface-1.0"


class QualityRequest(BaseModel):
    imageBase64: str = Field(..., min_length=64)


# ----------------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------------


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "models_loaded": _models_loaded,
        "detector_path": DETECTOR_PATH,
        "embedder_path": EMBEDDER_PATH,
    }


@app.post("/face/quality")
def face_quality(req: QualityRequest) -> dict:
    img = _decode(req.imageBase64)
    if img is None:
        return _fail("FAIL_DECODE", "Could not decode image.")
    if not _models_loaded:
        return _fail("MODEL_NOT_LOADED", "Worker has no face models installed.")
    faces = _detector.detect(img)
    return _scaffold_quality(img, faces)


@app.post("/face/enroll/sample")
def face_enroll_sample(req: SampleRequest) -> dict:
    img = _decode(req.imageBase64)
    if img is None:
        return _fail("FAIL_DECODE", "Could not decode image.")
    if not _models_loaded:
        return _fail("MODEL_NOT_LOADED", "Worker has no face models installed.")

    t0 = time.time()
    faces = _detector.detect(img)
    quality = _scaffold_quality(img, faces)
    if not quality["face_detected"] or not quality["exactly_one_face"]:
        return quality

    _, landmarks = _detector.crop_and_landmarks(img, faces[0])
    embedding = _embedder.align_and_embed(img, faces[0])
    live = liveness_score(img, landmarks, req.challenge)

    return {
        "face_detected": True,
        "exactly_one_face": True,
        "quality_score": quality["quality_score"],
        "liveness_score": live,
        "embedding_base64": _embedding_to_b64(embedding),
        "embedding_dim": int(embedding.shape[0]),
        "model_name": "sface",
        "model_version": "sface-1.0",
        "latency_ms": int((time.time() - t0) * 1000),
    }


@app.post("/face/verify")
def face_verify(req: VerifyRequest) -> dict:
    img = _decode(req.imageBase64)
    if img is None:
        return _fail("FAIL_DECODE", "Could not decode image.")
    if not _models_loaded:
        return _fail("MODEL_NOT_LOADED", "Worker has no face models installed.")
    if not req.candidateEmbeddingsBase64:
        return _fail("NO_CANDIDATES", "No enrolled embeddings supplied.")

    t0 = time.time()
    faces = _detector.detect(img)
    quality = _scaffold_quality(img, faces)
    if not quality["face_detected"] or not quality["exactly_one_face"]:
        return quality

    _, landmarks = _detector.crop_and_landmarks(img, faces[0])
    embedding = _embedder.align_and_embed(img, faces[0])
    live = liveness_score(img, landmarks, req.challenge)

    # Compute the FULL score distribution against the enrolled templates,
    # not just the best. Spring uses this to apply a quorum rule (e.g.
    # require 3 of 5 templates above near-threshold) which is the single
    # strongest defence against a stranger's "lucky" one-template match.
    # SFace embeddings are L2-normalised so cosine == dot product.
    scores: List[float] = []
    for cb in req.candidateEmbeddingsBase64:
        try:
            cand = _embedding_from_b64(cb, req.embeddingDim)
        except Exception:
            continue
        cos = float(np.dot(embedding, cand))
        # Map cosine -1..1 -> 0..1 for a UI-friendly confidence score.
        scores.append((max(-1.0, min(1.0, cos)) + 1.0) * 0.5)
    scores.sort(reverse=True)
    best = scores[0] if scores else -1.0
    mean = float(np.mean(scores)) if scores else -1.0

    return {
        "face_detected": True,
        "exactly_one_face": True,
        "quality_score": quality["quality_score"],
        "liveness_score": live,
        # Best (kept for backward compat) + the full sorted distribution so
        # the Spring side can enforce a quorum, plus the arithmetic mean.
        "match_score": best,
        "match_scores": scores,
        "match_mean": mean,
        "candidate_count": len(scores),
        "model_name": "sface",
        "model_version": "sface-1.0",
        "latency_ms": int((time.time() - t0) * 1000),
    }


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def _decode(b64: str) -> Optional[np.ndarray]:
    try:
        raw = base64.b64decode(b64, validate=False)
        arr = np.frombuffer(raw, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None or img.size == 0:
            return None
        return img
    except Exception:  # noqa: BLE001
        return None


# Below this fraction of the frame the face is too far for a reliable
# embedding (typical 1920x1080 selfie: ~6% means face shorter than ~250 px).
# Tightening this is the single biggest anti-impersonation lever after the
# multi-template quorum on the Spring side.
MIN_FACE_AREA_RATIO = float(os.getenv("FACE_MIN_AREA_RATIO", "0.035"))


def _scaffold_quality(img: np.ndarray, faces: list) -> dict:
    if not faces:
        return {
            "face_detected": False,
            "exactly_one_face": False,
            "quality_score": 0.0,
            "liveness_score": 0.0,
            "reason": "no face detected",
        }
    if len(faces) > 1:
        return {
            "face_detected": True,
            "exactly_one_face": False,
            "quality_score": 0.0,
            "liveness_score": 0.0,
            "reason": "more than one face",
        }
    # Score combines face area + sharpness (variance of Laplacian).
    h, w = img.shape[:2]
    face = faces[0]
    fw = float(face["w"])
    fh = float(face["h"])
    area_ratio = (fw * fh) / float(max(1, w * h))

    # Hard gate: a face that small almost always produces a low-fidelity
    # embedding and is the prime vector for "hold a phone with someone
    # else's photo across the room" attacks. Reject before we even bother
    # to embed.
    if area_ratio < MIN_FACE_AREA_RATIO:
        return {
            "face_detected": True,
            "exactly_one_face": True,
            "quality_score": 0.0,
            "liveness_score": 0.0,
            "reason": f"face too small/far (area {area_ratio:.3f} < {MIN_FACE_AREA_RATIO})",
        }

    x = int(face["x"])
    y = int(face["y"])
    x0 = max(0, x)
    y0 = max(0, y)
    x1 = min(w, x + int(fw))
    y1 = min(h, y + int(fh))
    face_roi = img[y0:y1, x0:x1]
    if face_roi.size == 0:
        face_roi = img

    gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
    sharp = cv2.Laplacian(gray, cv2.CV_64F).var()
    area_score = min(1.0, area_ratio * 8.0)
    sharp_score = min(1.0, sharp / 800.0)
    quality = round(0.6 * area_score + 0.4 * sharp_score, 3)
    return {
        "face_detected": True,
        "exactly_one_face": True,
        "quality_score": quality,
        "liveness_score": 0.0,
    }


def _fail(reason_code: str, msg: str) -> dict:
    return {
        "face_detected": False,
        "exactly_one_face": False,
        "quality_score": 0.0,
        "liveness_score": 0.0,
        "reason": f"{reason_code}:{msg}",
    }


def _embedding_to_b64(v: np.ndarray) -> str:
    return base64.b64encode(v.astype("<f4").tobytes()).decode("ascii")


def _embedding_from_b64(b64: str, dim: int) -> np.ndarray:
    arr = np.frombuffer(base64.b64decode(b64), dtype="<f4")
    if arr.shape[0] != dim:
        raise ValueError(f"expected dim {dim}, got {arr.shape[0]}")
    return arr
