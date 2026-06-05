# syntax=docker/dockerfile:1.6
#
# UnifiedTree face-verification worker.
# CPU-only image. For GPU swap onnxruntime -> onnxruntime-gpu and add CUDA base.

FROM python:3.11-slim AS base
WORKDIR /worker

# OpenCV runtime deps for opencv-python-headless
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
# Download ONNX models directly into the image for Railway deployment
RUN mkdir -p /worker/models && \
    apt-get update && apt-get install -y curl && \
    curl -L -o /worker/models/face_detection_yunet_2023mar.onnx https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx && \
    curl -L -o /worker/models/face_recognition_sface_2021dec.onnx https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

EXPOSE 8091
ENV FACE_MODEL_DIR=/worker/models
ENV LOG_LEVEL=INFO

# Workers default to 1 to keep cold-start memory low; tune via env.
CMD sh -c "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8091} --workers 1"
