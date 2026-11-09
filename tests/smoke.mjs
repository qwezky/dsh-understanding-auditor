#!/usr/bin/env node
/**
 * 理解审计员插件冒烟测试（不调用模型）。
 *
 * 用法：
 *   node tests/smoke.mjs
 *   DSH_URL=http://127.0.0.1:3080 node tests/smoke.mjs
 *
 * 覆盖：健康检查、演示模式起审、引文逐字、预算、跳过不判错、导出脱敏与声明。
 */
const BASE = process.env.DSH_URL || "http://127.0.0.1:3080";
const API = `${BASE}/dsh-understanding-auditor`;

let passed = 0;
let failed = 0;

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {string} [detail]
 */
function check(name, ok, detail = "") {
	passed += ok ? 1 : 0;
	failed += ok ? 0 : 1;
	console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/**
 * @param {string} path
 * @param {unknown} [body]
 */
async function call(path, body) {
	const response = await fetch(`${API}${path}`, body === undefined
		? { method: "GET" }
		: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	const data = await response.json();
	return { status: response.status, data };
}

const health = await call("/health");
check("宿主健康检查", health.data.ok === true, `${health.data.provider}/${health.data.model}`);

const demo = await call("/start", { mode: "demo", dial: 3 });
const payload = demo.data;
check("演示模式返回 3–5 题", payload.ok === true && payload.questions.length >= 3 && payload.questions.length <= 5, `${payload.questions?.length} 题`);
check("预算 total 与题量一致", payload.budget?.total === payload.questions.length, `${payload.budget?.total} vs ${payload.questions.length}`);
check("每题引文逐字出现在报告里", payload.questions.every((q) => payload.graph.report_span.includes(q.quote) || payload.report_span.includes(q.quote)));
check("题型只在三类内", payload.questions.every((q) => ["复述解释题", "前提变换题", "术语定义题"].includes(q.type)));
check("档位只有 simple/normal", payload.questions.every((q) => ["simple", "normal"].includes(q.tier)));

const question = payload.questions[0];
const unsure = await call("/judge", { question, answer: "不确定", dial: 3 });
check("“不确定”判 unsure 且不记错", unsure.data.ok === true && unsure.data.judgment.verdict === "unsure", unsure.data.judgment?.verdict);
check("判定带 disclaimer", String(unsure.data.judgment?.disclaimer || "").includes("不是对报告的评分"));

const exported = await call("/export", {
	audit_id: payload.audit_id,
	handoff_id: payload.audit_id,
	graph: payload.graph,
	budget: payload.budget,
	dial: 3,
	upgraded: false,
	records: [
		{
			id: question.id,
			stage: "first_pass",
			type: question.type,
			tier: question.tier,
			entry_id: question.entry_id,
			component_id: question.component_id,
			node_id: question.node_id,
			quote: question.quote,
			question: question.question,
			expected_points: question.rubric.expected_points,
			answer: "就是多问几句，让学生多想。",
			verdict: "partial",
			judgment: {
				hit_points: ["追问发生在学习过程中"],
				miss_points: ["未说明为什么能提升参与度"],
				evidence: "用户原话：“就是多问几句，让学生多想。”",
				confidence: 0.82,
				needs_review: false,
				reread: ["§2 第 2 段"]
			},
			timestamp: new Date().toISOString(),
			spot_check: false
		}
	],
	skipped: [],
	refills: [],
	report_span: payload.report_span
});
check("导出成功", exported.data.ok === true && exported.data.quiz?.questions?.length >= 1);
check("导出不含 origin", !JSON.stringify(exported.data.quiz).includes('"origin"'));
check("导出不含正确率/等级", !/正确率|百分比|等级|排名/.test(exported.data.markdown));
check("导出含固定声明", String(exported.data.markdown).includes("不是评分"));
check("导出每题有判定依据", exported.data.quiz.questions.every((q) => q.判定依据 && typeof q.判定依据 === "object"));

const tooThin = await call("/start", { mode: "ai", dial: 3, report_text: "太短了。", retention_index: [] });
check("太短的输入被拒绝", tooThin.status === 422 && tooThin.data.code === "INPUT_TOO_THIN", String(tooThin.data.error || ""));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
