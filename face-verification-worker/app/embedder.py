"""SFace embedding wrapper.

OpenCV ships a 128-D SFace ONNX model. Embeddings are L2-normalized so
cosine similarity reduces to a dot product on the Spring side.

Phase 2: swap to InsightFace/ArcFace once licensing is approved. The
Spring side stores model_name+model_version per template, so multiple
embedding spaces can coexist.
"""
from __future__ import annotations

import cv2
import numpy as np


class SFaceEmbedder:
    INPUT_SIZE = (112, 112)

    def __init__(self, model_path: str):
        # FaceRecognizerSF uses YuNet's landmark row to align the face before
        # producing the feature vector. Alignment is critical for identity
        # separation; raw resized crops are too noisy for production matching.
        self._recognizer = cv2.FaceRecognizerSF_create(model_path, "")

    def align_and_embed(self, img_bgr: np.ndarray, face: dict) -> np.ndarray:
        if img_bgr is None or img_bgr.size == 0:
            return np.zeros(128, dtype=np.float32)
        raw = np.asarray(face.get("raw"), dtype=np.float32)
        if raw.shape[0] < 15:
            return np.zeros(128, dtype=np.float32)
        aligned = self._recognizer.alignCrop(img_bgr, raw)
        return self.embed_aligned(aligned)

    def embed_aligned(self, aligned_bgr: np.ndarray) -> np.ndarray:
        if aligned_bgr is None or aligned_bgr.size == 0:
            return np.zeros(128, dtype=np.float32)
        if aligned_bgr.shape[:2] != self.INPUT_SIZE:
            aligned_bgr = cv2.resize(aligned_bgr, self.INPUT_SIZE)
        vec = self._recognizer.feature(aligned_bgr)
        v = vec.flatten().astype(np.float32)
        norm = float(np.linalg.norm(v))
        if norm > 0:
            v = v / norm
        return v
