"""Simple async load test for the face worker.

Posts the same dummy image N times to /face/quality with the given
concurrency, then prints p50/p95/p99 and error rate.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import statistics
import time
from pathlib import Path

import httpx


def load_image(path: str) -> str:
    if not Path(path).exists():
        # Fall back: a 64x64 grey JPEG built in-memory.
        import cv2  # noqa: WPS433
        import numpy as np  # noqa: WPS433

        img = (np.ones((64, 64, 3), dtype="uint8") * 127)
        ok, buf = cv2.imencode(".jpg", img)
        if not ok:
            raise RuntimeError("cv2.imencode failed")
        return base64.b64encode(buf.tobytes()).decode("ascii")
    return base64.b64encode(Path(path).read_bytes()).decode("ascii")


async def one(client: httpx.AsyncClient, url: str, body: dict) -> tuple[bool, float]:
    t0 = time.monotonic()
    try:
        r = await client.post(url, json=body, timeout=10.0)
        dt = time.monotonic() - t0
        return (r.status_code == 200, dt * 1000.0)
    except Exception:  # noqa: BLE001
        dt = time.monotonic() - t0
        return (False, dt * 1000.0)


async def main(args: argparse.Namespace) -> None:
    image_b64 = load_image(args.image)
    body = {"imageBase64": image_b64}
    sem = asyncio.Semaphore(args.concurrency)

    async with httpx.AsyncClient() as client:
        async def task() -> tuple[bool, float]:
            async with sem:
                return await one(client, f"{args.url}/face/quality", body)

        t0 = time.monotonic()
        results = await asyncio.gather(*(task() for _ in range(args.n)))
        wall = time.monotonic() - t0

    latencies = [ms for _, ms in results]
    ok_count = sum(1 for ok, _ in results if ok)
    p50 = statistics.median(latencies)
    p95 = statistics.quantiles(latencies, n=20)[-1] if len(latencies) >= 20 else max(latencies)
    p99 = statistics.quantiles(latencies, n=100)[-1] if len(latencies) >= 100 else max(latencies)

    print(f"requests       : {args.n}")
    print(f"concurrency    : {args.concurrency}")
    print(f"wall time      : {wall:.2f} s")
    print(f"throughput     : {args.n / wall:.1f} req/s")
    print(f"success rate   : {ok_count / args.n * 100:.1f} %")
    print(f"latency p50    : {p50:.1f} ms")
    print(f"latency p95    : {p95:.1f} ms")
    print(f"latency p99    : {p99:.1f} ms")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="http://localhost:8091")
    p.add_argument("--n", type=int, default=100)
    p.add_argument("--concurrency", type=int, default=8)
    p.add_argument("--image", default="")
    asyncio.run(main(p.parse_args()))
