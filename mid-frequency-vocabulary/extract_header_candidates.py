from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image


UNIT_STARTS = {
    1: 167,
    2: 183,
    3: 199,
    4: 214,
    5: 231,
    6: 247,
    7: 263,
    8: 279,
    9: 296,
    10: 309,
    11: 320,
    12: 332,
}


def unit_for_pdf_page(page: int) -> int:
    selected = 1
    for unit, start in UNIT_STARTS.items():
        if page >= start:
            selected = unit
    return selected


def contiguous_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    padded = np.pad(mask.astype(np.int8), (1, 1))
    changes = np.diff(padded)
    starts = np.flatnonzero(changes == 1)
    ends = np.flatnonzero(changes == -1)
    return list(zip(starts.tolist(), ends.tolist()))


def header_bands(image_path: Path, threshold: float) -> list[tuple[int, int]]:
    gray = np.asarray(Image.open(image_path).convert("L"))
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

    bands: list[tuple[int, int]] = []
    for start, end in merged:
        run_height = end - start
        if 14 <= run_height <= 95 and start > round(height * 0.08) and end < round(height * 0.94):
            bands.append((start, end))
    return bands


def overlap(line: dict, band: tuple[int, int]) -> float:
    line_start = float(line["y"])
    line_end = line_start + float(line["height"])
    band_start, band_end = band
    intersection = max(0.0, min(line_end, band_end) - max(line_start, band_start))
    return intersection / max(1.0, line_end - line_start)


def page_number(path: Path) -> int:
    match = re.search(r"(\d+)$", path.stem)
    if not match:
        raise ValueError(f"No page number in {path.name}")
    return int(match.group(1))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--ocr", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--threshold", type=float, default=238)
    args = parser.parse_args()

    rows: list[dict] = []
    for image_path in sorted(args.images.glob("page-*.png"), key=page_number):
        page = page_number(image_path)
        ocr_path = args.ocr / f"{image_path.stem}.json"
        with ocr_path.open("r", encoding="utf-8-sig") as handle:
            ocr = json.load(handle)

        lines = ocr.get("lines", [])
        for band_index, band in enumerate(header_bands(image_path, args.threshold), start=1):
            matches = [line for line in lines if overlap(line, band) >= 0.35]
            matches.sort(key=lambda line: (line["y"], line["x"]))
            text = " ".join(line["text"].strip() for line in matches if line["text"].strip())
            rows.append(
                {
                    "pdf_page": page,
                    "printed_page": page - 11,
                    "unit": unit_for_pdf_page(page),
                    "band_index": band_index,
                    "band_y0": band[0],
                    "band_y1": band[1],
                    "text": text,
                    "line_count": len(matches),
                }
            )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"CANDIDATES={len(rows)}")


if __name__ == "__main__":
    main()
