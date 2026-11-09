# 理解审计员 v1.9.8

> 不是评分，是抽检：写这段话的人，能不能把这段话讲出来。

DSH 插件：写作时用 `/record` 记录来源，读完后用 `/audit` 以三类反向题抽检理解；支持 DAG 持久化、附件指纹、缺口地图与复盘导出。

## 本版重点

### `/record` 记录器

- 单文件 WAL：`understanding-auditor/recording/<时间>-<会话>/events.jsonl`，一条事件一次 append。
- 热队列（正文/指纹）与慢队列（PDF 抽取/P5 摘要）分开，共用一条写链，不阻塞写作。
- `/record end` 默认只取最后一条报告正文，跳过短状态句；多段报告用 `/record end 文件.md`。
- 附件：PDF / `.txt` / `.md` / `.csv` 抽文字进来源；图片和未知格式记 gap。
- handoff 包含 `lineage`、`knowledge_spans` 不可读指纹、`recording.complete/gaps`。

### `/audit` 审计

- 三类反向题：复述解释、前提变换、术语定义；一次一题、逐字引文。
- 判定按“命中 → 冲突 → 结论”，支持 `correct / partial / wrong / unsure`，`unsure` 不算错。
- 四刀的简化版：答对确认祖先、答错追 parents、跳过给补全卡后变式回访、人类祖先默认确认。
- 缺口地图、逐题复盘、Markdown/JSON 导出；不汇总正确率、不排名、不给等级。
- 面板每答完一题把 DAG/队列/判定写到 `understanding-auditor/audit-state/<audit_id>.json`，刷新或重开自动恢复。

### 持久化 DAG

- 输入页可“选择报告文件”（`.md/.txt/.csv/.json/.html`）。
- 按报告正文 SHA-256 查 `understanding-auditor/dags/<hash>.json`；有 DAG 就复用，`/start` 跳过 P1、只生成题目。
- DAG 文件只存 `graph / risk_points / 文件名 / 字数`，不复制正文。

## 安装

插件本体是 npm 包 `dsh-plugin-understanding-auditor-1.9.8.tgz`（不是 zip）。

1. `git clone https://gitee.com/Tu_Di/dsh-understanding-auditor.git`
2. 用 DSH 的 `plugin_manager install_bundle`，target 指向仓库里的 `plugin/` 绝对路径；或 `npm i ./dsh-plugin-understanding-auditor-1.9.8.tgz` 后让 profile 指向它。
3. 重载 `/record`、`/audit` 所在 bundle。
4. PDF 解析需要可选依赖 `pdfjs-dist@^6`；没装时记 gap，不阻塞。

## 验证

| 项 | 结果 |
|---|---|
| unit | 26 passed |
| integration | 5 passed（含 DAG 复用只调 P2） |
| recorder | 1 passed（正文选择 + 文件模式） |
| attachment | 1 passed（装 pdfjs；不装 skip） |
| UI flow / ui-edit | 通过 |

## 已知边界

- 正文选择是启发式：短报告、以“这是/已/完成”开头的正文、多段报告可能选错；重要报告用 `/record end 文件.md`。
- 复用 DAG 不按新 handoff 重算来源；同一正文换了材料，需要重跑来源覆盖或删对应 DAG。
- DAG / audit-state 文件只增不减，暂无清理策略。
- 报告模式 preset 已撤；本仓库只保留插件本体。
- 完整剩余项见 `未修清单.md`。

## License

MIT
