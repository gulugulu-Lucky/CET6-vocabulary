from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path


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


def clean_headword(text: str) -> str:
    text = text.strip().replace("’", "'")
    text = re.sub(r"^[^A-Za-z]+|[^A-Za-z'-]+$", "", text)
    return re.sub(r"\s+", "", text)


def contains_chinese(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text))


def looks_like_headword_row(text: str) -> bool:
    normalized = text.strip()
    if not re.fullmatch(r"[A-Za-z][A-Za-z' -]*", normalized):
        return False
    return len(normalized.split()) <= 2


def parse_band(band: dict) -> tuple[dict | None, str]:
    rows = [row for row in band.get("rows", []) if row.get("text", "").strip()]
    if not rows:
        return None, "no_ocr_rows"

    texts = [row["text"].strip() for row in rows]
    if len(rows) >= 2 and looks_like_headword_row(texts[0]):
        headword = clean_headword(texts[0])
        detail = " ".join(texts[1:]).strip()
        if headword and contains_chinese(detail):
            return {
                "word_raw": texts[0],
                "word": headword,
                "detail_raw": detail,
                "score_word": rows[0].get("score"),
                "score_detail": min(row.get("score", 1.0) for row in rows[1:]),
            }, "accepted_split"

    combined = " ".join(texts)
    match = re.match(r"^[^A-Za-z]*([A-Za-z][A-Za-z'-]{1,30})\s+([\[\(].+)$", combined)
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
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rejected", type=Path, required=True)
    args = parser.parse_args()

    accepted: list[dict] = []
    rejected: list[dict] = []
    for path in sorted(args.input.glob("page-*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        page = int(payload["page"])
        for band in payload.get("bands", []):
            parsed, reason = parse_band(band)
            base = {
                "pdf_page": page,
                "printed_page": page - 11,
                "unit": unit_for_page(page),
                "band_index": band.get("band_index"),
                "band_y0": band.get("y0"),
                "band_y1": band.get("y1"),
                "reason": reason,
            }
            if parsed:
                accepted.append({**base, **parsed})
            else:
                rejected.append(
                    {
                        **base,
                        "rows": [row.get("text", "") for row in band.get("rows", [])],
                    }
                )

    args.output.write_text(json.dumps(accepted, ensure_ascii=False, indent=2), encoding="utf-8")
    args.rejected.write_text(json.dumps(rejected, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"ACCEPTED={len(accepted)} REJECTED={len(rejected)}")
    print("BY_UNIT=" + json.dumps(Counter(row["unit"] for row in accepted), sort_keys=True))


if __name__ == "__main__":
    main()
