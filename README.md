# 理解审计员 · DSH 插件（v1.9.8）

> 版本：v1.9.8-m2 · 2026-11-08（v1.9.1 三个 P0；v1.9.2–v1.9.8 记录/附件/流式/正文选择/状态落盘）
> 对应设计：`理解审计员-设计文档-v1.9.md` §1.5–§1.6、§2.3、§6–§7、§9.1
> 仓库维护：成员 1 · 代码/提示词：成员 2
> 远程仓库：https://gitee.com/Tu_Di/dsh-understanding-auditor

## 1. 这次交付了什么

| 交付 | 位置 | 说明 |
|---|---|---|
| 四段提示词链 | `prompts/P0`–`P4` | P0 共用系统提示；P1 按 `lineage` 建 DAG；P2 出题；P3 判定/补全；P4 导出 |
| 模板 | `templates/` | `handoff.schema.json`（lineage / knowledge_spans / recording / provenance）、DAG schema、风险清单、题卡、判定、题库 |
| 一个插件包、两个命令 | `plugin/` | `/record start|status|end` 记录器 + `/audit` 审计 UI；共用一个 handoff schema |
| 样例 | `samples/` | v1.9 handoff、P1/P2/P3 输出示例 |
| 测试 | `tests/` | 单元、集成、冒烟、React 页面流程、载入后编辑；`验收自测.md` 对照 §9.2 |
| 截图 | `screenshots/` | 真实 DSH Web 里的题卡 / 复盘 / 导出 |

## 示意图

- [可持久化 DAG](docs/可持久化DAG示意图.png)：报告文件 → SHA-256 → 建一次 / 读盘复用；用数学归纳法做例子，说明为什么是 DAG 不是树。
- [record 流程](docs/record流程图.png)：热/慢队列 → `events.jsonl` → `/record end` 选正文 → handoff → 审计。
- [两页 PDF](docs/理解审计员-两页示意图.pdf)

## 2. v1.9 的两个关键变化

1. **报告由 agent 写**：用户给要求、材料、修改意见，agent 产出正文。`/记` 不再负责总结留存，而是**手动开启的旁路记录器**。
2. **来源看真实事件，不看自述**：`/record` 只订阅宿主事件，写 `lineage`；用户喂的算 `human` / `user_source`，AI 或工具生成的算 `ai` / `ai_summary` / `external`；用户用自己的话重写才算 `user_note`。指令、审阅都不算已知。

### 2.1 v1.9.1 只修了三处（评审 P0）

| # | 问题 | 现在怎么做 |
|---|---|---|
| 1 | 人类来源几乎判不出来：报告是 agent 写的，用户的话被改写后不在报告里，range 覆盖不到，所有节点都落成 `ai` | `/record end` 给每个知识段落算一组**不可读的 n-gram 哈希指纹**，存进 handoff 的 `knowledge_spans`；审计时按概念命中指纹判来源，不再要求报告逐字复用。提问（`inquiry`）和写作指令不记来源 |
| 2 | 载入 handoff 后改报告，界面会静默丢掉 handoff 或继续审旧文本 | 改过的文本就是实际审的文本；原 lineage 的 range 对不上，置空并标 `recording.complete=false`（gaps 里写明“编辑”）；指纹与位置无关，继续生效 |
| 3 | 真实审计导出的题库「期望要点」为空，demo 掩盖了它 | 导出时从 `rubric.expected_points` 回填；跳过题同样 |

新增回归测试：`tests/unit.mjs`（26 条）、`tests/integration.mjs`（5 条，假模型跑通 /start 与 DAG 复用）、`tests/ui-edit.mjs`（载入→编辑→警告→提交编辑文本）。

**指纹的边界**：只存哈希，不存原句；但短材料的 2-gram 指纹仍可能被字典反推，敏感材料请先在写作会话里脱敏。指纹会让 handoff 变大（约每千字 30 KB；总指纹预算约 8 万哈希，超了优先保留用户材料），已把请求体上限从 256 KB 调到 4 MB。

### 2.2 v1.9.8 记录方式：一条事件一次 append，慢活不挡写

