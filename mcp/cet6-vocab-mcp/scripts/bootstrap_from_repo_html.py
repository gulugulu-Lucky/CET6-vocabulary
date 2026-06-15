from __future__ import annotations

import json
from pathlib import Path


def extract_const_data(text: str) -> tuple[str, object]:
    marker = "const DATA = "
    i = text.find(marker)
    if i < 0:
        raise ValueError("Cannot find const DATA")
    j = i + len(marker)
    stack = []
    in_str = False
    esc = False
    for k in range(j, len(text)):
        ch = text[k]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch in "[{":
                stack.append(ch)
            elif ch in "]}":
                stack.pop()
                if not stack:
                    raw = text[j:k + 1]
                    return raw, json.loads(raw)
    raise ValueError("DATA literal did not end")


def main() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    project = repo_root / "mcp" / "cet6-vocab-mcp"
    data_dir = project / "data"
    template_dir = project / "templates"
    data_dir.mkdir(parents=True, exist_ok=True)
    template_dir.mkdir(parents=True, exist_ok=True)
    mapping = {
        "reading": ("阅读重点词_28词_刷词网页(1).html", "reading_template.html"),
        "handwriting": ("手写单词本_179词_刷词网页_词义核对修正版.html", "handwriting_template.html"),
        "cet6_flash": ("六级词汇闪过_前九单元词义终校_补identify版.html", "unit_template.html"),
    }
    lists = {}
    for name, (html_file, template_file) in mapping.items():
        text = (repo_root / html_file).read_text("utf-8")
        raw, parsed = extract_const_data(text)
        lists[name] = parsed
        (template_dir / template_file).write_text(text.replace(raw, "__DATA_JSON__"), "utf-8")
    words = {
        "metadata": {
            "project": "cet6-vocab-mcp",
            "source": "generated from stable root HTML pages",
            "note": "MCP edits data first, then renders locked templates."
        },
        "lists": lists,
    }
    (data_dir / "words.json").write_text(json.dumps(words, ensure_ascii=False, indent=2), "utf-8")
    pending = data_dir / "pending_changes.json"
    if not pending.exists():
        pending.write_text('{"changes": []}\n', "utf-8")
    (data_dir / "backups").mkdir(parents=True, exist_ok=True)
    (data_dir / "backups" / ".gitkeep").write_text("", "utf-8")
    print("generated", data_dir / "words.json")


if __name__ == "__main__":
    main()
