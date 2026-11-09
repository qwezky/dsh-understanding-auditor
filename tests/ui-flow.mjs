#!/usr/bin/env node
/**
 * 页面流程自测（React test renderer）。
 *
 * 依赖：node 18+、react@18、react-dom@18、react-test-renderer@18
 * 运行：node ui-flow.mjs
 * 环境：DSH_URL 默认 http://127.0.0.1:3080
 *
 * 覆盖：载入示例 → 开始审计 → 答“不确定” → 跳过 2 题 → 补全卡 →
 *       写一句 → 变式题 → 复盘 → 生成导出预览。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const BASE = process.env.DSH_URL || "http://127.0.0.1:3080";
const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.join(here, "..", "plugin", "lib", "client.js");

const demo = await (await fetch(`${BASE}/dsh-understanding-auditor/start`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ mode: "demo", dial: 3 })
})).json();
if (!demo.ok) throw new Error("演示模式启动失败：" + (demo.error || "unknown"));

let loaded;
globalThis.window = { __ModuleLoader__: { load: (definition) => { loaded = definition; } } };
let variantCalls = 0;
globalThis.fetch = async (url) => {
	const target = String(url);
	let data;
	if (target.endsWith("/health")) data = { ok: true, provider: "deepseek-official", model: "deepseek-flash" };
	else if (target.endsWith("/start")) data = { ok: true, ...demo };
	else if (target.endsWith("/judge")) data = { ok: true, judgment: { mode: "judge", verdict: "unsure", hit_points: [], miss_points: ["用户回答“不确定”"], conflict: false, evidence: "用户原话：“不确定”", confidence: 1, needs_review: false, reread: [], disclaimer: "这是对这道题回答的判定，不是对报告的评分。" } };
	else if (target.endsWith("/micro")) data = { ok: true, card: { node_id: "T1", source_quote: "q", source_span: "§2", micro: "报告里的意思是：不追求标准答案，逼近真实思路。", grounded: true } };
	else if (target.endsWith("/refill-check")) data = { ok: true, check: { node_id: "T1", is_own_words: true, on_topic: true, note: "" } };
	else if (target.endsWith("/variant")) {
		variantCalls += 1;
		data = { ok: true, questions: [{ id: "V1", mode: "variant", variant_of: "Q2", type: "前提变换题", tier: "normal", entry_id: "R1", component_id: "G-01", node_id: "T1", dial: 3, spot_check: false, skip_allowed: true, quote: "相比于传统课堂提问，过程性追问不追求标准答案，而是不断逼近学生的真实思路。", question: "如果把“不追求标准答案”改成“必须给出标准答案”，结论还成立吗？", rubric: { expected_points: ["原结论依赖不追求标准答案", "改变前提后追问会变成核对答案"], must_not: ["只答成立或不成立"] }, followup: "如果换一个前提，结论会变成什么？", difficulty: "中" }] };
	} else if (target.endsWith("/export")) data = { ok: true, quiz: { questions: [] }, markdown: "# 理解审计 · 复盘\n\n> 不是评分\n\n## 缺口地图" };
	else data = { ok: true, questions: [] };
	return { ok: true, status: 200, json: async () => data };
};

// eslint-disable-next-line no-eval
eval(fs.readFileSync(bundle, "utf8"));
const plugin = loaded.factory((id) => {
	if (id === "react") return React;
	throw new Error("unexpected require " + id);
});
const captured = {};
const ctx = {
	effect(fn) { fn(); },
	slots: { inject(key, callback) { return callback(); }, register(definition, component) { captured[definition.name] = component; return () => {}; } },
	sidebarRightTabs: { register(definition) { captured.tab = definition; return () => {}; } },
	sidebarRight: { openTab() {} }
};
plugin.apply(ctx);
const Page = captured["sidebar.right.pane.tab"];

function textOf(node) {
	if (node == null) return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(textOf).join("");
	if (node.children) return node.children.map(textOf).join("");
	if (node.props) return textOf(node.props.children);
	return "";
}
let renderer;
const bodyText = () => textOf(renderer.toJSON());
function button(label) {
	const found = renderer.root.findAll((node) => node.type === "button" && textOf(node.props.children).includes(label));
	if (!found.length) throw new Error(`button not found: ${label}\n${bodyText().slice(0, 600)}`);
	return found[0];
}

await act(async () => { renderer = TestRenderer.create(React.createElement(Page)); });
await act(async () => { button("载入示例").props.onClick(); });
const checkboxes = renderer.root.findAll((node) => node.type === "input" && node.props.type === "checkbox");
await act(async () => { checkboxes[1].props.onChange({ target: { checked: true } }); });
await act(async () => { await button("开始审计").props.onClick(); });
if (!(bodyText().includes("第 1 题") && bodyText().includes("计划 4 题"))) throw new Error("没有进入第 1 题");

await act(async () => { button("不确定").props.onClick(); });
await act(async () => { await button("提交判定").props.onClick(); });
if (!(bodyText().includes("第 2 题") && bodyText().includes("计划 4 题"))) throw new Error("没有进入第 2 题");
await act(async () => { button("不会，先跳过").props.onClick(); });
await act(async () => { button("不确定").props.onClick(); });
await act(async () => { await button("提交判定").props.onClick(); });
await act(async () => { button("不会，先跳过").props.onClick(); });
if (!bodyText().includes("补全")) throw new Error("没有进入补全卡");

const textareas = renderer.root.findAll((node) => node.type === "textarea");
await act(async () => { textareas[0].props.onChange({ target: { value: "我的话说：追问是在过程中问，不追求标准答案。" } }); });
await act(async () => { await button("补完了，再问我一次").props.onClick(); });
if (!bodyText().includes("补全回访") || variantCalls !== 1) throw new Error("没有进入变式题");
await act(async () => { button("不确定").props.onClick(); });
await act(async () => { await button("提交判定").props.onClick(); });
if (!(bodyText().includes("补全") || bodyText().includes("缺口地图"))) throw new Error("没有进入第二张补全卡或复盘");
if (bodyText().includes("先不补")) await act(async () => { button("先不补").props.onClick(); });
if (!bodyText().includes("缺口地图")) throw new Error("没有进入复盘");
await act(async () => { await button("生成导出预览").props.onClick(); });
if (!bodyText().includes("理解审计 · 复盘")) throw new Error("没有生成导出预览");

console.log("✓ 载入示例 → 开始审计");
console.log("✓ 作答 / 跳过 / 再看一题");
console.log("✓ 补全卡 → 补一句 → 变式题");
console.log("✓ 复盘 + 导出预览");
console.log("\nUI flow passed");
