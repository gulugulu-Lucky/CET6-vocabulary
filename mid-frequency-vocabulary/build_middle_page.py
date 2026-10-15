from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source-pages" / "cet6-flash-original.html"
TARGET = ROOT / "source-pages" / "cet6-middle-frequency.html"


def main() -> None:
    html = SOURCE.read_text(encoding="utf-8")
    html = html.replace(
        "<title>六级词汇闪过｜前两单元已核对版</title>",
        "<title>六级词汇闪过｜中频词</title>",
        1,
    )

    data_start = html.index("const DATA =")
    logic_start = html.index("let currentUnit = Object.keys(DATA)[0];", data_start)
    prefix = html[:data_start]
    logic = html[logic_start:]

    # This high-frequency-only migration rewrites legacy progress and must never
    # run against the independent middle-frequency store.
    migration_start = logic.index("const ALIGNMENT_BACKUP_KEY")
    migration_end = logic.index("function findCurrentPositionByWord")
    logic = logic[:migration_start] + logic[migration_end:]
    logic = logic.replace("migratePdfAlignmentV1();\n", "", 1)

    logic = logic.replace(
        "const RESUME_KEY = 'cet6_resume_position_v1';",
        "const RESUME_KEY = 'cet6_middle_frequency_resume_v1';",
        1,
    )
    logic = logic.replace(
        "const key = () => 'cet6_flash_733_audio_ipa_fixed_' + currentUnit;",
        "const key = () => 'cet6_middle_frequency_progress_v1_' + currentUnit;",
        1,
    )

    expected = "<script>\n"
    if not prefix.endswith(expected):
        raise RuntimeError("Unexpected script boundary in the reference page")
    prefix = prefix[: -len(expected)]
    external_data = (
        '<script src="../mid-frequency-vocabulary/middle-frequency-data.js"></script>\n'
        "<script>\n"
    )
    TARGET.write_text(prefix + external_data + logic, encoding="utf-8")
    print(TARGET)


if __name__ == "__main__":
    main()
