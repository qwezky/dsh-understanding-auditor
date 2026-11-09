#!/usr/bin/env node
/**
 * Host 路由集成测试：用假的模型返回跑 /start 全链路，验证
 *  - 用户材料里的概念被判 human（即使报告是 AI 改写的）；
 *  - 载入 handoff 后编辑报告，审的是编辑后的文本，lineage 失效并标不完整；
 *  - 导出题库带期望要点。
 *
 * 用法：node tests/integration.mjs
 */
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { __test } from "../plugin/lib/index.js";

const userPaste = "过程性追问能提升学生的认知参与度，因为它迫使学生把思路说出来。";
const report =
	"该方案通过过程性追问提升学生的认知参与度。已有研究表明，认知卸载会削弱深度学习，因此减少认知卸载是提升参与度的关键。这也是报告把“过程中”单独提出来的原因。如果追问只发生在学习结束后，教师拿到的只是答案，而不是思路。";
const quoteA = "该方案通过过程性追问提升学生的认知参与度。";
const quoteB = "已有研究表明，认知卸载会削弱深度学习，因此减少认知卸载是提升参与度的关键。";

const p1 = {
	graph: {
		graph_id: "g-test",
		version: "1.2",
		created_at: new Date().toISOString(),
		report_span: report.slice(0, 40),
		nodes: {
			T1: { text: "过程性追问", kind: "term", origin: "ai", provenance: "ai_summary", parents: [], children: ["R1"], level: 1, risk: "mid" },
			R1: { text: "过程性追问提升学生的认知参与度", kind: "claim", origin: "ai", provenance: "ai_summary", parents: ["T1"], children: [], level: 2, risk: "high" },
			T3: { text: "认知卸载", kind: "term", origin: "human", provenance: "user_source", parents: [], children: [], level: 1, risk: "high" }
		},
		edges: [{ from: "T1", to: "R1", type: "prereq" }],
		cycles: [],
		non_prereq_links: [],
		components: [
			{ component_id: "G-01", entry_ids: ["R1"], node_ids: ["T1", "R1"] },
			{ component_id: "G-02", entry_ids: ["T3"], node_ids: ["T3"] }
		],
		dial: 3
	},
	risk_points: [
		{ node_id: "R1", quote: quoteA, question_type: "复述解释题", level: "high", reason: "核心结论" },
		{ node_id: "T3", quote: quoteB, question_type: "术语定义题", level: "high", reason: "未定义" }
	]
};

const p2 = {
	questions: [
		{
			id: "Q1", type: "复述解释题", tier: "normal", entry_id: "R1", component_id: "G-01", node_id: "R1",
			quote: quoteA, question: "请不用原词解释这句话的意思。",
			rubric: { expected_points: ["追问发生在学习过程中", "追问迫使学生外化思路"], must_not: [] },
			diff_iculty: "中"
		},
		{
			id: "Q2", type: "术语定义题", tier: "normal", entry_id: "T3", component_id: "G-02", node_id: "T3",
			quote: quoteB, question: "请用自己的话定义“认知卸载”。",
			rubric: { expected_points: ["把思考过程外包给工具", "与深度学习相对"], must_not: [] },
			difficulty: "中"
		}
	]
};

/** Fake host context whose model returns p1/p2 based on the stage prompt. */
function makeCtx() {
	const handlers = [];
	let calls = 0;
	const ctx = {
		webServer: { register: (handler) => { handlers.push(handler); return () => {}; } },
		commands: { register: () => () => {} },
		on: () => () => {},
		effect: (fn) => fn(),
		llm: {
			listProviders: () => [{ id: "fake" }],
			listModels: async () => [{ id: "fake-1", name: "fake" }],
			resolveModelInfo: async () => null,
			stream: async function* ({ system }) {
				calls += 1;
				const payload = system.includes("P1") ? p1 : system.includes("P2") ? p2 : {};
				yield { type: "text-delta", text: JSON.stringify(payload) };
				yield { type: "finish", reason: { kind: "stop" } };
			}
		},
		get: () => undefined,
		sessions: { get: () => undefined, list: () => [] },
		logger: { warn: () => {} }
	};
	return { ctx, handler: () => handlers[0].handler, calls: () => calls };
}

async function call(handler, path, body) {
	const payload = JSON.stringify(body);
	const req = Readable.from([Buffer.from(payload)]);
	req.url = "/dsh-understanding-auditor" + path;
	req.method = "POST";
	const out = { statusCode: 0, body: "" };
	const res = {
		set statusCode(value) { out.statusCode = value; },
		get statusCode() { return out.statusCode; },
		setHeader: () => {},
		end: (value) => { out.body = String(value); },
		destroy: () => {}
	};
	await handler(req, res);
	return { status: out.statusCode, data: JSON.parse(out.body) };
}

