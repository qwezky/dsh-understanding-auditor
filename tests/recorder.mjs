#!/usr/bin/env node
/**
 * 记录器回归：写作时逐段落盘到工作区的专门文件夹，结束时从文件夹冻结，
 * 不读对话历史；进程重启后仍能结束同一轮记录。
 *
 * 用法：node tests/recorder.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../plugin/lib/index.js";

const cwd = await mkdtemp(join(tmpdir(), "ua-record-"));
const session = { id: "sess-1", seq: 10, header: { cwd } };

function makeCtx() {
	const handlers = {};
	const commands = {};
	const ctx = {
		webServer: { register: () => () => {} },
		commands: {
			register: (definition) => {
				commands[definition.name] = definition;
				return () => {};
			}
		},
		on: (name, handler) => {
			handlers[name] = handler;
			return () => {};
		},
		effect: (fn) => fn(),
		llm: { listProviders: () => [], listModels: async () => [] },
		get: () => undefined,
		sessions: { get: (id) => (id === session.id ? session : undefined), list: () => [session] },
		logger: { warn: () => {} }
	};
	apply(ctx);
	return { ctx, commands, handlers };
}

const first = makeCtx();
const record = (rawInput) => first.commands.record.handler({ agent: { id: session.id }, rawInput });
const emit = (type, seq, data) => first.handlers["session/event"](session, { type, seq, data });
const text = (value) => [{ type: "text", text: value }];

const started = await record("start");
assert.equal(started.kind, "success");
const dir = started.text.match(/记录目录：(.*)/)[1].trim();
const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
assert.equal(meta.status, "recording");
assert.equal(meta.session_id, session.id);
const readEvents = async () =>
	(await readFile(join(dir, "events.jsonl"), "utf8"))
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
assert.equal((await readEvents()).length, 0);

const userMaterial = "用户材料：认知卸载就是把思考外包给工具，会削弱深度学习。";
const part1 = "一、问题提出。过程性追问提升学生的认知参与度，这是本报告的核心判断。".repeat(4);
const chatter = "好的，已修改。";
const oneChar = "嗯";
const part2 = "二、结论。如果追问只发生在学习结束后，教师拿到的只是答案，而不是思路。".repeat(3);
const done = "已完成，正文见上。";

emit("user/message", 11, { source: { kind: "user" }, content: text(userMaterial) });
emit("assistant/message", 12, { message: { content: text(part1) } });
emit("assistant/message", 13, { message: { content: text(chatter) } });
emit("assistant/message", 14, { message: { content: text(oneChar) } });
emit("assistant/message", 15, { message: { content: text(part2) } });
emit("assistant/message", 16, { message: { content: text(done) } });

// 等异步写盘完成（事件处理不阻塞，写盘在后台）
await new Promise((resolve) => setTimeout(resolve, 120));

const status = await record("status");
assert.ok(status.text.includes("报告已累计"), status.text);
assert.ok(status.text.includes("5 段正文"), `正文段数不对：${status.text}`);
const expectedChars = part1.length + chatter.length + oneChar.length + part2.length + done.length + 2 * 4;
assert.ok(status.text.includes(`${expectedChars} 字`), `字数不对：${status.text}`);
assert.ok(status.text.includes(dir), "状态里没有记录目录");

const events = await readEvents();
const parts = events.filter((event) => event.type === "part").sort((left, right) => left.part - right.part);
assert.equal(parts.length, 5);
assert.equal(parts[1].text, chatter, "短消息没有被落盘");
assert.equal(parts[2].text, oneChar, "1 字消息没有被落盘");
assert.equal(parts[4].text, done, "结尾状态句没有被落盘");
assert.ok(events.some((event) => event.type === "span" && event.author === "user"), "用户材料没有落盘");

// 模拟进程重启：新模块实例没有内存状态，只靠文件夹结束
const second = await import("../plugin/lib/index.js?restart=1");
const restarted = (() => {
	const commands = {};
	const handlers = {};
	const ctx = {
		webServer: { register: () => () => {} },
		commands: { register: (definition) => { commands[definition.name] = definition; return () => {}; } },
		on: (name, handler) => { handlers[name] = handler; return () => {}; },
		effect: (fn) => fn(),
		llm: { listProviders: () => [], listModels: async () => [] },
		get: () => undefined,
		sessions: { get: (id) => (id === session.id ? session : undefined), list: () => [session] },
		logger: { warn: () => {} }
	};
	second.apply(ctx);
	return { commands, handlers };
})();
const ended = await restarted.commands.record.handler({ agent: { id: session.id }, rawInput: "end" });
assert.equal(ended.kind, "success", ended.text);
const file = ended.text.match(/文件：(.*)/)[1].trim();
const handoff = JSON.parse(await readFile(file, "utf8"));

assert.equal(handoff.report_text, part2, "默认只应取最后一条报告正文");
assert.ok(!handoff.report_text.includes(chatter), "状态句不应进正文");
assert.ok(!handoff.report_text.includes(done), "结尾状态句不应进正文");
assert.ok(!handoff.report_text.includes(userMaterial), "用户材料不应进正文");
assert.equal(handoff.lineage.length, 1, "正文只应有选中段一条 lineage");
assert.deepEqual(handoff.lineage[0].range, [0, part2.length]);
assert.equal(handoff.report_selection.parts, 5);
assert.ok(handoff.knowledge_spans.some((span) => span.text === undefined && span.author === "ai"), "其他 assistant 段仍应进 span 记录");

assert.ok(handoff.knowledge_spans.some((span) => span.author === "user"), "用户材料没进指纹");
const finalized = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
assert.equal(finalized.status, "finalized");
assert.equal(finalized.handoff_id, handoff.handoff_id);

// 报告写进文件：/record end <path> 应冻结文件，而不是报“没有正文”
const secondStart = await restarted.commands.record.handler({ agent: { id: session.id }, rawInput: "start" });
assert.equal(secondStart.kind, "success", secondStart.text);
const reportFile = join(cwd, "report.md");
const fileReport = "这是一份写在文件里的报告，讨论过程性追问与认知参与度。".repeat(4);
await writeFile(reportFile, fileReport, "utf8");
restarted.handlers["session/event"](session, { type: "user/message", seq: 21, data: { source: { kind: "user" }, content: text("用户材料：认知卸载会削弱深度学习。") } });
const fileEnd = await restarted.commands.record.handler({ agent: { id: session.id }, rawInput: "end report.md" });
assert.equal(fileEnd.kind, "success", fileEnd.text);
const fileHandoff = JSON.parse(await readFile(fileEnd.text.match(/文件：(.*)/)[1].trim(), "utf8"));
assert.equal(fileHandoff.report_source, "file");
assert.equal(fileHandoff.report_text, fileReport);
assert.equal(fileHandoff.lineage.length, 1);
assert.ok(fileHandoff.knowledge_spans.some((span) => span.author === "user"), "文件报告仍应保留用户来源指纹");

console.log("✓ 逐段落盘 → 只取最后一条报告正文 → 重启后从文件夹结束 → 报告文件也能冻结");
