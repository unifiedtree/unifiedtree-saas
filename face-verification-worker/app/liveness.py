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
"""
from __future__ import annotations

from typing import List, Optional, Tuple

import cv2
import numpy as np


def liveness_score(
    img_bgr: np.ndarray,
    landmarks: List[Tuple[float, float]],
    challenge: Optional[str],
) -> float:
    """0..1 score. Higher = more confident the face is live."""
    if img_bgr is None or img_bgr.size == 0:
        return 0.0

    score = 0.0

    # 1. High-frequency content: pure printouts smooth out under Laplacian.
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    score += min(0.5, lap_var / 800.0)  # max +0.5

    # 2. Skin reflectance: live faces have small specular highlights;
    #    flat printed paper is uniformly lit. Use HSV-V std-dev as proxy.
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    v_std = float(np.std(hsv[:, :, 2]))
    score += min(0.3, v_std / 80.0)  # max +0.3

    # 3. Challenge geometry hint - lightweight, NOT a replacement for a
    #    real anti-spoof model. landmarks = [r_eye, l_eye, nose, r_mouth, l_mouth].
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
