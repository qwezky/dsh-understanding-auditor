#!/usr/bin/env node
/**
 * 附件解析回归：PDF 文本进入用户来源指纹；图片/不支持格式记为 gap。
 *
 * 依赖 pdfjs-dist（可选）。未安装时打印 skip 并以 0 退出。
 * 用法：node tests/attachment.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { apply, __test } from "../plugin/lib/index.js";
import { extractAttachmentText } from "../plugin/lib/attachment-text.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "attachment.pdf");

const extracted = await extractAttachmentText({ name: "attachment.pdf", path: fixture });
if (!extracted.ok && extracted.reason.includes("pdfjs-dist")) {
	console.log("skip：没有安装 pdfjs-dist，附件解析用例跳过");
	process.exit(0);
}
assert.ok(extracted.ok, extracted.reason);
assert.ok(extracted.text.includes("cognitive offloading"), extracted.text);

const cwd = await mkdtemp(join(tmpdir(), "ua-attach-"));
const session = { id: "sess-pdf", seq: 1, header: { cwd } };
const commands = {};
const handlers = {};
const ctx = {
	webServer: { register: () => () => {} },
	commands: { register: (definition) => { commands[definition.name] = definition; return () => {}; } },
	on: (name, handler) => { handlers[name] = handler; return () => {}; },
	effect: (fn) => fn(),
	llm: {
		listProviders: () => [{ id: "fake" }],
		listModels: async () => [{ id: "fake-1" }],
		resolveModelInfo: async () => null,
		stream: async function* () {
			yield {
				type: "text-delta",
				text: JSON.stringify({
					summary: "材料讨论认知卸载与深度学习。",
					concepts: [{ concept: "cognitive offloading", quote: "cognitive offloading reduces deep learning" }]
				})
			};
			yield { type: "finish", reason: { kind: "stop" } };
		}
	},
	get: () => undefined,
	sessions: { get: (id) => (id === session.id ? session : undefined), list: () => [session] },
	logger: { warn: () => {} },
	attachments: { fileHostPath: (ref) => (ref?.name === "attachment.pdf" ? fixture : undefined) }
};
apply(ctx);

await commands.record.handler({ agent: { id: session.id }, rawInput: "start" });
const emit = (type, seq, data) => handlers["session/event"](session, { type, seq, data });
emit("user/message", 2, {
	source: { kind: "user" },
	content: [
		{ type: "file", attachment: { name: "attachment.pdf", bytes: 617 } },
		{ type: "image", attachment: { name: "screenshot.png", bytes: 1000 } }
	]
});
emit("assistant/message", 3, {
	message: { content: [{ type: "text", text: "The report discusses cognitive offloading and deep learning in classrooms." }] }
});

const ended = await commands.record.handler({ agent: { id: session.id }, rawInput: "end" });
assert.equal(ended.kind, "success", ended.text);
const file = ended.text.match(/文件：(.*)/)[1].trim();
const handoff = JSON.parse(await readFile(file, "utf8"));

const attachmentSpan = handoff.knowledge_spans.find((span) => span.event === "attachment" && span.author === "user");
assert.ok(attachmentSpan, "PDF 文本没有进入来源指纹");
assert.ok(handoff.recording.gaps.some((gap) => gap.includes("图片")), "图片未解析应记为 gap");
assert.equal(handoff.recording.complete, false);

const recDir = ended.text.match(/记录目录：(.*)/)[1].trim();
const events = (await readFile(join(recDir, "events.jsonl"), "utf8"))
	.trim()
	.split("\n")
	.map((line) => JSON.parse(line));
const pdfRow = events.find((row) => row.type === "attachment" && row.name === "attachment.pdf");
assert.equal(pdfRow.summary_status, "ok", pdfRow.summary_reason);
assert.ok(pdfRow.concept_count >= 1);
assert.ok(pdfRow.summary.includes("认知卸载"));

const graph = { nodes: { X: { text: "cognitive offloading", kind: "term" } } };
__test.applyLineageProvenance(graph, handoff.report_text, handoff.lineage, handoff.knowledge_spans);
assert.equal(graph.nodes.X.origin, "human", "PDF 里的概念应判 human");

console.log("✓ PDF 文本进入用户来源指纹；图片未解析记为 gap；概念命中 human");
