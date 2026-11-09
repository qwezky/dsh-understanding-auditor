#!/usr/bin/env node
/**
 * 来源判定 / 编辑一致性 / 导出字段的单元测试（不需要宿主、不调用模型）。
 *
 * 用法：node tests/unit.mjs
 *
 * 覆盖 v1.9.1 修复的三处：
 *  A. 概念来源按“用户材料指纹”判定，而不是按报告里的字符位置；
 *  B. 载入 handoff 后编辑报告，审计用编辑后的文本，lineage 失效但不静默；
 *  C. 真实（非演示）导出的题库保留“期望要点”。
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __test } from "../plugin/lib/index.js";

let passed = 0;
function check(name, fn) {
	fn();
	passed += 1;
	console.log(`✓ ${name}`);
}

const span = (author, event, text, seq = 1) => ({
	span_id: `${author}-${event}-${seq}`,
	author,
	event,
	seq,
	...__test.fingerprint(text)
});

// A. 分类
check("短祈使句是写作指令，不算来源", () => {
	assert.equal(__test.isInstruction("帮我写一段关于认知卸载的部分"), true);
	assert.equal(__test.isInstruction("过程性追问能提升学生的认知参与度，因为它迫使学生把思路说出来。"), false);
});
check("长指令也算指令，不能把主题词当来源", () => {
	assert.equal(__test.isInstruction("请帮我写一篇关于认知卸载的报告，1500 字，分三部分，先给框架"), true);
	assert.equal(__test.isInstruction("你给我把过程性追问那段改得学术一点，顺便补上认知卸载的文献"), true);
	assert.equal(__test.isInstruction("已有研究表明，认知卸载会削弱深度学习。"), false);
});
check("长问句仍是提问", () => {
	assert.equal(__test.isInquiry("这段报告里的过程性追问到底怎么理解？为什么说它发生在过程中？"), true);
});
check("短问句是提问，不算来源", () => {
	assert.equal(__test.isInquiry("认知卸载是什么意思？"), true);
	assert.equal(__test.isInquiry("过程性追问能提升参与度吗？"), true);
	assert.equal(__test.isInquiry("过程性追问能提升学生的认知参与度。"), false);
});

// B. 概念来源
const graph = () => ({
	nodes: {
		T1: { text: "过程性追问", kind: "term" },
		R1: { text: "过程性追问提升学生的认知参与度", kind: "claim" },
		T3: { text: "认知卸载", kind: "term" },
		R2: { text: "减少认知卸载是提升参与度的关键", kind: "claim" }
	}
});
const report =
	"该方案通过过程性追问提升学生的认知参与度。已有研究表明，认知卸载会削弱深度学习，因此减少认知卸载是提升参与度的关键。";

check("用户改写过的概念仍判 human（不再要求报告逐字复用）", () => {
	const g = graph();
	__test.applyLineageProvenance(g, report, [], [
		span("user", "pasted", "过程性追问能提升学生的认知参与度，因为它迫使学生把思路说出来。"),
		span("ai", "generated", report, 2)
	]);
	assert.equal(g.nodes.T1.origin, "human");
	assert.equal(g.nodes.R1.origin, "human");
	assert.equal(g.nodes.T1.provenance, "user_source");
});

check("只有 AI 段落覆盖的概念保持 ai", () => {
	const g = graph();
	__test.applyLineageProvenance(g, report, [], [
		span("user", "pasted", "过程性追问能提升学生的认知参与度，因为它迫使学生把思路说出来。"),
		span("ai", "generated", report, 2)
	]);
	assert.equal(g.nodes.T3.origin, "ai");
	assert.equal(g.nodes.R2.origin, "ai");
});

check("用户只问“是什么”，不会把概念变成已知", () => {
	const g = graph();
	__test.applyLineageProvenance(g, report, [], [
		span("user", "inquiry", "认知卸载是什么意思？"),
		span("ai", "generated", report, 2)
	]);
	assert.equal(g.nodes.T3.origin, "ai");
	assert.notEqual(g.nodes.T3.provenance, "user_source");
});

check("长材料里靠后的概念也能命中（不因指纹截断漏判）", () => {
	const g = { nodes: { T3: { text: "认知卸载", kind: "term" } } };
	const longText = "背景材料。".repeat(500) + "认知卸载就是把思考外包给工具。";
	__test.applyLineageProvenance(g, "报告", [], [span("user", "pasted", longText)]);
	assert.equal(g.nodes.T3.origin, "human");
});

check("用户只喂一个术语（4 字）也判 human", () => {
	const g = graph();
	__test.applyLineageProvenance(g, report, [], [
		span("user", "typed", "认知卸载"),
		span("ai", "generated", report, 2)
	]);
	assert.equal(g.nodes.T3.origin, "human");
	assert.equal(g.nodes.T3.provenance, "user_source");
});

check("用户用自己的话重写 -> user_note", () => {
	const g = graph();
	__test.applyLineageProvenance(g, report, [], [
		span("user", "rewrite", "认知卸载就是把该自己想的步骤交给工具"),
		span("ai", "generated", report, 2)
	]);
	assert.equal(g.nodes.T3.origin, "human");
	assert.equal(g.nodes.T3.provenance, "user_note");
});

check("用户与 AI 都覆盖 -> human + ai_variant", () => {
	const g = graph();
	__test.applyLineageProvenance(g, report, [], [
		span("user", "pasted", "认知卸载"),
		span("ai", "generated", report, 2)
	]);
	assert.equal(g.nodes.T3.origin, "human");
	assert.equal(g.nodes.T3.ai_variant, true);
});

check("旧 handoff（没有指纹）仍按 range 判定，且保守", () => {
	const g = graph();
	__test.applyLineageProvenance(
		g,
		report,
		[
			{ span_id: "s1", author: "user", event: "pasted", range: [0, 20] },
			{ span_id: "s2", author: "ai", event: "generated", range: [0, report.length] }
		],
		[]
	);
	assert.equal(g.nodes.T1.origin, "human");
	assert.equal(g.nodes.T3.origin, "ai");
});

check("人类祖先默认确认：有后继的人类节点不再出题", () => {
	const graph = {
		nodes: {
			H: { origin: "human", children: ["C"] },
			C: { origin: "ai", children: [] }
		}
	};
	__test.markAssumedKnown(graph);
	assert.equal(graph.nodes.H.assumed_known, true);
	assert.equal(graph.nodes.C.assumed_known, undefined);
});

// B2. 指纹预算与优先级
check("指纹优先保留用户材料，提问不进指纹", () => {
	const spans = [];
	for (let i = 1; i <= 61; i += 1) {
		spans.push({ span_id: `a${i}`, author: "ai", event: "generated", seq: i + 1, text: `AI 第 ${i} 段：过程性追问与认知参与度的说明。` });
	}
	spans.push({ span_id: "u1", author: "user", event: "pasted", seq: 1, text: "用户材料：认知卸载会削弱深度学习。" });
	spans.push({ span_id: "q1", author: "user", event: "inquiry", seq: 2, text: "认知卸载是什么意思？" });
	const { knowledgeSpans, dropped } = __test.buildKnowledgeSpans(spans);
	assert.ok(knowledgeSpans.some((span) => span.span_id === "u1"), "用户材料必须在");
	assert.ok(!knowledgeSpans.some((span) => span.span_id === "q1"), "提问不能进指纹");
	assert.ok(knowledgeSpans.length <= 60);
	assert.ok(dropped >= 1);
});

check("4 字用户术语能进指纹（与记录器下限一致）", () => {
	const { knowledgeSpans } = __test.buildKnowledgeSpans([
		{ span_id: "u1", author: "user", event: "typed", seq: 1, text: "认知卸载" },
		{ span_id: "u2", author: "user", event: "typed", seq: 2, text: "好" }
	]);
	assert.equal(knowledgeSpans.length, 1);
	assert.equal(knowledgeSpans[0].span_id, "u1");
});

check("超预算时丢弃整段，而不是截断半段", () => {
	const spans = [];
	for (let i = 1; i <= 20; i += 1) {
		spans.push({ span_id: `u${i}`, author: "user", event: "pasted", seq: i, text: "认知卸载".repeat(600) });
	}
	const { knowledgeSpans, dropped } = __test.buildKnowledgeSpans(spans);
	assert.ok(dropped > 0);
	assert.ok(knowledgeSpans.length >= 1);
	const total = knowledgeSpans.reduce((sum, span) => sum + span.bi.length + span.tri.length, 0);
	assert.ok(total <= 80000, `指纹总量 ${total} 不应超过预算`);
});

check("附件摘要只保留逐字存在的引文", () => {
	const text = "认知卸载会削弱深度学习，因此减少认知卸载很关键。";
	const out = __test.validateAttachmentSummary(text, {
		summary: "……",
		concepts: [
			{ concept: "认知卸载", quote: "认知卸载会削弱深度学习" },
			{ concept: "编造", quote: "这句话不在附件里" },
			{ concept: "空格差异", quote: "认知卸载会 削弱  深度学习" }
		]
	});
	assert.equal(out.concepts.length, 2);
	assert.deepEqual(out.concepts.map((item) => item.concept), ["认知卸载", "空格差异"]);
});

// C. 编辑一致性
const handoff = {
	handoff_id: "h-1",
	report_text: "原始报告：过程性追问提升认知参与度。".repeat(6),
	lineage: [{ span_id: "s1", author: "ai", event: "generated", range: [0, 40] }],
	retention_index: [{ concept: "认知卸载", origin: "human", provenance: "user_source" }],
	recording: { started_at: "2026-11-07T14:00:00+08:00", ended_at: "2026-11-07T14:40:00+08:00", complete: true, gaps: [] },
	knowledge_spans: [span("user", "pasted", "过程性追问能提升认知参与度")]
};

check("没改报告：用 handoff 原文、保留 lineage", () => {
	const r = __test.resolveHandoffInput(handoff, { report_text: handoff.report_text });
	assert.equal(r.edited, false);
	assert.equal(r.report, handoff.report_text);
	assert.equal(r.lineage.length, 1);
	assert.equal(r.recording.complete, true);
});

check("改过报告：审编辑后的文本，lineage 失效并标不完整", () => {
	const edited = handoff.report_text.replace("原始报告", "删掉姓名后的报告");
	const r = __test.resolveHandoffInput(handoff, { report_text: edited });
	assert.equal(r.edited, true);
	assert.equal(r.report, edited);
	assert.equal(r.lineage.length, 0);
	assert.equal(r.recording.complete, false);
	assert.ok(r.recording.gaps.some((gap) => gap.includes("编辑")));
	assert.equal(r.knowledgeSpans.length, 1, "指纹仍然保留");
});

check("整篇换成另一份报告：旧指纹作废，不硬套来源", () => {
	const other =
		"这是一份完全不同的报告，讨论的是课堂纪律与作业布置，和过程性追问没有关系。".repeat(4);
	const r = __test.resolveHandoffInput(handoff, { report_text: other });
	assert.equal(r.edited, true);
	assert.equal(r.knowledgeSpans.length, 0);
	assert.ok(r.recording.gaps.some((gap) => gap.includes("差异过大")));
});

check("界面上改过的留存索引用输入，不被 handoff 覆盖", () => {
	const typed = [{ concept: "过程性追问", origin: "human", provenance: "user_source" }];
	const r = __test.resolveHandoffInput(handoff, { report_text: handoff.report_text, retention_index: typed });
	assert.deepEqual(r.retentionIndex, typed);
});

// D. 导出期望要点
const question = {
	id: "Q1",
	type: "复述解释题",
	tier: "normal",
	entry_id: "R1",
	component_id: "G-01",
	node_id: "R1",
	quote: "该方案通过过程性追问提升学生的认知参与度。",
	question: "请不用原词解释这句话。",
	rubric: { expected_points: ["追问发生在学习过程中", "追问迫使学生外化思路"], must_not: [] },
	answer: "就是多问几句。",
	verdict: "partial",
	judgment: { hit_points: ["追问发生在学习过程中"], miss_points: [], evidence: "用户原话", confidence: 0.8, needs_review: false, reread: ["§2"] },
	timestamp: "2026-11-07T15:00:00+08:00",
	stage: "first_pass",
	spot_check: false
};
const graphForExport = { nodes: { R1: { text: "过程性追问提升认知参与度" }, T1: { text: "过程性追问" } } };

check("真实记录只有 rubric 时，导出仍带期望要点", () => {
	const out = __test.exportAudit({
		audit_id: "a-1",
		handoff_id: "h-1",
		graph: graphForExport,
		dial: 3,
		records: [question],
		skipped: [],
		refills: [],
		report_span: "报告片段"
	});
	assert.equal(out.quiz.questions[0]["期望要点"].length, 2);
});

check("跳过的题也从 rubric 回填期望要点", () => {
	const skipped = { ...question, id: "Q2" };
	delete skipped.answer;
	delete skipped.verdict;
	const out = __test.exportAudit({
		audit_id: "a-2",
		handoff_id: "h-1",
		graph: graphForExport,
		dial: 3,
		records: [],
		skipped: [skipped],
		refills: [],
		report_span: "报告片段"
	});
	const exported = out.quiz.questions.find((item) => item.id === "Q2");
	assert.equal(exported["判定"], "skipped");
	assert.equal(exported["期望要点"].length, 2);
});

check("导出不含 origin、不含正确率", () => {
	const out = __test.exportAudit({
		audit_id: "a-3",
		handoff_id: "h-1",
		graph: graphForExport,
		dial: 3,
		records: [question],
		skipped: [],
		refills: [],
		report_span: "报告片段"
	});
	assert.ok(!JSON.stringify(out.quiz).includes('"origin"'));
	assert.ok(!/正确率|等级|排名/.test(out.markdown));
	assert.ok(out.markdown.includes("不是评分"));
});

// D. DAG/审计状态落盘
const stateCwd = await mkdtemp(join(tmpdir(), "ua-state-"));
const stateCtx = { get: () => undefined };
const savedState = await __test.saveAuditState(stateCtx, {
	cwd: stateCwd,
	state: {
		session: { audit_id: "a-state-1", graph: { nodes: {}, edges: [] }, budget: { total: 3 } },
		report: "报告正文",
		screen: "quiz",
		current: { id: "Q1", node_id: "T1" },
		flow: { records: [], skipped: [], queue: [], asked: [], confirmed: [], chased: 0, refills: [], refillIdx: 0 }
	}
});
assert.ok(savedState.file.includes("a-state-1.json"));
const latestState = await __test.readLatestAuditState(stateCtx, stateCwd);
assert.equal(latestState.state.session.audit_id, "a-state-1");
assert.equal(latestState.state.current.id, "Q1");
passed += 1;
console.log("✓ 审计状态落盘 → 恢复");

// E. 报告 DAG 持久化：按报告正文哈希存取
const dagCwd = await mkdtemp(join(tmpdir(), "ua-dag-"));
const dagReport = "这是一份用于 DAG 持久化测试的报告正文，讨论过程性追问与认知参与度。".repeat(3);
const dagGraph = {
	graph_id: "g-test",
	nodes: { T1: { text: "过程性追问", kind: "term", parents: [], children: [] } },
	edges: [],
	components: [{ id: "c1", entry_ids: ["T1"], node_ids: ["T1"] }]
};
const savedDag = await __test.saveDag(stateCtx, {
	cwd: dagCwd,
	report_text: dagReport,
	report_file: "report.md",
	graph: dagGraph,
	risk_points: [{ node_id: "T1", risk: "high" }]
});
assert.equal(savedDag.report_id, __test.reportDigest(dagReport));
const loadedDag = await __test.loadDag(stateCtx, dagCwd, savedDag.report_id);
assert.equal(loadedDag.dag.graph.graph_id, "g-test");
assert.equal(loadedDag.dag.report_file, "report.md");
passed += 1;
console.log("✓ 报告 DAG 按正文哈希落盘 → 读取");

console.log(`\n${passed} passed`);
