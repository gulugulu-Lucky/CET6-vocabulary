from __future__ import annotations

import argparse, copy, datetime as dt, json, shutil, sys
from pathlib import Path
from typing import Any, Iterable

try:
    from mcp.server.fastmcp import FastMCP
except Exception:
    FastMCP = None

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
TEMPLATES = ROOT / "templates"
OUTPUT = ROOT / "output"
BACKUPS = DATA / "backups"
WORDS = DATA / "words.json"
PENDING = DATA / "pending_changes.json"

ALIASES = {
    "reading":"reading", "read":"reading", "阅读":"reading", "阅读重点词":"reading",
    "hand":"handwriting", "handwriting":"handwriting", "手写":"handwriting", "手写单词本":"handwriting",
    "unit":"cet6_flash", "units":"cet6_flash", "cet6":"cet6_flash", "cet6_flash":"cet6_flash",
    "六级":"cet6_flash", "六级闪过":"cet6_flash", "六级词汇闪过":"cet6_flash",
}
LABELS = {"reading":"阅读重点词", "handwriting":"手写单词本", "cet6_flash":"六级词汇闪过"}
TEMPLATE_FILES = {"reading":"reading_template.html", "handwriting":"handwriting_template.html", "cet6_flash":"unit_template.html"}
OUTPUT_FILES = {
    "reading":"阅读重点词_28词_刷词网页(1).html",
    "handwriting":"手写单词本_179词_刷词网页_词义核对修正版.html",
    "cet6_flash":"六级词汇闪过_前九单元词义终校_补identify版.html",
}

if FastMCP:
    mcp = FastMCP("cet6-vocab")
else:
    class LocalMCP:
        def tool(self):
            def deco(fn): return fn
            return deco
        def run(self, *_, **__):
            raise RuntimeError('MCP SDK not installed. Run: uv add "mcp[cli]"')
    mcp = LocalMCP()


def norm_list(name: str) -> str:
    key = (name or "").strip()
    val = ALIASES.get(key) or ALIASES.get(key.lower())
    if val not in LABELS:
        raise ValueError(f"未知词库：{name}。可用：reading / handwriting / cet6_flash")
    return val


def load_json(path: Path) -> Any:
    return json.loads(path.read_text("utf-8"))


def save_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), "utf-8")


def load_words() -> dict[str, Any]:
    if not WORDS.exists():
        raise FileNotFoundError("data/words.json 不存在。先运行：python scripts/bootstrap_from_repo_html.py")
    return load_json(WORDS)


def load_pending() -> dict[str, list[dict[str, Any]]]:
    if not PENDING.exists():
        return {"changes": []}
    data = load_json(PENDING)
    data.setdefault("changes", [])
    return data


def save_pending(data: dict[str, list[dict[str, Any]]]) -> None:
    save_json(PENDING, data)


def word_of(entry: dict[str, Any]) -> str:
    return str(entry.get("word", "")).strip()


def iter_entries(words: dict[str, Any], list_name: str | None = None) -> Iterable[tuple[str, str, dict[str, Any]]]:
    lists = words.get("lists", {})
    names = [list_name] if list_name else list(LABELS)
    for name in names:
        payload = lists.get(name, {} if name == "cet6_flash" else [])
        if name == "cet6_flash":
            for unit, entries in payload.items():
                for e in entries: yield name, unit, e
        elif name == "reading":
            for e in payload: yield name, str(e.get("unit", "未分组")), e
        elif name == "handwriting":
            for e in payload: yield name, str(e.get("source", "未分组")), e


def find_matches(words: dict[str, Any], word: str, list_name: str | None = None) -> list[dict[str, Any]]:
    target = word.strip().lower()
    out = []
    for lname, group, e in iter_entries(words, list_name):
        if word_of(e).lower() == target:
            out.append({"list": lname, "list_label": LABELS[lname], "group": group, "word": e.get("word",""), "meaning": e.get("meaning",""), "ipa": e.get("ipa","")})
    return out


def append_change(change: dict[str, Any]) -> None:
    pending = load_pending()
    change["created_at"] = dt.datetime.now().isoformat(timespec="seconds")
    pending["changes"].append(change)
    save_pending(pending)


def next_id(entries: list[dict[str, Any]]) -> int:
    ids = [int(e.get("id", 0)) for e in entries if str(e.get("id", "")).isdigit()]
    return max(ids, default=0) + 1


