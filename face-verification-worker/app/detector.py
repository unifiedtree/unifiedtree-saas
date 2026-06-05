"""YuNet face detection wrapper.

OpenCV ships an out-of-the-box YuNet model at
opencv_zoo/models/face_detection_yunet/. Download the .onnx file once and
point FACE_MODEL_DIR at it. The detector returns one rectangle + 5
landmarks per face: right_eye, left_eye, nose, right_mouth, left_mouth.
"""
from __future__ import annotations

from typing import List, Tuple

import cv2
import numpy as np


class YuNetDetector:
    INPUT_SIZE = (320, 320)
    SCORE_THRESHOLD = 0.7
    NMS_THRESHOLD = 0.3
    TOP_K = 5

    def __init__(self, model_path: str):
        # OpenCV's FaceDetectorYN loads ONNX directly.
        self._detector = cv2.FaceDetectorYN_create(
            model_path,
            "",
            self.INPUT_SIZE,
            self.SCORE_THRESHOLD,
            self.NMS_THRESHOLD,
            self.TOP_K,
        )

    def detect(self, img_bgr: np.ndarray) -> List[dict]:
        h, w = img_bgr.shape[:2]
        self._detector.setInputSize((w, h))
        _, raw = self._detector.detect(img_bgr)
        out: List[dict] = []
        if raw is None:
            return out
        for row in raw:
            x, y, fw, fh = row[0:4]
            landmarks = row[4:14].reshape(5, 2)  # 5 points (x, y)
            confidence = float(row[14])
            out.append({
                "x": float(x), "y": float(y), "w": float(fw), "h": float(fh),
                "landmarks": landmarks.astype(float).tolist(),
                "confidence": confidence,
                # Keep YuNet's original 15-value row. SFace alignCrop expects
                # this exact detector output, including landmarks and score.
                "raw": row.astype(float).tolist(),
            })
        return out

    def crop_and_landmarks(
        self, img_bgr: np.ndarray, face: dict
    ) -> Tuple[np.ndarray, List[Tuple[float, float]]]:
        x, y, w, h = int(face["x"]), int(face["y"]), int(face["w"]), int(face["h"])
        # Clamp to image bounds.
        H, W = img_bgr.shape[:2]
        x0 = max(0, x); y0 = max(0, y)
        x1 = min(W, x + w); y1 = min(H, y + h)
        roi = img_bgr[y0:y1, x0:x1].copy()
        landmarks = [(float(lx), float(ly)) for lx, ly in face["landmarks"]]
        return roi, landmarks
