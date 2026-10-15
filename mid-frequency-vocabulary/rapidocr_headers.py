from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image


def page_number(path: Path) -> int:
    match = re.search(r"(\d+)$", path.stem)
    if not match:
        raise ValueError(f"No page number in {path.name}")
    return int(match.group(1))


def contiguous_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    padded = np.pad(mask.astype(np.int8), (1, 1))
    changes = np.diff(padded)
    starts = np.flatnonzero(changes == 1)
    ends = np.flatnonzero(changes == -1)
    return list(zip(starts.tolist(), ends.tolist()))


def header_bands(
    image: np.ndarray,
    threshold: float,
    min_y_fraction: float,
    max_y_fraction: float,
) -> list[tuple[int, int]]:
    gray = np.asarray(Image.fromarray(image).convert("L"))
    height, width = gray.shape
    x0 = round(width * 0.09)
    x1 = round(width * 0.91)
    medians = np.median(gray[:, x0:x1], axis=1)
    raw_runs = contiguous_runs(medians < threshold)

    merged: list[list[int]] = []
    for start, end in raw_runs:
        if merged and start - merged[-1][1] <= 5:
            merged[-1][1] = end
        else:
            merged.append([start, end])

    return [
        (start, end)
        for start, end in merged
        if 14 <= end - start <= 95
        and start > round(height * min_y_fraction)
        and end < round(height * max_y_fraction)
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--deps", type=Path, required=True)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--first", type=int)
    parser.add_argument("--last", type=int)
    parser.add_argument("--threshold", type=float, default=242)
    parser.add_argument("--min-y-fraction", type=float, default=0.08)
    parser.add_argument("--max-y-fraction", type=float, default=0.94)
    args = parser.parse_args()

    sys.path.insert(0, str(args.deps.resolve()))
    from rapidocr_onnxruntime import RapidOCR

    engine = RapidOCR()
    args.output.mkdir(parents=True, exist_ok=True)
    images = sorted(args.images.glob("page-*.png"), key=page_number)
    if args.first is not None:
        images = [path for path in images if page_number(path) >= args.first]
    if args.last is not None:
        images = [path for path in images if page_number(path) <= args.last]

    started = time.monotonic()
    for index, image_path in enumerate(images, start=1):
        output_path = args.output / f"{image_path.stem}.json"
        if output_path.exists():
            continue

        image = np.asarray(Image.open(image_path).convert("RGB"))
        height, width = image.shape[:2]
        x0 = round(width * 0.08)
        x1 = round(width * 0.92)
        page_rows = []
        for band_index, (y0, y1) in enumerate(
            header_bands(image, args.threshold, args.min_y_fraction, args.max_y_fraction),
            start=1,
        ):
            top = max(0, y0 - 8)
            bottom = min(height, y1 + 8)
            crop = image[top:bottom, x0:x1]
            result, elapsed = engine(crop)
            rows = []
            for item in result or []:
                box, text, score = item
                rows.append({"box": box, "text": text, "score": score})
            page_rows.append(
                {
                    "band_index": band_index,
                    "y0": y0,
                    "y1": y1,
                    "elapsed": elapsed,
                    "rows": rows,
                }
            )

        payload = {
            "image": str(image_path.resolve()),
            "page": page_number(image_path),
            "threshold": args.threshold,
            "bands": page_rows,
        }
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"OCR {index}/{len(images)} {image_path.name} bands={len(page_rows)}", flush=True)

    print(f"OCR_COMPLETE={len(images)} SECONDS={time.monotonic() - started:.1f}")


if __name__ == "__main__":
    main()
