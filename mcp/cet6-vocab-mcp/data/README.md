# data

这里存放 MCP 使用的数据文件。

- `pending_changes.json`：待确认改动，已提交。
- `words.json`：正式词库，由 `scripts/bootstrap_from_repo_html.py` 从仓库根目录三个稳定 HTML 里抽取生成。
- `backups/`：本地发布前备份目录。

生成命令：

```bash
python mcp/cet6-vocab-mcp/scripts/bootstrap_from_repo_html.py
```
