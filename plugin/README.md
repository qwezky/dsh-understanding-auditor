# `/record` + `/audit` · 理解审计员 v1.9.7 插件

> 一个包、两个命令：`/record` 是旁路记录器，`/audit` 是审计 UI。面向 DSH `0.2.2-rc.1`，无构建步骤。

## 命令

| 命令 | 作用 |
|---|---|
| `/record start` | 在写作会话开始记录，之前的文本不追溯 |
| `/record status` | 查看已记录段数 / 附件数 / 累计字数 |
| `/record end [文件]` | 冻结 `handoff/<id>.json`；默认只取最后一条报告正文，带路径时用该文件 |
| `/audit` | 读取最近 handoff，提示打开右上角“◍ 审计”面板 |

设计稿的 `/记`、`/审计` 是中文产品名，DSH 命令语法只接受 `^[a-z][a-z0-9_-]*$`，所以实际命令是 ASCII 的 `/record` / `/audit`。

## 记录器边界（v1.9 §1.5）

- 只在手动 `start` 后订阅 `session/event`；`end` 后停止。
- 只读事件，不注入消息、不注册写作工具、不阻塞、不改报告、不评价。
- 识别：`user/message`（source.kind=user）→ `user`；`assistant/message` → `ai`；`tool/result` → `external`。
- 短祈使句（“帮我写…”）视为写作指令，不记为知识；短问句（“什么是…”）记为 `inquiry`，只计数，不算来源。
- 写作时逐事件落盘：`/record start` 在工作区建 `understanding-auditor/recording/<时间>-<会话>/`，所有内容追加到 `events.jsonl`（`part` / `span` / `attachment` 三种行）。
- 两条写队列：正文与指纹走热队列，一条事件一次 `appendFile`；PDF 抽取、P5 模型总结走慢队列，慢活不会挡住下一条 assistant 消息。
- 用户材料、提问、工具返回不进正文，只把 n-gram 指纹写进 `span` 事件（没有原句）。
- PDF / `.txt` `.md` `.csv` 附件会抽文字后指纹化（PDF 需要可选依赖 `pdfjs-dist`）；图片与未知格式写 `attachment` 事件并标“未解析”。
- 附件的文字会在**写作对话之外**再调一次模型（`ctx.llm`，不发消息），生成摘要 + 5–12 个带逐字引文的概念；引文校验不过就丢。
- 没有字数阈值；`end` 只读 `events.jsonl`，不读聊天历史、不取最长、不搜索正文；进程重启后仍可结束。
- agent 把报告写进文件时，用 `/record end report.md` 冻结该文件（相对工作区或绝对路径）。
- 同时给每个知识段落算一组 **n-gram 哈希指纹**（`knowledge_spans`，只有哈希、没有原句），供审计判断“这个概念是谁提出的”。
- 只写 `lineage/` 与 `handoff/`，不写 `audit/`、不改留存库。

## 审计 UI

- 右上角“◍ 审计”按钮 / 右侧栏 `+` → 理解审计；
- “载入最近 handoff”从当前会话或任一 live session 的 cwd 找 `handoff/*.json`；
- 显示 `recording.complete`、`lineage` 段数、来源谱系计数（`user_source` / `user_note` / `ai_summary` / `external` / `unknown`）；
- 每答完一题把 DAG、队列、判定写到 `<工作区>/understanding-auditor/audit-state/<audit_id>.json`；刷新/重开面板自动恢复，输入页也有“恢复上次审计”。
- 输入页“选择报告文件”读取 `.md/.txt/.csv/.json/.html`，按正文 SHA-256 查 `understanding-auditor/dags/`；有 DAG 就复用（跳过 P1），没有就建一次并保存。DAG 只存 graph/risk_points/文件名/字数，不复制正文。
- 逐题、DAG、判定、补全回访、导出沿用 v1.5 的状态机；
- P1 收到的输入是 `report_text + lineage + retention_index + recording`；宿主用 `knowledge_spans` 指纹覆盖 P1 的来源判定：概念在用户材料里出现过才算 `human`，提问/指令不算，AI 段落覆盖只能算 `ai`。
- 载入 handoff 后编辑报告：审的是编辑后的文本；原 lineage 位置失效被置空，`recording.complete=false` 并写明原因；指纹与位置无关，继续生效。

## Host 路由

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/health` | provider/model/version |
| GET | `/handoff/latest?cwd=...` | 最近 handoff（跨 live session cwd 查找） |
| POST | `/start` | handoff 或手写报告 → P1 + 预算 + P2 |
| POST | `/judge` / `/upgrade` / `/spot` / `/variant` / `/micro` / `/refill-check` | 审计状态机 |
| POST | `/export` / `/save` | 题库 JSON/Markdown、`audit/<id>.json` |

## 安装

已安装到 `~/.dsh/profiles/web/node_modules/dsh-plugin-understanding-auditor/`，并加入 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles`。

复现：

```bash
cp -r plugin ~/.dsh/profiles/web/node_modules/dsh-plugin-understanding-auditor
# dependencies: "dsh-plugin-understanding-auditor": "file:<绝对路径>/plugin"
# dsh.profile.bundles 末尾加 "dsh-plugin-understanding-auditor"
# PDF 解析（可选，不装则 PDF 只记“未解析”）：
cd ~/.dsh/profiles/web/node_modules/dsh-plugin-understanding-auditor && npm i pdfjs-dist@^6
```

## 已知限制

1. 命令名只能是 ASCII；中文 `/记`、`/审计` 不可用。
2. 正文默认只取最后一条报告正文；多段报告或 agent 把正文写进文件时，用 `/record end <文件>`，否则只拿到最后一段。
3. 没有字数阈值：状态句、答疑、重写/重生成产生的旧稿都会进正文，需要在审计面板里自己删。
4. `retention_index` 默认空；来源由 `knowledge_spans` 指纹判定，索引只做交叉校验。
5. 没有自动 rewrite 识别；`user_note` 目前不会由记录器自动产生。
6. 忘记 `/record end` 就没有 handoff；`complete=false` 的 handoff 尚未实现。
7. 编辑报告后原 lineage 的 range 失效（置空、标记录不完整），来源改按指纹；未编辑时 range 在写入时就已算好。
8. 附件只解析了一部分：PDF / 纯文本进来源（需 `pdfjs-dist`）；图片没有 OCR，`.docx` / `.pptx` 等未解析，记 gap。
9. `pdfjs-dist` 没装或 PDF 是扫描件时，PDF 记“未解析”，不会静默当 AI。
9. 指纹按 n-gram 哈希，不是加密；只保证不存原句，短材料仍可能被字典反推。
