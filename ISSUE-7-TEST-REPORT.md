# GitHub Issue #7 实现与测试报告

测试日期：2026-10-15

目标 Issue：https://github.com/gulugulu-Lucky/CET6-vocabulary/issues/7

## 实现结果

- 四个词库统一执行“不会优先”规则：词条一旦为 `unknown`，在“全部”或“只刷未刷”模式点击“会”不会覆盖；只有在“只刷不会”模式点击“会”才会改为 `known`。
- “只刷不会”在进入模式时建立本轮快照。即使本轮把词条改为“会”，它仍留在本轮名单并循环；退出再进入后才按最新记录重建。
- “上一词”仍撤销最近一次判断、恢复原状态，同时不重建或破坏锁定名单。
- 打乱、重置、空名单、刷新退出筛选、Unit 切换均覆盖了锁定名单的边界情况。
- 新增四词库学习数据页：累计已刷/掌握/待巩固、整体进度、今日不同词条、最近 7 天、连续学习天数。
- 新增“小猫单词花园”：同一自然日完成至少 10 个不同词条才浇水一次，并按真实浇水天数成长。
- 首页保留四个原词库入口，并新增“学习数据”入口。
- 三个历史 iframe 兼容入口不再通过 `eval` 覆盖源页面判断逻辑。

## 数据兼容与迁移策略

原有学习状态键保持不变：

| 词库 | 原有 localStorage 键 |
| --- | --- |
| 高频词 | `cet6_flash_733_audio_ipa_fixed_Unit N` |
| 中频词 | `cet6_middle_frequency_progress_v1_Unit N` |
| 手写单词本 | `handwritten_vocab_179_audio_ipa_v1` |
| 阅读重点词 | `reading_vocab_28_v1` |

新增键：

- `cet6_study_activity_v1`：按本地自然日记录真实判断事件；唯一标识由“词库 + Unit/范围 + 数据索引”组成，同日重复不累计。
- `cet6_issue7_progress_backup_v1`：升级后首次载入共享模块时，保存所有原进度键的原始字符串或 `null`，只创建一次。

没有重命名、合并或清空原有状态键。旧记录继续准确参与累计进度；由于旧数据没有日期，不会被推断成今日、7 天趋势、连续天数或花园浇水记录。

## 自动测试结果

Playwright 实际使用本机 Google Chrome，结果为 **11 passed / 0 failed**。测试结果明细保存在 [`test-results/issue7-browser-results.json`](test-results/issue7-browser-results.json)。

覆盖场景：

1. 首页五个入口、四词库真实载入、共享模块、词数/Unit 数量与发音按钮。
2. 手写与阅读原有“辅助理解”交互，以及三个 iframe 兼容入口。
3. 四词库逐一验证：不会优先、只刷不会锁定、反复循环、最后一次状态、重新进入、空名单、刷新、只刷未刷和重置。
4. 高频词 A/B/C 固定名单完整循环、B 后续改为不会、重新进入只含 B、上一词撤销、打乱后名单不丢词。
5. 高频词与中频词在只刷不会模式切换 Unit 后使用对应 Unit 的最新快照。
6. 旧 localStorage 记录、首次原始值备份、累计统计，以及不补造历史日期。
7. 仅查看释义和刷新不计数；实际判断计数；同日同词去重；跨日计数。
8. 9 个不同词条不浇水、第 10 个浇水、7 天趋势、7 天连续学习和多日花园成长。
9. 桌面视口 `1280×900` 与手机视口 `390×844`；四词库手机端无横向溢出，主要操作区保持在一屏内。
10. 所有场景均检查 `pageerror` 和浏览器 `console.error`，结果为 0。

静态检查：

- `node --check shared/study-progress.js`：通过。
- `node --check tests/issue7-browser.mjs`：通过。
- `git diff --check`：通过。
- 三个 iframe wrapper 中不存在 `eval(`：通过。

复现命令（当前 Codex Windows 运行时）：

```powershell
$env:PLAYWRIGHT_MODULE='C:\Users\Lucky\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright\index.mjs'
$env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
& 'C:\Users\Lucky\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'tests\issue7-browser.mjs'
```

## 界面截图

- [学习数据页（桌面）](test-results/issue7-dashboard-desktop.png)
- [学习数据页（手机）](test-results/issue7-dashboard-mobile.png)
- [只刷不会锁定轮次（手机）](test-results/issue7-locked-round-mobile.png)

## 已知测试边界

自动化测试验证了发音按钮会调用浏览器语音接口且不产生错误；为了让无声的 headless Chrome 结果可重复，测试中替换了系统语音输出，因此没有把“扬声器实际出声”描述为已自动验证。未发现待解决的功能问题。
