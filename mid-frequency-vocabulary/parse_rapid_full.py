from __future__ import annotations

import argparse
import json
import re
from collections import Counter
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


def unit_for_page(page: int) -> int:
    return max(unit for unit, start in UNIT_STARTS.items() if page >= start)


def contiguous_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    padded = np.pad(mask.astype(np.int8), (1, 1))
    changes = np.diff(padded)
    return list(zip(np.flatnonzero(changes == 1), np.flatnonzero(changes == -1)))


def header_bands(image_path: Path, threshold: float) -> list[tuple[int, int]]:
    gray = np.asarray(Image.open(image_path).convert("L"))
    height, width = gray.shape
    medians = np.median(gray[:, round(width * 0.09) : round(width * 0.91)], axis=1)
    merged: list[list[int]] = []
    for start, end in contiguous_runs(medians < threshold):
        if merged and start - merged[-1][1] <= 5:
            merged[-1][1] = int(end)
        else:
            merged.append([int(start), int(end)])
    return [
        (start, end)
        for start, end in merged
        if 14 <= end - start <= 95
        and start > round(height * 0.02)
        and end < round(height * 0.94)
    ]


def bounds(row: dict) -> tuple[float, float, float, float]:
    xs = [float(point[0]) for point in row["box"]]
    ys = [float(point[1]) for point in row["box"]]
    return min(xs), min(ys), max(xs), max(ys)


def row_overlaps_band(row: dict, band: tuple[int, int]) -> bool:
    _, y0, _, y1 = bounds(row)
    b0, b1 = band
    intersection = max(0.0, min(y1, b1 + 6) - max(y0, b0 - 6))
    return intersection / max(1.0, y1 - y0) >= 0.35


def clean_headword(text: str) -> str:
    text = re.sub(r"^[^A-Za-z]+|[^A-Za-z'-]+$", "", text.strip().replace("’", "'"))
    return re.sub(r"\s+", "", text)


def contains_chinese(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text))


def looks_like_headword(text: str) -> bool:
    normalized = text.strip()
    return bool(re.fullmatch(r"[A-Za-z][A-Za-z' -]*", normalized)) and len(normalized.split()) <= 2


def parse_band(rows: list[dict]) -> tuple[dict | None, str]:
    rows = sorted(rows, key=lambda row: (bounds(row)[0], bounds(row)[1]))
    texts = [row.get("text", "").strip() for row in rows if row.get("text", "").strip()]
    if not texts:
        return None, "no_ocr_rows"

    if len(texts) >= 2 and looks_like_headword(texts[0]):
        word = clean_headword(texts[0])
        detail = " ".join(texts[1:]).strip()
        if word and contains_chinese(detail):
            return {
                "word_raw": texts[0],
                "word": word,
                "detail_raw": detail,
                "score_word": rows[0].get("score"),
                "score_detail": min(row.get("score", 1.0) for row in rows[1:]),
            }, "accepted_split"

    combined = " ".join(texts)
    match = re.match(r"^[^A-Za-z]*([A-Za-z][A-Za-z'-]{1,30})\s*([\[\(].+)$", combined)
    if match and contains_chinese(match.group(2)):
        return {
            "word_raw": match.group(1),
            "word": clean_headword(match.group(1)),
            "detail_raw": match.group(2).strip(),
            "score_word": min(row.get("score", 1.0) for row in rows),
            "score_detail": min(row.get("score", 1.0) for row in rows),
        }, "accepted_combined"

    return None, "not_headword_shape"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--ocr", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rejected", type=Path, required=True)
    parser.add_argument("--threshold", type=float, default=242)
    args = parser.parse_args()

    accepted: list[dict] = []
    rejected: list[dict] = []
    for ocr_path in sorted(args.ocr.glob("page-*.json")):
        payload = json.loads(ocr_path.read_text(encoding="utf-8"))
        page = int(payload["page"])
        image_path = args.images / f"page-{page}.png"
        rows = payload.get("rows", [])
        for band_index, band in enumerate(header_bands(image_path, args.threshold), start=1):
            band_rows = [row for row in rows if row_overlaps_band(row, band)]
            parsed, reason = parse_band(band_rows)
            base = {
                "pdf_page": page,
                "printed_page": page - 11,
                "unit": unit_for_page(page),
                "band_index": band_index,
                "band_y0": band[0],
                "band_y1": band[1],
                "reason": reason,
            }
            if parsed:
                accepted.append({**base, **parsed})
            else:
                rejected.append({**base, "rows": [row.get("text", "") for row in band_rows]})

    args.output.write_text(json.dumps(accepted, ensure_ascii=False, indent=2), encoding="utf-8")
    args.rejected.write_text(json.dumps(rejected, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"ACCEPTED={len(accepted)} REJECTED={len(rejected)}")
    print("BY_UNIT=" + json.dumps(Counter(row["unit"] for row in accepted), sort_keys=True))


if __name__ == "__main__":
    main()
