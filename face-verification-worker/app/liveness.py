"""Phase 1 passive + active liveness.

Strategy:
  - reject pure still photos by checking that the supplied image is not
    a textbook printout (low high-frequency content suggests print/replay)
  - if the App supplied a challenge label, lightly verify the geometry
    matches the prompt (eye-aspect-ratio for BLINK, yaw delta for
    TURN_LEFT / TURN_RIGHT, ...)
  - return a 0..1 score; Spring rejects below FACE_REQUIRE_LIVENESS

TODO(production): swap this module out for a real anti-spoof ONNX model
(e.g. MiniFASNet or Silent-Face-Anti-Spoofing v3) and gate behind a
config flag. The worker.json contract stays identical.

PERFORMANCE FLAG - `FACE_LIVENESS_FAST_ROI` (default OFF)
---------------------------------------------------------
The two passive checks below (Laplacian variance, HSV-V std-dev) run
over the WHOLE frame by default. On a 1920x1080 selfie that is three
full-frame passes, one of which (`cv2.Laplacian(..., cv2.CV_64F)`)
allocates a ~16 MB float64 buffer per call.

Setting `FACE_LIVENESS_FAST_ROI=true` restricts both checks to the
detected face rectangle and drops the Laplacian accumulator to
`CV_32F`. That is typically an order of magnitude less pixel work.

!! THIS CHANGES THE SCORES IT RETURNS. !!
Laplacian variance and V-std over a tight face crop are NOT the same
numbers as over the full frame (background clutter, walls and clothing
all contribute today). The gate that consumes this score lives on the
Spring side:

    application-canonical-prod.yml
      unifiedtree.face.liveness-threshold
        = ${UNIFIEDTREE_FACE_LIVENESS_THRESHOLD:0.35}

So the flag DEFAULTS TO OFF and the full-frame CV_64F math stays the
production behaviour until someone re-tunes `liveness-threshold`
against real captures (enrol + punch frames from a real device, both
genuine and print/replay spoofs) and flips the flag deliberately. Turn
it on in a staging worker first, collect the new score distribution,
pick the new threshold, then roll both together.
"""
from __future__ import annotations

import os
from typing import List, Optional, Tuple

import cv2
import numpy as np


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# Read once at import. Behaviour-preserving default: OFF.
FAST_ROI_DEFAULT = _env_flag("FACE_LIVENESS_FAST_ROI", False)


def _face_roi(img_bgr: np.ndarray, face: Optional[dict]) -> np.ndarray:
    """Bbox crop as a *view* (no copy). Falls back to the full frame."""
    if not face:
        return img_bgr
    try:
        h, w = img_bgr.shape[:2]
        x0 = max(0, int(face["x"]))
        y0 = max(0, int(face["y"]))
        x1 = min(w, x0 + int(face["w"]))
        y1 = min(h, y0 + int(face["h"]))
    except (KeyError, TypeError, ValueError):
        return img_bgr
    if x1 - x0 < 2 or y1 - y0 < 2:
        return img_bgr
    return img_bgr[y0:y1, x0:x1]


def liveness_score(
    img_bgr: np.ndarray,
    landmarks: List[Tuple[float, float]],
    challenge: Optional[str],
    face: Optional[dict] = None,
    fast_roi: Optional[bool] = None,
) -> float:
    """0..1 score. Higher = more confident the face is live.

    `face` is the detector dict (x/y/w/h) and is only consulted when the
    ROI fast path is active. `fast_roi` overrides `FACE_LIVENESS_FAST_ROI`
    for a single call (used by tuning scripts to score the same frame
    both ways); leave it None in request handlers.
    """
    if img_bgr is None or img_bgr.size == 0:
        return 0.0

    use_fast = FAST_ROI_DEFAULT if fast_roi is None else bool(fast_roi)
    if use_fast:
        # Face rectangle only, and a float32 Laplacian accumulator.
        work = _face_roi(img_bgr, face)
        lap_depth = cv2.CV_32F
    else:
        # DEFAULT / production: unchanged full-frame CV_64F math.
        work = img_bgr
        lap_depth = cv2.CV_64F

    score = 0.0

    # 1. High-frequency content: pure printouts smooth out under Laplacian.
    #    `.var(dtype=np.float64)` keeps a float64 accumulator in both modes,
    #    so the default path is bit-identical to the pre-flag code and the
    #    fast path only loses precision in the buffer, not in the reduction.
    gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)
    lap_var = float(cv2.Laplacian(gray, lap_depth).var(dtype=np.float64))
    score += min(0.5, lap_var / 800.0)  # max +0.5

    # 2. Skin reflectance: live faces have small specular highlights;
    #    flat printed paper is uniformly lit. Use HSV-V std-dev as proxy.
    hsv = cv2.cvtColor(work, cv2.COLOR_BGR2HSV)
    v_std = float(np.std(hsv[:, :, 2]))
    score += min(0.3, v_std / 80.0)  # max +0.3

    # 3. Challenge geometry hint - lightweight, NOT a replacement for a
    #    real anti-spoof model. landmarks = [r_eye, l_eye, nose, r_mouth, l_mouth].
    #    Unaffected by the ROI flag: every test below is a RELATIVE distance
    #    between two landmarks, so full-frame coordinates are fine and must
    #    NOT be rebased onto the crop origin.
    if landmarks and len(landmarks) >= 5 and challenge:
        try:
            r_eye, l_eye, nose, r_mouth, l_mouth = landmarks[:5]
            face_w = max(1.0, abs(l_eye[0] - r_eye[0]))
            if challenge == "TURN_LEFT":
                mid_x = (r_eye[0] + l_eye[0]) * 0.5
                if nose[0] < mid_x - face_w * 0.1:
                    score += 0.2
            elif challenge == "TURN_RIGHT":
                mid_x = (r_eye[0] + l_eye[0]) * 0.5
                if nose[0] > mid_x + face_w * 0.1:
                    score += 0.2
            elif challenge == "BLINK":
                # Without temporal frames we can't truly check blink, so we
                # give a partial credit if eyes are visible at all. The
                # geometry test alone is weak; replace with a real model.
                score += 0.1
            elif challenge == "NOD":
                eye_y = (r_eye[1] + l_eye[1]) * 0.5
                if nose[1] - eye_y > face_w * 0.4:
                    score += 0.15
            elif challenge == "SMILE":
                mouth_w = abs(l_mouth[0] - r_mouth[0])
                if mouth_w > face_w * 0.6:
                    score += 0.15
        except Exception:
            pass

    return float(min(1.0, score))
