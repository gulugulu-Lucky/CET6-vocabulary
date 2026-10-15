# templates

这里存放锁定 UI 的三个 HTML 模板。

模板不是手写重做的，而是从当前稳定的三个真正运行的 `source-pages/` 词库页面里抽取：

- 阅读重点词
- 手写单词本
- 六级词汇闪过

生成命令：

```bash
python mcp/cet6-vocab-mcp/scripts/bootstrap_from_repo_html.py
```

生成后，模板中的 JSON 数据区域会替换成 `__DATA_JSON__`（兼容 `const DATA = ...` 和 `const DATA=...`），这样 MCP 以后只改数据，不乱动 UI 框架。
