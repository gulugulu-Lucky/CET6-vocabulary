from __future__ import annotations

import csv
import json
import re
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VOCAB_DIR = ROOT / "mid-frequency-vocabulary"
EXPECTED_COUNTS = {
    1: 84,
    2: 85,
    3: 84,
    4: 85,
    5: 85,
    6: 85,
    7: 84,
    8: 85,
    9: 78,
    10: 81,
    11: 84,
    12: 85,
}
EXPECTED_STARTS = {
    1: 156,
    2: 172,
    3: 188,
    4: 203,
    5: 220,
    6: 236,
    7: 252,
    8: 268,
    9: 285,
    10: 298,
    11: 309,
    12: 321,
}


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"PASS {message}")


def main() -> None:
    pdf = ROOT / "六级词汇闪过.pdf"
    json_path = VOCAB_DIR / "middle-frequency-vocabulary.json"
    csv_path = VOCAB_DIR / "中频词汇标准词表.csv"
    js_path = VOCAB_DIR / "middle-frequency-data.js"
    page_path = ROOT / "source-pages" / "cet6-middle-frequency.html"
    reference_path = ROOT / "source-pages" / "cet6-flash-original.html"

    check(pdf.exists() and pdf.stat().st_size > 0, "原书 PDF 存在且可读取")
    rows = json.loads(json_path.read_text(encoding="utf-8"))
    check(len(rows) == 1005, "标准 JSON 总数为 1005")

    counts = Counter(int(row["unit"]) for row in rows)
    check(dict(sorted(counts.items())) == EXPECTED_COUNTS, "12 个 Unit 词数符合核对结果")
    check(set(counts) == set(range(1, 13)), "Unit 编号完整为 1–12")

    for unit in range(1, 13):
        unit_rows = [row for row in rows if int(row["unit"]) == unit]
        sequences = [int(row["unit_sequence"]) for row in unit_rows]
        check(sequences == list(range(1, len(unit_rows) + 1)), f"Unit {unit} 单元内序号连续")
        check(unit_rows[0]["printed_page"] == EXPECTED_STARTS[unit], f"Unit {unit} 起始印刷页正确")
        check(
            [int(row["pdf_page"]) for row in unit_rows]
            == sorted(int(row["pdf_page"]) for row in unit_rows),
            f"Unit {unit} PDF 页码顺序单调",
        )

    check(min(row["printed_page"] for row in rows) == 156, "提取范围起于印刷页 156")
    check(max(row["printed_page"] for row in rows) == 332, "提取范围止于印刷页 332")
    check(
        all(int(row["pdf_page"]) - int(row["printed_page"]) == 11 for row in rows),
        "PDF 页码与印刷页码偏移统一为 +11",
    )

    words = [row["word"].casefold() for row in rows]
    check(len(words) == len(set(words)), "词表不存在重复词")
    required = ("word", "ipa", "pos", "meaning", "printed_page", "pdf_page")
    check(all(all(row.get(field) not in (None, "") for field in required) for row in rows), "所有必填字段非空")
    check(all(re.fullmatch(r"/.+/", row["ipa"]) for row in rows), "所有音标均使用 /…/ 格式")
    check(all("*" not in row["ipa"] for row in rows), "音标中不存在未解析标记")
    check(
        all(not any(char in row["meaning"] for char in ("�", "|", "丨")) for row in rows),
        "释义中不存在替换符或 OCR 竖线残留",
    )

    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        csv_rows = list(csv.DictReader(handle))
    check(len(csv_rows) == len(rows), "CSV 行数与标准 JSON 一致")
    check(
        [row["英文单词"] for row in csv_rows] == [row["word"] for row in rows],
        "CSV 单词顺序与标准 JSON 一致",
    )

    js_text = js_path.read_text(encoding="utf-8")
    match = re.fullmatch(r"//[^\n]+\nconst DATA = (.*);\n", js_text, re.DOTALL)
    check(match is not None, "网页数据文件结构有效")
    web_data = json.loads(match.group(1))
    check(list(web_data) == [f"Unit {number}" for number in range(1, 13)], "网页数据包含顺序正确的 12 个 Unit")
    check(sum(len(items) for items in web_data.values()) == len(rows), "网页载入词数与标准词表一致")
    check(
        [item["word"] for items in web_data.values() for item in items] == [row["word"] for row in rows],
        "网页单词顺序与标准词表一致",
    )

    page = page_path.read_text(encoding="utf-8")
    reference = reference_path.read_text(encoding="utf-8")
    reference_style = re.search(r"<style>(.*?)</style>", reference, re.DOTALL).group(1)
    page_style = re.search(r"<style>(.*?)</style>", page, re.DOTALL).group(1)
    check(page_style == reference_style, "中频词页面 CSS 与高频词参考页完全一致")
    check("../mid-frequency-vocabulary/middle-frequency-data.js" in page, "中频词页面使用独立数据文件")
    check("cet6_middle_frequency_resume_v1" in page, "中频词恢复位置使用独立 localStorage 键")
    check("cet6_middle_frequency_progress_v1_" in page, "中频词学习记录使用独立 localStorage 键")
    forbidden = (
        "cet6_resume_position_v1",
        "cet6_flash_733_audio_ipa_fixed_",
        "migratePdfAlignmentV1",
        "ALIGNMENT_MIGRATION_KEY",
    )
    check(all(token not in page for token in forbidden), "中频词页面未沿用高频词键或迁移逻辑")
    control_ids = (
        "unitSelect",
        "shuffleBtn",
        "resetBtn",
        "card",
        "meaning",
        "ipa",
        "noBtn",
        "yesBtn",
        "prevBtn",
        "inlineSoundBtn",
    )
    check(all(f'id="{control_id}"' in page for control_id in control_ids), "高频词页的核心控件均已保留")

    index = (ROOT / "index.html").read_text(encoding="utf-8")
    check("source-pages/cet6-middle-frequency.html" in index, "首页存在中频词入口")
    existing = (
        ROOT / "source-pages" / "cet6-flash-original.html",
        ROOT / "手写单词本_179词_刷词网页_词义核对修正版.html",
        ROOT / "阅读重点词_28词_刷词网页(1).html",
    )
    check(all(path.exists() and path.stat().st_size > 0 for path in existing), "原有三个刷词网页文件仍存在")

    print("SUMMARY all static checks passed")


if __name__ == "__main__":
    main()
