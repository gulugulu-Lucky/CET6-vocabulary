from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEPS = ROOT / ".deps"
if DEPS.exists():
    sys.path.insert(0, str(DEPS))

import eng_to_ipa as eng_ipa  # type: ignore  # noqa: E402


MANUAL_ENTRIES = [
    {
        "pdf_page": 206,
        "printed_page": 195,
        "unit": 3,
        "band_y0": 1690,
        "word": "democracy",
        "detail_raw": "n. [U] 民主",
        "source_note": "原页视觉复核：OCR 漏检",
    },
    {
        "pdf_page": 312,
        "printed_page": 301,
        "unit": 10,
        "band_y0": 580,
        "word": "drill",
        "detail_raw": "v. 钻（孔） n. [C] 钻；[C, U] 训练",
        "source_note": "原页视觉复核：OCR 漏检",
    },
    {
        "pdf_page": 312,
        "printed_page": 301,
        "unit": 10,
        "band_y0": 2010,
        "word": "gamble",
        "detail_raw": "v. 赌博；以……为赌注；冒险",
        "source_note": "原页视觉复核：OCR 漏检",
    },
]


# Only clear OCR defects are corrected here.  Wording otherwise follows the book.
MEANING_OVERRIDES = {
    "glacier": "n. [C] 冰川；冰河",
    "partner": "n. [C] 搭档；配偶；合伙人\nvt. 与……搭档",
    "layer": "n. [C] 层；层次\nvt. 把……分层堆放",
    "conservative": "adj. 保守的；守旧的；传统的；[C-] 保守党的",
    "consent": "n. [U] 同意\nvi. 同意",
    "overwhelm": "vt. 淹没；征服；压垮",
    "corner": "n. [C] 角落；街角\nvt. 逼……入绝境",
    "versus": "prep. 对抗；与……相对；与……相比",
    "orthodox": "adj. 正统的；传统的；[O-] 东正教的",
    "obsess": "vt. 使着迷；使迷恋；使痴迷\nvi. 唠叨",
    "vicious": "adj. 凶残的；恶劣的；严厉的",
    "conscientious": "adj. 认真的；一丝不苟的",
    "incur": "vt. 遭受；引起",
    "tempt": "vt. 引诱，诱惑，利诱；鼓动",
    "contempt": "n. [U] 蔑视，藐视，轻蔑，轻视",
    "glance": "n. [C] 一瞥\nvi. 瞥，看一眼",
    "amass": "vt. 积累，积聚",
    "conducive": "adj. 有助（于……）的，有益（于……）的",
    "aboard": "adv. prep. 上船（飞机、火车）",
    "allure": "n. [U] 吸引力，魅力，诱惑",
    "align": "v. 对准\nvt. 使一致；与……结盟",
    "pending": "adj. 待定的；即将发生的\nprep. 在等待……时期",
    "impress": "v. 给……留下深刻印象\nvt. 使意识到",
    "depress": "vt. 使沮丧；降低；抑制，使不景气",
    "portion": "n. [C] 部分；一份",
    "violent": "adj. 暴力的；凶暴的；猛烈的",
    "turbulent": "adj. 动荡的；汹涌的",
    "elicit": "vt. 引出；套出；引起",
    "compassion": "n. [U] 同情；怜悯",
    "foretell": "vt. 预言，预知；预测",
    "besides": "adv. 况且\nprep. 除……之外",
    "alongside": "adv. prep. 在……旁边；与……并肩",
    "dub": "vt. 把……称作；译制；配音",
    "border": "n. [C] 边界\nv. 与……毗邻",
    "denounce": "vt. 谴责，斥责；告发",
    "deter": "v. 制止，阻止；威慑",
    "uphold": "vt. 支持；维护",
    "dwell": "vi. 居住；沉湎于；细想",
    "grim": "adj. 严峻的；令人沮丧的；凄凉的",
    "boast": "v. 吹嘘\nvt. 有\nn. [C] 夸耀；引以为自豪的事情",
    "creep": "vi. 爬行；蹑手蹑脚地移动；悄悄地缓慢行进；巴结",
    "hail": "v. 称赞；叫（出租车）\nn. [U] 冰雹",
    "jail": "n. [C, U] 监狱\nv. 监禁",
    "shock": "n. [常用 sing., U] 震惊；[U] 休克\nvt. 使震惊",
    "zip": "n. [C] 拉链\nvt. 拉上……的拉链\nvi. 快速移动",
    "dwarf": "n. [C] 小矮人；侏儒\nadj. 矮小的\nvt. 使相形见绌",
    "hurricane": "n. [C] 飓风",
    "spark": "n. [C] 火花\nvt. 引发，触发\nvi. 冒火花",
    "lure": "n. [常用 sing.] 诱惑力\nvt. 诱惑，引诱；吸引",
    "wrap": "vt. 包；用……包裹\nv. （使文字）换行",
    "axe": "（亦作 ax）\nn. [C] 斧；[sing.] [the ~] 倒闭\nvt. 削减；开除",
    "lounge": "n. [C] 候机厅；客厅\nvi. （懒洋洋地）坐",
    "cuisine": "n. [C, U] 风味；菜肴",
    "hook": "n. [C] 钩\nv. 钩住，挂住",
    "bruise": "v. （使）碰伤\nvt. 挫伤\nn. [C] 淤伤",
}