def apply_changes(base: dict[str, Any], pending: dict[str, list[dict[str, Any]]] | None = None) -> dict[str, Any]:
    data = copy.deepcopy(base)
    lists = data.setdefault("lists", {})
    for c in (pending or load_pending()).get("changes", []):
        action, lname, word = c.get("action"), norm_list(c.get("list_name", "")), str(c.get("word", "")).strip()
        if not word: continue
        group, meaning, ipa = (str(c.get("group", "")).strip() or None), c.get("meaning"), c.get("ipa")
        if action == "add":
            if lname == "cet6_flash":
                lists.setdefault(lname, {}).setdefault(group or "Unit 1", []).append({"word": word, "meaning": meaning or "", "ipa": ipa or ""})
            else:
                entries = lists.setdefault(lname, [])
                item = {"id": next_id(entries), "word": word, "meaning": meaning or "", "ipa": ipa or ""}
                item["unit" if lname == "reading" else "source"] = group or "新增"
                entries.append(item)
        elif action == "update":
            for _, _, e in iter_entries(data, lname):
                if word_of(e).lower() == word.lower():
                    if meaning: e["meaning"] = meaning
                    if ipa: e["ipa"] = ipa
                    if group and lname in ("reading", "handwriting"):
                        e["unit" if lname == "reading" else "source"] = group
                    break
        elif action == "delete":
            if lname == "cet6_flash":
                for unit, entries in list(lists.get(lname, {}).items()):
                    lists[lname][unit] = [e for e in entries if word_of(e).lower() != word.lower()]
            else:
                lists[lname] = [e for e in lists.get(lname, []) if word_of(e).lower() != word.lower()]
    for lname in ("reading", "handwriting"):
        for i, e in enumerate(lists.get(lname, []), 1): e["id"] = i
    return data


def pending_summary() -> str:
    changes = load_pending().get("changes", [])
    if not changes: return "目前没有待确认改动。"
    lines = [f"待确认改动：{len(changes)} 条"]
    for i, c in enumerate(changes, 1):
        lname, word = norm_list(c.get("list_name", "")), c.get("word", "")
        if c.get("action") == "add": lines.append(f"{i}. 添加｜{LABELS[lname]}｜{c.get('group') or '默认分组'}｜{word}｜{c.get('meaning','')}｜{c.get('ipa','')}")
        elif c.get("action") == "update": lines.append(f"{i}. 修改｜{LABELS[lname]}｜{word}")
        elif c.get("action") == "delete": lines.append(f"{i}. 删除｜{LABELS[lname]}｜{word}")
    return "\n".join(lines)


def render_one(words: dict[str, Any], list_name: str, out_dir: Path) -> Path:
    lname = norm_list(list_name)
    data = copy.deepcopy(words["lists"][lname])
    if lname in ("reading", "handwriting"):
        for i, e in enumerate(data, 1): e["id"] = i
    template = (TEMPLATES / TEMPLATE_FILES[lname]).read_text("utf-8")
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / OUTPUT_FILES[lname]
    out.write_text(template.replace("__DATA_JSON__", json.dumps(data, ensure_ascii=False)), "utf-8")
    return out


@mcp.tool()
def list_vocab_lists() -> str:
    """列出三个词库和词条数量。"""
    words = load_words()
    return "\n".join(f"{k}｜{v}｜{sum(1 for _ in iter_entries(words, k))} 词" for k, v in LABELS.items())


@mcp.tool()
def search_word(word: str) -> str:
    """在三个 CET-6 词库中查找一个单词。"""
    matches = find_matches(apply_changes(load_words()), word)
    return json.dumps(matches, ensure_ascii=False, indent=2) if matches else f"没有找到：{word}"


@mcp.tool()
def check_duplicate(word: str) -> str:
    """检查一个单词是否已存在，包含待确认改动。"""
    matches = find_matches(apply_changes(load_words()), word)
    if not matches: return f"不重复，可以添加：{word}"
    return "发现已有位置：\n" + "\n".join(f"- {m['list_label']}｜{m['group']}｜{m['word']}｜{m['meaning']}" for m in matches)


@mcp.tool()
def list_words(list_name: str, group: str = "", limit: int = 80) -> str:
    """列出指定词库；group 可填 Passage 1、图1、Unit 1 等。"""
    lname, rows = norm_list(list_name), []
    for _, g, e in iter_entries(apply_changes(load_words()), lname):
        if group and g != group: continue
        rows.append(f"{g}｜{e.get('word','')}｜{e.get('meaning','')}｜{e.get('ipa','')}")
        if len(rows) >= max(1, limit): break
    return "\n".join(rows) if rows else "没有找到词条。"