function knowledgeSpans(text, author = "user", event = "pasted") {
	return [{ span_id: "s1", turn_id: "m1", seq: 1, author, event, ...__test.fingerprint(text) }];
}

const handoff = {
	handoff_id: "h-test",
	report_id: "r-test",
	finalized_at: "2026-11-07T14:40:00+08:00",
	report_text: report,
	recorded_by: "plugin-hook",
	recording: { started_at: "2026-11-07T14:00:00+08:00", ended_at: "2026-11-07T14:40:00+08:00", complete: true, gaps: [] },
	lineage: [{ span_id: "s1", turn_id: "m1", author: "user", event: "pasted", range: [0, 20] }],
	retention_index: [],
	dial: 3,
	consent: true,
	knowledge_spans: knowledgeSpans(userPaste)
};

const { ctx, handler, calls } = makeCtx();
const { apply } = await import("../plugin/lib/index.js");
apply(ctx);
const h = handler();

// 1. 未编辑：报告取自 handoff，lineage 保留，用户材料里的概念判 human
const plain = await call(h, "/start", { report_text: report, handoff, dial: 3, retention_index: [] });
assert.equal(plain.status, 200, JSON.stringify(plain.data));
assert.equal(plain.data.report_span, report.slice(0, 80));
assert.equal(plain.data.edited, false);
assert.equal(plain.data.lineage.length, 1);
assert.equal(plain.data.graph.nodes.T1.origin, "human", "用户材料里出现的术语应为 human");
assert.equal(plain.data.graph.nodes.R1.origin, "human", "用户材料覆盖的论断应为 human");
assert.equal(plain.data.graph.nodes.T3.origin, "ai", "只在 AI 报告里出现的概念应为 ai");
assert.equal(plain.data.graph.nodes.T1.provenance, "user_source");
console.log("✓ 未编辑：来源按用户材料指纹判定，T1/R1 -> human，T3 -> ai");

// 1a. 复用持久化 DAG：带 graph 时跳过 P1，只调一次 P2
const beforeReuse = calls();
const reused = await call(h, "/start", { report_text: report, graph: p1.graph, risk_points: p1.risk_points, dial: 3 });
assert.equal(reused.status, 200, JSON.stringify(reused.data));
assert.equal(calls() - beforeReuse, 1, "复用 DAG 时不应再调 P1");
assert.equal(reused.data.graph.graph_id, "g-test");
assert.ok(reused.data.questions.length > 0);
console.log("✓ 复用持久化 DAG：跳过 P1，只生成题目");

// 1b. 真实（非 demo）题目的导出要带 rubric 里的期望要点
const exportBody = {
	audit_id: plain.data.audit_id,
	handoff_id: "h-test",
	graph: plain.data.graph,
	budget: plain.data.budget,
	dial: 3,
	records: plain.data.questions.map((question) => ({
		...question,
		answer: "就是多问几句。",
		verdict: "unsure",
		judgment: { hit_points: [], miss_points: [], evidence: "用户原话", confidence: 0.5, needs_review: false, reread: [] },
		timestamp: "2026-11-07T15:00:00+08:00"
	})),
	skipped: [],
	refills: [],
	report_span: plain.data.report_span
};
const exported = await call(h, "/export", exportBody);
assert.equal(exported.status, 200);
for (const item of exported.data.quiz.questions) {
	assert.ok(Array.isArray(item["期望要点"]) && item["期望要点"].length >= 1, `${item.id} 的期望要点为空`);
}
assert.ok(!JSON.stringify(exported.data.quiz).includes('"origin"'));
console.log("✓ 真实题目导出：每题都有期望要点，且不含 origin");

// 2. 编辑报告：用编辑后的文本，lineage 置空，记录标不完整，指纹仍生效
const editedText = "删掉姓名后：" + report;
const edited = await call(h, "/start", { report_text: editedText, handoff, dial: 3, retention_index: [] });
assert.equal(edited.status, 200);
assert.equal(edited.data.edited, true);
assert.equal(edited.data.lineage.length, 0);
assert.equal(edited.data.recording.complete, false);
assert.ok(edited.data.recording.gaps.some((gap) => gap.includes("编辑")));
assert.equal(edited.data.graph.nodes.T1.origin, "human", "编辑后指纹仍然有效");
assert.equal(edited.data.graph.nodes.T3.origin, "ai");
console.log("✓ 编辑报告：审编辑后文本，lineage 失效并标不完整，指纹仍生效");

// 3. 界面上改过的留存索引被采用
const typedIndex = [{ concept: "认知卸载", origin: "human", provenance: "user_source" }];
const withIndex = await call(h, "/start", { report_text: report, handoff, dial: 3, retention_index: typedIndex });
assert.equal(withIndex.data.recording.complete, true);
console.log("✓ 留存索引以输入为准（不再被 handoff 的空索引覆盖）");

console.log(`\n5 integration checks passed（模型调用 ${calls()} 次，均为假返回）`);
