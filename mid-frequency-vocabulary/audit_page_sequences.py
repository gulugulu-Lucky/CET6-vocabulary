from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path


def bounds(row: dict) -> tuple[float, float, float, float]:
    xs = [float(point[0]) for point in row["box"]]
    ys = [float(point[1]) for point in row["box"]]
    return min(xs), min(ys), max(xs), max(ys)


def normalize_word(text: str) -> str:
    return re.sub(r"[^A-Za-z'-]", "", text).lower()


def footer_words(payload: dict, page_height: float = 2496.0) -> list[str]:
    candidates = []
    for row in payload.get("rows", []):
        x0, y0, x1, y1 = bounds(row)
        if not page_height * 0.87 <= y0 <= page_height * 0.95:
            continue
        text = row.get("text", "").strip()
        if not re.fullmatch(r"[A-Za-z][A-Za-z' -]*", text):
            continue
        pieces = [normalize_word(piece) for piece in text.split()]
        pieces = [piece for piece in pieces if len(piece) >= 2]
        if not pieces:
            continue
        candidates.append({"x": x0, "y": y0, "words": pieces})

    if not candidates:
        return []

    # Most pages use one footer row; later units use two.  Group nearby rows,
    # preserve top-to-bottom / left-to-right order, and exclude the page number.
    footer_rows = [item for item in candidates if item["y"] < page_height * 0.945]
    y_levels: list[float] = []
    for item in sorted(footer_rows, key=lambda value: value["y"]):
        if not y_levels or abs(item["y"] - y_levels[-1]) > 18:
            y_levels.append(item["y"])

    result = []
    for level in y_levels:
        row = [item for item in footer_rows if abs(item["y"] - level) <= 18]
        for item in sorted(row, key=lambda value: value["x"]):
            result.extend(item["words"])
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--accepted", type=Path, required=True)
    parser.add_argument("--ocr", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    accepted = json.loads(args.accepted.read_text(encoding="utf-8"))
    by_page: dict[int, list[dict]] = {}
    for row in accepted:
        by_page.setdefault(int(row["pdf_page"]), []).append(row)
    for rows in by_page.values():
        rows.sort(key=lambda row: row.get("band_y0", row.get("unit_sequence", 0)))

    audit = []
    for path in sorted(args.ocr.glob("page-*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        page = int(payload["page"])
        footers = footer_words(payload)
        headers = [normalize_word(row["word"]) for row in by_page.get(page, [])]
        audit.append(
            {
                "pdf_page": page,
                "printed_page": page - 11,
                "footer_count": len(footers),
                "header_count": len(headers),
                "footer_words": footers,
                "header_words": headers,
                "exact_match": footers == headers,
            }
        )

    args.output.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"PAGES={len(audit)} FOOTER_TOTAL={sum(row['footer_count'] for row in audit)} HEADER_TOTAL={sum(row['header_count'] for row in audit)}")
    print("MISMATCH_PAGES=" + str(sum(not row["exact_match"] for row in audit)))
    print("FOOTER_COUNTS=" + json.dumps(Counter(row["footer_count"] for row in audit), sort_keys=True))


if __name__ == "__main__":
    main()
