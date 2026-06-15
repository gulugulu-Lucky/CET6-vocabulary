# CET-6 Vocabulary MCP Package

这个目录用于暂存 CET-6 单词库 MCP 项目包。

当前包名：`cet6-vocab-mcp.zip`

说明：由于 GitHub connector 不能直接上传二进制 zip，我先把包按 base64 分片方式存放在 `parts/` 目录下。恢复时把所有 `part01` 到最后一片按顺序拼接，再 base64 解码即可得到 zip。

恢复示例：

```bash
cat parts/cet6-vocab-mcp.zip.b64.part* > cet6-vocab-mcp.zip.b64
base64 -d cet6-vocab-mcp.zip.b64 > cet6-vocab-mcp.zip
unzip cet6-vocab-mcp.zip
```

Keats 备注：这个 MCP 项目暂时只是归档保存，不会影响当前 GitHub Pages 刷词网页。