- `/record start` 在工作区建 `understanding-auditor/recording/<时间>-<会话>/`，只放两个文件：
  - `meta.json`：会话、开始时间、状态（recording / finalized）；
  - `events.jsonl`：一行一个事件——`part`（assistant 正文 + 指纹）、`span`（用户/工具/附件）、`attachment`（解析结果 + 摘要 + 概念）。
- **没有字数阈值**：每条非空 assistant 消息都落一段，“嗯”“好的，已修改。”也会进正文；
- **两条写队列**：正文和指纹走热队列，PDF 抽取、P5 模型总结走慢队列；两条队列共用一条 append 写链（`writeQueue`），慢活不会挡住下一条 assistant 消息，也不会把 JSONL 写花；
- 哈希在写任务里算，不占事件处理；`/record end` 等两条队列清空后只读 `events.jsonl`，不读聊天历史、不取最长、不搜索正文；
- `/record status` 显示段数、累计字数、附件数、记录目录；
- 进程重启后 `/record end` 仍能从 `events.jsonl` 完成；插件启动时尝试重接未结束的记录。

> “流式”在这里是**消息级**：DSH 的 `session/event` 只在一条 assistant 消息落定时发事件，没有 token 级事件。所以能做到的是“一落定就 append、慢活隔离、不积压”，不是逐字写盘。

**正文选择**：`/record end` 默认只取**最后一条报告正文**（跳过短状态句和结尾说明），不再把整个窗口的 assistant 文本拼成正文；其他消息仍写进 `events.jsonl`/`knowledge_spans`，但不进 `report_text`。多段报告用 `/record end report.md`（相对工作区或绝对路径）冻结文件；如果最后一条不是完整报告，也走文件。`events.jsonl` 里是报告原文，注意别提交到公开仓库；指纹不是加密。每个 PDF 多一次 P5 模型调用。

**报告文件与 DAG**：审计面板输入页可以“选择报告文件”（`.md` / `.txt` / `.csv` / `.json` / `.html`），读取后按正文 SHA-256 查 `understanding-auditor/dags/<hash>.json`。有持久化 DAG 就直接复用，`/start` 跳过 P1、只生成题目；没有就建一次并保存。DAG 文件只存 `graph`、`risk_points`、文件名与字数，不复制报告正文。

**附件**：PDF / `.txt` `.md` `.csv` 会抽文字进来源，需要可选依赖 `pdfjs-dist`（`npm i pdfjs-dist@^6`）；图片、扫描件、`.docx` 等记“未解析” gap，`complete=false`。

**审计状态**：面板每答完一题把 DAG、队列、判定写到 `<工作区>/understanding-auditor/audit-state/<audit_id>.json`；刷新或重开面板会自动恢复，输入页也有“恢复上次审计”。

## 3. ASCII 命令（重要）

DSH 的命令名只接受 `^[a-z][a-z0-9_-]*$`，设计稿里的 `/记`、`/审计` 在解析阶段不成立。因此实际命令映射为：

| 设计稿 | DSH 实际命令 |
|---|---|
| `/记 开始` | `/record start` |
| `/记 状态` | `/record status` |
| `/记 结束` | `/record end` |
| `/审计` | `/audit`（或右上角“◍ 审计”按钮） |

中文仍作为界面文案/文档名；**不要再输入中文斜杠命令**。旧的 `/ji` skill 已移除：v1.9 明确 `/记` 必须是宿主 hook 插件。

## 4. 使用流程

### 写作会话（记录）

```text
/record start
（让 agent 写报告；用户粘贴材料、提出修改）
/record status
/record end
```

- `start` 之前已经写的内容不追溯，审计时按 `unknown` 处理。
- `end` 冻结 `handoff/<handoff_id>.json` 和 `lineage/<sessionId>.jsonl`。
- 只有 `end` 之后才有 handoff；忘记结束就没有可审计的冻结文件（这是当前实现的限制，见 §8）。

### 审计会话（提问）

1. 另开会话（不继承写作过程）；
2. 输入 `/audit`，或点右上角 **“◍ 审计”**；
3. 面板里点 **“载入最近 handoff”**；
4. 拖深度滑杆 → 开始审计；
5. 逐题作答 / 跳过 / 补全回访 → 复盘 → 导出 JSON/Markdown。

