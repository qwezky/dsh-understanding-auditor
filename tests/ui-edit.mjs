#!/usr/bin/env node
/**
 * 页面回归：载入 handoff 后编辑报告，不能把 handoff 丢掉，也不能静默审计旧文本。
 *
 * 依赖：react@18 react-dom@18 react-test-renderer@18（与 ui-flow.mjs 相同）
 * 用法：node tests/ui-edit.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.join(here, "..", "plugin", "lib", "client.js");

const REPORT = "该方案通过过程性追问提升学生的认知参与度。已有研究表明，认知卸载会削弱深度学习，因此减少认知卸载是提升参与度的关键。这也是报告把“过程中”单独提出来的原因。如果追问只发生在学习结束后，教师拿到的只是答案，而不是思路。";
const handoff = {
	handoff_id: "h-ui-1",
	report_text: REPORT,
	lineage: [{ span_id: "s1", author: "ai", event: "generated", range: [0, REPORT.length] }],
	knowledge_spans: [{ span_id: "s1" }, { span_id: "s2" }],
	retention_index: [],
	recording: { complete: true, gaps: [] },
	dial: 3
};

const startBodies = [];
let loaded;
globalThis.window = { __ModuleLoader__: { load: (definition) => { loaded = definition; } } };
globalThis.fetch = async (url, init) => {
	const target = String(url);
	let data;
	if (target.endsWith("/health")) data = { ok: true, provider: "fake", model: "fake" };
	else if (target.endsWith("/handoff/latest")) data = { ok: true, file: "handoff/h-ui-1.json", handoff };
	else if (target.endsWith("/start")) {
		if (init?.body) startBodies.push(JSON.parse(init.body));
		data = { ok: true, audit_id: "a-ui", graph: { nodes: {} }, budget: { total: 3 }, questions: [], report_span: REPORT.slice(0, 80), dial: 3 };
	} else data = { ok: true };
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
	slots: { inject: (key, callback) => callback(), register: (definition, component) => { captured[definition.name] = component; return () => {}; } },
	sidebarRightTabs: { register: () => () => {} },
	sidebarRight: { openTab() {} }
};
plugin.apply(ctx);
const Page = captured["sidebar.right.pane.tab"];

let renderer;
const textOf = (node) => {
	if (node == null) return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(textOf).join("");
	if (node.children) return node.children.map(textOf).join("");
	if (node.props) return textOf(node.props.children);
	return "";
};
const body = () => textOf(renderer.toJSON());
const button = (label) => {
	const found = renderer.root.findAll((node) => node.type === "button" && textOf(node.props.children).includes(label));
	if (!found.length) throw new Error(`button not found: ${label}`);
	return found[0];
};

await act(async () => { renderer = TestRenderer.create(React.createElement(Page)); });
await act(async () => { await button("载入最近 handoff").props.onClick(); });
if (!body().includes("来源指纹 2 段")) throw new Error("handoff 行没有显示来源指纹数\n" + body().slice(0, 400));

const textareas = renderer.root.findAll((node) => node.type === "textarea");
const edited = "删掉姓名后：" + REPORT;
await act(async () => { textareas[0].props.onChange({ target: { value: edited } }); });
if (!body().includes("报告已修改")) throw new Error("编辑后没有出现提示\n" + body().slice(0, 600));

const checkboxes = renderer.root.findAll((node) => node.type === "input" && node.props.type === "checkbox");
await act(async () => { checkboxes[1].props.onChange({ target: { checked: true } }); });
await act(async () => { await button("开始审计").props.onClick(); });

const sent = startBodies.at(-1);
if (!sent) throw new Error("没有发出 /start 请求");
if (!sent.handoff) throw new Error("编辑后 handoff 被丢掉了（来源指纹会一起丢）");
if (sent.report_text !== edited) throw new Error("提交的不是编辑后的文本");
console.log("✓ 载入 handoff → 编辑报告：保留指纹、显示警告、提交编辑后的文本");
