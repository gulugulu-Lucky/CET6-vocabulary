from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path


def page_number(path: Path) -> int:
    match = re.search(r"(\d+)$", path.stem)
    if not match:
        raise ValueError(f"No page number in {path.name}")
    return int(match.group(1))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--deps", type=Path, required=True)
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--first", type=int)
    parser.add_argument("--last", type=int)
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

        result, elapsed = engine(str(image_path))
        rows = []
        for item in result or []:
            box, text, score = item
            rows.append({"box": box, "text": text, "score": score})

        payload = {
            "image": str(image_path.resolve()),
            "page": page_number(image_path),
            "elapsed": elapsed,
            "rows": rows,
        }
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"OCR {index}/{len(images)} {image_path.name} rows={len(rows)}", flush=True)

    print(f"OCR_COMPLETE={len(images)} SECONDS={time.monotonic() - started:.1f}")


if __name__ == "__main__":
    main()
