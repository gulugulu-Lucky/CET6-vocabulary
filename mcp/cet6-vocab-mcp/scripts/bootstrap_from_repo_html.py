from __future__ import annotations

import json
import re
from pathlib import Path


# The root-level links are iframe wrappers. The vocabulary JSON and its
# interactions live in source-pages; never use a wrapper as a data template.
SOURCE_PAGES = {
    "reading": ("source-pages/reading-original.html", "reading_template.html"),
    "handwriting": ("source-pages/handwriting-original.html", "handwriting_template.html"),
    "cet6_flash": ("source-pages/cet6-flash-original.html", "unit_template.html"),
}

DATA_DECLARATION = re.compile(r"\bconst\s+DATA\s*=\s*")


def extract_const_data(text: str) -> tuple[str, object, int, int]:
    """Find a JSON DATA initializer without touching any surrounding page JS."""
    match = DATA_DECLARATION.search(text)
    if match is None:
        raise ValueError("Cannot find const DATA in vocabulary source page")
    start = match.end()
    try:
        parsed, consumed = json.JSONDecoder().raw_decode(text[start:])
    except ValueError as exc:
        raise ValueError("const DATA is not a valid JSON literal") from exc
    end = start + consumed
    if text[end:].lstrip()[:1] != ";":
        raise ValueError("const DATA is not followed by a statement terminator")
    return text[start:end], parsed, start, end


def validate_data(name: str, parsed: object) -> None:
    if name == "cet6_flash":
        groups = list(parsed.values()) if isinstance(parsed, dict) else []
        if not groups or not all(isinstance(group, list) and group for group in groups):
            raise ValueError("High-frequency DATA must be a nonempty unit map")
        words = [word for group in groups for word in group]
    elif isinstance(parsed, list) and parsed:
        words = parsed
    else:
        raise ValueError(f"{name} DATA must be a nonempty list")
    if not all(isinstance(word, dict) and isinstance(word.get("word"), str) and word["word"].strip() for word in words):
        raise ValueError(f"{name} has invalid word entries")


def main() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    project = repo_root / "mcp" / "cet6-vocab-mcp"
    data_dir = project / "data"
    template_dir = project / "templates"

    # Validate all three sources before writing files. Never overwrite the
    # pending vocabulary edits, source pages, or the published root wrappers.
    pending = data_dir / "pending_changes.json"
    if pending.exists():
        queued = json.loads(pending.read_text(encoding="utf-8")).get("changes", [])
        if queued:
            raise RuntimeError("Pending vocabulary edits exist; publish or clear them before re-bootstrap")

    lists = {}
    templates = {}
    for name, (source_path, template_name) in SOURCE_PAGES.items():
        text = (repo_root / source_path).read_text(encoding="utf-8")
        _, parsed, start, end = extract_const_data(text)
        validate_data(name, parsed)
        template = text[:start] + "__DATA_JSON__" + text[end:]
        if template.count("__DATA_JSON__") != 1:
            raise ValueError(f"{source_path}: invalid template placeholder count")
        lists[name] = parsed
        templates[template_name] = template

    words = {
        "metadata": {
            "project": "cet6-vocab-mcp",
            "source": "generated from source-pages vocabulary data",
            "note": "MCP edits data first, then renders the existing source-page templates."
        },
        "lists": lists,
    }
    data_dir.mkdir(parents=True, exist_ok=True)
    template_dir.mkdir(parents=True, exist_ok=True)
    for filename, template in templates.items():
        (template_dir / filename).write_text(template, encoding="utf-8")
    (data_dir / "words.json").write_text(json.dumps(words, ensure_ascii=False, indent=2), encoding="utf-8")
    if not pending.exists():
        pending.write_text('{"changes": []}\n', encoding="utf-8")
    (data_dir / "backups").mkdir(parents=True, exist_ok=True)
    (data_dir / "backups" / ".gitkeep").touch()
    print("Generated vocabulary and templates from source-pages (wrapper pages unchanged)")


if __name__ == "__main__":
    main()