载入 handoff 后如果还要删姓名，可以直接在面板里改：**改后的文本就是审计用的文本**。改过之后原 lineage 的位置失效，面板会给出警告，本轮记录标为“不完整”；来源不受影响，因为它是按材料指纹判的，不依赖位置。

## 5. 插件安装

- 源码：`plugin/`
- 宿主路由：`http://127.0.0.1:3080/dsh-understanding-auditor/*`
- 健康检查：`curl http://127.0.0.1:3080/dsh-understanding-auditor/health`

在 DSH 里安装（推荐用 `plugin_manager`）：

1. 把仓库放到本机，例如 `git clone https://gitee.com/Tu_Di/dsh-understanding-auditor.git`；
2. 用 `plugin_manager install_bundle`，target 指向仓库里的 `plugin/` 绝对路径；
3. 确认 profile 的 bundles 里有 `dsh-plugin-understanding-auditor`，重载一次；
4. 附件解析需要可选依赖 `pdfjs-dist@^6`，没装时 PDF 记 gap，不阻塞。

手工安装（等价）：

```bash
# 把 plugin/ 放到 profile 的 node_modules，或加 file: 依赖
# 在 profile package.json 的 dependencies 里加 "<绝对路径>/plugin"
# 在 dsh.profile.bundles 末尾加 dsh-plugin-understanding-auditor
```

`/record` / `/audit` 是宿主命令；`/record` 只在写作会话开启记录，`/audit` 只读最近 handoff，互不调用。

## 6. 边界（与 v1.9 §1.5/§1.6 一致）

- `/record` 不注入上下文、不注册写作工具、不阻塞写作、不改报告、不评价；只写 `lineage`/handoff。
- `/audit` 只读 handoff；不联网、不读写作对话、不改来源谱系。
- 审计只判每道题的回答；不汇总报告分、不排名、不给等级。
- 跳过不是失败；补全卡只重组原文；同一节点最多再问一次。
- `origin` / `provenance` 只用于分配档位与抽查；导出默认隐藏。

## 7. 验收自测

| 项 | 命令/方式 | 结果 |
|---|---|---|
| 单元测试（无宿主、无模型） | `node tests/unit.mjs` | 26 passed |
| 记录器（模拟写作事件 + 重启 + 报告文件） | `node tests/recorder.mjs` | 1 passed；只取最后一条正文、重启、`/record end <文件>` |
| 附件解析（需 pdfjs-dist） | `node tests/attachment.mjs` | 1 passed；PDF 进来源、图片记 gap |
| 集成测试（假模型跑 /start） | `node tests/integration.mjs` | 5 passed |
| 插件冒烟（需要在跑着的宿主） | `node tests/smoke.mjs` | 13/14；健康检查需要有模型 provider |
| React 页面流程 | `cd tests && npm i react@18 react-dom@18 react-test-renderer@18 && node ui-flow.mjs` | 通过 |
| 载入 handoff 后编辑 | `node tests/ui-edit.mjs` | 通过；保留指纹、显示警告、提交编辑文本 |
| `/record` 命令 | 浏览器输入 `/record start` / `status` / `end` | 通过；生成 handoff |
| `/audit` 命令 | 浏览器输入 `/audit` | 通过；返回最近 handoff |
| handoff 载入 + 审计 | 面板“载入最近 handoff” → 开始审计 | 通过；显示来源谱系与记录完整 |
| 真实浏览器 | Chromium 打开 `http://127.0.0.1:3080` | 题卡/复盘/导出正常 |

截图：`screenshots/01-input.png`、`03-quiz.png`、`04-summary.png`、`05-export.png`。

## 8. 当前实现与 v1.9 的差异 / 待确认