IPA_OVERRIDES = {
    "well-off": "ˌwɛlˈɔf",
    "second-hand": "ˌsɛkəndˈhænd",
    "flavour": "ˈfleɪvər",
}


POS_RE = re.compile(r"(?<![A-Za-z])(vt|vi|v|n|adj|adv|prep|conj|pron|num|int)\.")
RAW_POS_RE = re.compile(r"(?<![A-Za-z])(vt|vi|ad|prep|conj|pron|num|int|v|n|a)\.?(?=\s*(?:\[|[\u3400-\u9fff（]))")


def clean_meaning(word: str, raw: str) -> str:
    if word in MEANING_OVERRIDES:
        return MEANING_OVERRIDES[word]

    text = raw.strip()
    # Remove the book's OCRed pronunciation; final IPA comes from a dictionary.
    text = re.sub(r"^\s*[A-Za-z]?\[[^\]]{1,50}\]\s*", "", text)
    text = re.sub(
        r"\[[^\]\u3400-\u9fff]{2,35}\](?=\s*(?:vt|vi|v|n|a|ad|prep|conj|pron|num|int)\.?)",
        "",
        text,
    )
    text = text.replace("vu.", "vt.").replace("vu ", "vt. ")
    text = text.replace("丨", "").replace("|", "").replace(";", "；")
    text = text.replace("，U", ", U").replace("， U", ", U")

    def add_dot(match: re.Match[str]) -> str:
        token = match.group(1)
        return token + "."

    text = RAW_POS_RE.sub(add_dot, text)
    text = re.sub(r"(?<![A-Za-z])ad\.", "adv.", text)
    text = re.sub(r"(?<![A-Za-z])a\.", "adj.", text)
    text = re.sub(r"\b(vt|vi|v|n|adj|adv|prep|conj|pron|num|int)\.{2,}", r"\1.", text)
    text = re.sub(r"\s*([；，])\s*", r"\1", text)
    text = re.sub(r"[.·…]{2,}", "……", text)
    text = re.sub(r"(?<!…)…(?!…)", "……", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(
        r"(?<!^)(?<![A-Za-z])\s*((?:vt|vi|v|n|adj|adv|prep|conj|pron|num|int)\.)",
        r"\n\1",
        text,
    )
    text = re.sub(r"((?:vt|vi|v|n|adj|adv|prep|conj|pron|num|int)\.)\s*", r"\1 ", text)
    return text.strip()


def get_ipa(word: str) -> str:
    converted = IPA_OVERRIDES.get(word, eng_ipa.convert(word)).strip()
    if not converted or "*" in converted:
        raise ValueError(f"No verified IPA for {word!r}: {converted!r}")
    return f"/{converted}/"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--accepted",
        type=Path,
        default=ROOT / "tmp" / "rapid-full-accepted.json",
    )
    parser.add_argument("--output-dir", type=Path, default=ROOT)
    args = parser.parse_args()

    source = json.loads(args.accepted.read_text(encoding="utf-8"))
    source.extend(MANUAL_ENTRIES)
    source.sort(key=lambda row: (int(row["pdf_page"]), int(row["band_y0"])))

    rows: list[dict] = []
    unit_sequences: Counter[int] = Counter()
    for item in source:
        unit = int(item["unit"])
        unit_sequences[unit] += 1
        word = item["word"].strip()
        meaning = clean_meaning(word, item["detail_raw"])
        pos_values = []
        for value in POS_RE.findall(meaning):
            if value not in pos_values:
                pos_values.append(value)
        if not pos_values:
            raise ValueError(f"No part of speech parsed for {word}: {meaning}")
        rows.append(
            {
                "unit": unit,
                "unit_sequence": unit_sequences[unit],
                "word": word,
                "ipa": get_ipa(word),
                "pos": "; ".join(f"{value}." for value in pos_values),
                "meaning": meaning,
                "printed_page": int(item["printed_page"]),
                "pdf_page": int(item["pdf_page"]),
                "source_note": item.get("source_note", "OCR 后按页脚词序核对"),
            }
        )

    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "middle-frequency-vocabulary.json"
    json_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

    csv_path = output_dir / "中频词汇标准词表.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "Unit编号",
                "单元内序号",
                "英文单词",
                "标准音标",
                "词性",
                "中文释义",
                "原书印刷页码",
                "PDF页码",
            ]
        )
        for row in rows:
            writer.writerow(
                [
                    row["unit"],
                    row["unit_sequence"],
                    row["word"],
                    row["ipa"],
                    row["pos"],
                    row["meaning"],
                    row["printed_page"],
                    row["pdf_page"],
                ]
            )

    web_data: dict[str, list[dict]] = {}
    for row in rows:
        web_data.setdefault(f"Unit {row['unit']}", []).append(
            {
                "word": row["word"],
                "meaning": row["meaning"],
                "ipa": row["ipa"],
                "printedPage": row["printed_page"],
                "pdfPage": row["pdf_page"],
            }
        )
    js_path = output_dir / "middle-frequency-data.js"
    js_path.write_text(
        "// Generated from the verified middle-frequency vocabulary table.\n"
        + "const DATA = "
        + json.dumps(web_data, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )

    counts = Counter(row["unit"] for row in rows)
    print(f"TOTAL={len(rows)}")
    print("UNIT_COUNTS=" + json.dumps(dict(sorted(counts.items())), ensure_ascii=False))
    print(f"CSV={csv_path}")
    print(f"JSON={json_path}")
    print(f"JS={js_path}")


if __name__ == "__main__":
    main()
