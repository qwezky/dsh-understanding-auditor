# 示意图

- `可持久化DAG示意图.png`：报告文件 → SHA-256 → 建一次 DAG / 读盘复用；用一道数学归纳法做例子，说明为什么它是 DAG 而不是树。
- `record流程图.png`：`/record start` → 热/慢队列 → `events.jsonl` → `/record end` 选正文 → handoff → 审计。
- `理解审计员-两页示意图.pdf`：上面两张图的 A4 横向两页版。

源脚本：`draw.py`、`make_pdf.py`（在绘制目录里，未随仓库上传）。
