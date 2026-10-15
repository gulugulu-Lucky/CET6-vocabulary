"""Smoke check: MCP regeneration must preserve the live CET-6 review app."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from bootstrap_from_repo_html import SOURCE_PAGES, extract_const_data, validate_data

ROOT = Path(__file__).resolve().parents[3]
PROJECT = ROOT / "mcp" / "cet6-vocab-mcp"
sys.path.insert(0, str(PROJECT))
import server  # noqa: E402


WRAPPERS = {
    "reading": "阅读重点词_28词_刷词网页(1).html",
    "handwriting": "手写单词本_179词_刷词网页_词义核对修正版.html",
    "cet6_flash": "六级词汇闪过_前九单元词义终校_补identify版.html",
}

catalog = json.loads((PROJECT / "data" / "words.json").read_text(encoding="utf-8"))
assert set(catalog["lists"]) == set(SOURCE_PAGES)
assert set(server.OUTPUT_FILES) == set(SOURCE_PAGES)

expected_sizes = {"cet6_flash": 733, "handwriting": 179, "reading": 28}
for name, (source_path, template_name) in SOURCE_PAGES.items():
    canonical = (ROOT / source_path).read_text(encoding="utf-8")
    _, source_data, _, _ = extract_const_data(canonical)
    validate_data(name, source_data)
    assert catalog["lists"][name] == source_data, f"{name}: out-of-sync words.json"

    template_path = PROJECT / "templates" / template_name
    template = template_path.read_text(encoding="utf-8")
    assert template.count("__DATA_JSON__") == 1, f"{name}: invalid template marker"
    assert "../shared/study-progress.js" in template, f"{name}: shared progress JS lost"
    assert "unknownSnapshot" in template, f"{name}: locked unknown review lost"
    assert "hintToggle" in template or name == "cet6_flash", f"{name}: comprehension hint lost"

    restored = template.replace("__DATA_JSON__", json.dumps(source_data, ensure_ascii=False))
    preview_path = PROJECT / "output" / "preview" / source_path
    assert preview_path.is_file(), f"{name}: missing preview in source-pages"
    preview = preview_path.read_text(encoding="utf-8")
    assert restored == preview, f"{name}: template and generated preview disagree"
    _, parsed_preview, _, _ = extract_const_data(preview)
    assert parsed_preview == source_data, f"{name}: preview word data changed"
    assert server.OUTPUT_FILES[name] == source_path, f"{name}: unsafe publish target"

    root_entry = (ROOT / WRAPPERS[name]).read_text(encoding="utf-8")
    assert "<iframe" in root_entry and source_path in root_entry, f"{name}: root entry lost iframe"
    assert "const DATA" not in root_entry, f"{name}: iframe entry unexpectedly has data"
    assert "eval(" not in root_entry, f"{name}: legacy overwrite reintroduced"

    word_count = (sum(len(group) for group in source_data.values())
                  if isinstance(source_data, dict) else len(source_data))
    assert word_count == expected_sizes[name], f"{name}: unexpected count {word_count}"
    print(f"PASS {name}: {word_count} words, source page/template/preview/wrapper consistent")

assert not list((PROJECT / "output" / "preview").glob("*.html")), "Generated output could replace root wrapper"
print("PASS: all three MCP publish targets stay inside source-pages; live wrappers untouched")