1. **中文命令不可用**：DSH 限制命令名为 ASCII，实际用 `/record`、`/audit`；设计稿中的 `/记`、`/审计` 只是产品名。
2. **正文来自聊天或文件**：v1.9.7 起，聊天正文逐事件追加到 `events.jsonl`；agent 把报告写进文件时用 `/record end <文件>` 冻结。两条路二选一，不能自动判断。
3. **retention_index 默认为空**：记录器不自动抽概念；来源改由 `knowledge_spans` 指纹判定，索引仍只做交叉校验。
4. **没有真正的 rewrite 识别**：`user_note` 只在显式 `event: rewrite` 时产生；当前记录器把用户消息标成 `typed`/`pasted`/`inquiry`，没有自动判断“用自己的话重写”。
5. **忘记 `/record end` 没有 handoff**：只有 `end` 才冻结；`complete=false` 的“降级 handoff”仍未实现（编辑报告时会标不完整，但忘了 end 就没有文件）。
6. **lineage range 只对未编辑的报告有效**：编辑报告后 range 置空，来源改用指纹；未编辑时 range 是写入时按实际字数算的，不靠字符串搜索。
7. **记录器没有“记录中”小点**：目前通过 `/record status` 查看；客户端角标还没做。
8. **指纹不是加密**：只保证不存原句；短材料的 2-gram 仍可能被反推。
9. **附件只解析了一部分**：PDF / 纯文本已进来源（需 `pdfjs-dist`），并有一次旁路模型总结；图片没有 OCR，`.docx` / `.pptx` 等二进制格式未解析——这些会记成 gap，不会静默当 AI。
10. **没有字数阈值**：状态句（“好的，已修改”“嗯”）也会进正文，需要在审计面板里自己删；记录文件夹里是报告原文，注意脱敏与版本控制。
11. **PDF 解析依赖可选包**：`pdfjs-dist` 没装时，PDF 直接记“未解析”；扫描件 PDF 没有文字层，同样记 gap。

## 9. 文件树

```
理解审计员-成员2交付/
├─ README.md
├─ 未修清单.md                     （v1.9.8：还剩什么、为什么、怎么修）
├─ prompts/
│  ├─ P0-系统提示词.md
│  ├─ P1-风险扫描.md
│  ├─ P2-出题.md
│  ├─ P3-判定.md
│  ├─ P4-导出.md
│  └─ P5-附件摘要.md
├─ templates/
│  ├─ handoff.schema.json          （v1.9.1：lineage / knowledge_spans / recording / provenance）
│  ├─ 知识DAG结构.schema.json      （v1.9：provenance / ai_variant）
│  ├─ 风险清单模板.md
│  ├─ 题卡模板.md
│  ├─ 理解提示模板.md
│  ├─ 题库字段.schema.json
│  └─ 知识DAG示例.json
├─ plugin/
│  ├─ package.json                 （v1.9.8）
│  ├─ cordis.patch.yml
│  ├─ lib/index.js                 （/record + /audit + 路由 + 提示词链）
│  ├─ lib/client.js                （右侧栏 UI + handoff 载入 + 来源谱系）
│  ├─ prompts/
│  └─ templates/
├─ samples/
│  ├─ handoff-v1.9.json
│  ├─ P1-输出示例.json
│  ├─ P2-输出示例.json
│  ├─ P3-输出示例.json
│  └─ 演示模式-输出.json
├─ screenshots/
│  ├─ 01-input.png
│  ├─ 03-quiz.png
│  ├─ 04-summary.png
│  └─ 05-export.png
└─ tests/
   ├─ smoke.mjs
   ├─ unit.mjs                     （v1.9.1：来源 / 编辑 / 导出，无需宿主）
   ├─ integration.mjs              （v1.9.1：假模型跑通 /start）
   ├─ recorder.mjs                 （v1.9.8：WAL、正文选择、可重启、报告文件）
   ├─ attachment.mjs               （v1.9.8：PDF 进来源、旁路摘要、图片记 gap）
   ├─ fixtures/attachment.pdf      （一页测试 PDF）
   ├─ ui-flow.mjs
   ├─ ui-edit.mjs                  （v1.9.1：载入 handoff 后编辑）
   └─ 验收自测.md
```

## 10. 参考资料

`参考资料.md` 原样保留，仍是 5 类机制 + 9 条来源；v1.9 的四刀与预算没有变。
