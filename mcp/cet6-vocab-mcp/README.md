# CET-6 单词库 MCP｜可写但安全版

这是给小猫的 CET-6 刷词网页维护工具。它不是重新做网页，而是维护已经满意的三个网页框架。

核心逻辑：

```text
现有 HTML 框架不乱动
↓
单词数据集中放进 data/words.json
↓
MCP 只把“增删改词”放进 data/pending_changes.json
↓
先 build_preview 生成预览
↓
小猫确认后 confirm_publish("确认发布")
↓
才写入正式 words.json，并导出 output/publish HTML
```

## 初始化/更新词库数据

在 GitHub 仓库中可以运行：

```bash
python mcp/cet6-vocab-mcp/scripts/bootstrap_from_repo_html.py
```

它会从仓库根目录三个稳定 HTML 中抽取词库，生成：

```text
mcp/cet6-vocab-mcp/data/words.json
mcp/cet6-vocab-mcp/templates/*.html
```

## 安装

需要 Python 3.10+。

```bash
cd mcp/cet6-vocab-mcp
uv venv
source .venv/bin/activate
uv add "mcp[cli]"
```

Windows PowerShell：

```powershell
cd mcp\cet6-vocab-mcp
uv venv
.venv\Scripts\activate
uv add "mcp[cli]"
```

## 本地测试

```bash
uv run server.py lists
uv run server.py build-preview --list all
```

预览生成在：

```text
output/preview/
```

## MCP 工具

- `list_vocab_lists()`：列出三个词库和词数
- `search_word(word)`：查单词在哪
- `check_duplicate(word)`：查重
- `list_words(list_name, group, limit)`：列出某个词库
- `add_word(list_name, word, meaning, ipa, group)`：添加到待确认改动
- `update_word(list_name, word, meaning, ipa, group)`：修改请求加入待确认改动
- `delete_word(list_name, word)`：删除请求加入待确认改动
- `show_diff()`：查看待确认改动
- `build_preview(list_name)`：生成预览
- `confirm_publish(confirm_phrase)`：确认发布，必须传 `确认发布`
- `reset_pending(confirm_phrase)`：清空草稿，必须传 `清空草稿`

## 安全规则

1. 增删改不会直接改正式词库。
2. 预览只生成本地 HTML。
3. 只有 `confirm_publish("确认发布")` 才合并 pending。
4. 发布前自动备份。
5. 这个版本不会推 GitHub；GitHub 推送留到下一阶段。

## 词库名称

| 正式名 | 也可以叫 |
|---|---|
| `reading` | 阅读 / 阅读重点词 |
| `handwriting` | 手写 / 手写单词本 |
| `cet6_flash` | 六级 / 六级闪过 / 六级词汇闪过 |