@mcp.tool()
def add_word(list_name: str, word: str, meaning: str, ipa: str = "", group: str = "") -> str:
    """添加单词到待确认改动，不直接改正式词库。"""
    append_change({"action": "add", "list_name": norm_list(list_name), "word": word.strip(), "meaning": meaning.strip(), "ipa": ipa.strip(), "group": group.strip()})
    return "已加入待确认改动，不会自动发布。\n" + pending_summary()


@mcp.tool()
def update_word(list_name: str, word: str, meaning: str = "", ipa: str = "", group: str = "") -> str:
    """把修改请求加入待确认改动。"""
    if not any([meaning.strip(), ipa.strip(), group.strip()]): return "没有提供要修改的 meaning / ipa / group。"
    append_change({"action": "update", "list_name": norm_list(list_name), "word": word.strip(), "meaning": meaning.strip(), "ipa": ipa.strip(), "group": group.strip()})
    return "已加入待确认改动，不会自动发布。\n" + pending_summary()


@mcp.tool()
def delete_word(list_name: str, word: str) -> str:
    """把删除请求加入待确认改动。"""
    append_change({"action": "delete", "list_name": norm_list(list_name), "word": word.strip()})
    return "已加入待确认删除，不会自动发布。\n" + pending_summary()


@mcp.tool()
def show_diff() -> str:
    """查看所有待确认改动。"""
    return pending_summary()


@mcp.tool()
def reset_pending(confirm_phrase: str = "") -> str:
    """清空草稿；confirm_phrase 必须为：清空草稿。"""
    if confirm_phrase != "清空草稿": return "没有清空。要清空请传入 confirm_phrase='清空草稿'。"
    save_pending({"changes": []}); return "已清空所有待确认改动。"


@mcp.tool()
def build_preview(list_name: str = "all") -> str:
    """生成预览 HTML 到 output/preview，不发布。"""
    data = apply_changes(load_words())
    targets = list(LABELS) if list_name.strip().lower() in ("all", "全部", "") else [norm_list(list_name)]
    paths = [render_one(data, t, OUTPUT / "preview") for t in targets]
    return "预览已生成：\n" + "\n".join(str(p.relative_to(ROOT)) for p in paths) + "\n\n" + pending_summary()


@mcp.tool()
def confirm_publish(confirm_phrase: str) -> str:
    """确认发布到本地 output/publish；confirm_phrase 必须为：确认发布。不会推 GitHub。"""
    if confirm_phrase != "确认发布": return "没有发布。要发布必须传入 confirm_phrase='确认发布'。"
    pending = load_pending()
    if not pending.get("changes"): return "没有待确认改动。"
    backup = BACKUPS / dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup.mkdir(parents=True, exist_ok=True)
    shutil.copy2(WORDS, backup / "words.before.json"); shutil.copy2(PENDING, backup / "pending.before.json")
    merged = apply_changes(load_words(), pending); merged.setdefault("metadata", {})["last_published_at"] = dt.datetime.now().isoformat(timespec="seconds")
    save_json(WORDS, merged); save_pending({"changes": []})
    paths = [render_one(merged, t, OUTPUT / "publish") for t in LABELS]
    return "已发布到本地 output/publish，没有推 GitHub。\n" + f"备份位置：{backup.relative_to(ROOT)}\n" + "\n".join(str(p.relative_to(ROOT)) for p in paths)


def main() -> None:
    parser = argparse.ArgumentParser(description="CET-6 Vocabulary MCP server")
    parser.add_argument("command", nargs="?", default="serve", choices=["serve", "build-preview", "show-diff", "lists"])
    parser.add_argument("--list", dest="list_name", default="all")
    args = parser.parse_args()
    if args.command == "build-preview": print(build_preview(args.list_name), file=sys.stderr); return
    if args.command == "show-diff": print(show_diff(), file=sys.stderr); return
    if args.command == "lists": print(list_vocab_lists(), file=sys.stderr); return
    if FastMCP is None: raise SystemExit('MCP SDK not installed. Run: uv add "mcp[cli]"')
    mcp.run(transport="stdio")

if __name__ == "__main__":
    main()
