window.__ModuleLoader__.load({
	id: "dsh-plugin-understanding-auditor",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const h = react.createElement;

		const ID = "dsh-plugin-understanding-auditor/tab";
		const KIND = "understandingAudit";
		const API = "/dsh-understanding-auditor";
		const DISCLAIMER =
			"本结果是对你理解状态的一次抽样提示，不是评分，也不代表报告内容正确或错误。题目只覆盖了本轮抽到的知识点，未覆盖的部分不代表没有问题。请把它当作回读的线索，而不是结论。";
		const DEMO_REPORT =
			"该方案通过过程性追问提升学生的认知参与度。相比于传统课堂提问，过程性追问不追求标准答案，而是不断逼近学生的真实思路。已有研究表明，认知卸载会削弱深度学习，因此减少认知卸载是提升参与度的关键。如果追问只发生在学习结束后，学生已经离开思考现场，教师拿到的就只是答案，而不是思路。这也是报告把“过程中”单独提出来的原因。";
		const DEMO_INDEX = JSON.stringify(
			[
				{ concept: "认知卸载", origin: "human", self_rating: "can_explain", note_id: "n-12", source: "文献[3]" },
				{ concept: "认知参与度", origin: "ai", self_rating: "heard_only", note_id: "n-08" },
				{ concept: "过程性追问", origin: "ai", self_rating: "heard_only" }
			],
			null,
			2
		);
		const CSS = `
.ua-root{height:100%;overflow:auto;box-sizing:border-box;padding:10px 12px 28px;font-size:13px;line-height:1.62;color:var(--dsh-text,inherit)}
.ua-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.ua-title{font-size:15px;font-weight:650;margin:0}
.ua-sub{font-size:12px;opacity:.65;margin:0 0 10px}
.ua-seg{display:flex;gap:4px;flex-wrap:wrap;margin:6px 0 10px}
.ua-seg button{border:1px solid rgba(127,127,127,.28);background:transparent;color:inherit;border-radius:999px;padding:3px 10px;font-size:12px;cursor:pointer}
.ua-seg button[data-on="1"]{background:rgba(59,130,246,.16);border-color:rgba(59,130,246,.55);font-weight:600}
.ua-card{border:1px solid rgba(127,127,127,.24);border-radius:10px;padding:10px 11px;margin:8px 0;background:rgba(127,127,127,.035)}
.ua-label{display:block;font-size:12px;font-weight:600;margin:8px 0 4px;opacity:.85}
.ua-textarea{width:100%;box-sizing:border-box;border:1px solid rgba(127,127,127,.3);border-radius:8px;background:rgba(127,127,127,.05);color:inherit;padding:8px;font:inherit;font-size:12.5px;line-height:1.55;resize:vertical}
.ua-textarea:focus{outline:2px solid rgba(59,130,246,.35);outline-offset:1px}
.ua-input{width:100%;box-sizing:border-box;border:1px solid rgba(127,127,127,.3);border-radius:8px;background:rgba(127,127,127,.05);color:inherit;padding:7px 8px;font:inherit;font-size:12.5px;line-height:1.5}
.ua-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ua-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:1px solid rgba(127,127,127,.32);border-radius:8px;background:transparent;color:inherit;padding:6px 12px;font-size:12.5px;cursor:pointer;white-space:nowrap}
.ua-btn:hover{background:rgba(127,127,127,.1)}
.ua-btn:disabled{opacity:.45;cursor:not-allowed}
.ua-btn.primary{background:rgba(59,130,246,.18);border-color:rgba(59,130,246,.6);font-weight:650}
.ua-btn.ghost{border-color:transparent;opacity:.8}
.ua-btn.danger{color:#b91c1c;border-color:rgba(185,28,28,.35)}
.ua-muted{opacity:.62;font-size:12px}
.ua-note{border-left:3px solid rgba(59,130,246,.6);padding:2px 0 2px 8px;margin:8px 0;font-size:12px;opacity:.85}
.ua-err{border:1px solid rgba(185,28,28,.45);background:rgba(185,28,28,.08);color:#b91c1c;border-radius:8px;padding:8px;margin:8px 0;font-size:12px;white-space:pre-wrap}
.ua-warn{border:1px solid rgba(180,83,9,.45);background:rgba(180,83,9,.08);color:#b45309;border-radius:8px;padding:7px 9px;margin:6px 0;font-size:12px}
.ua-ok{border:1px solid rgba(22,163,74,.4);background:rgba(22,163,74,.08);border-radius:8px;padding:7px 9px;margin:6px 0;font-size:12px}
.ua-badge{display:inline-block;border:1px solid rgba(127,127,127,.32);border-radius:999px;padding:0 7px;font-size:11px;line-height:18px;opacity:.85}
.ua-badge.hot{border-color:rgba(194,65,12,.5);color:#c2410c}
.ua-q{font-size:14px;font-weight:600;line-height:1.55;margin:4px 0 8px}
.ua-quote{font-size:12px;opacity:.8;border-left:2px solid rgba(127,127,127,.4);padding-left:8px;margin:6px 0}
.ua-graph{width:100%;overflow:auto;border:1px solid rgba(127,127,127,.2);border-radius:10px;background:rgba(127,127,127,.03)}
.ua-node-detail{font-size:12px;opacity:.82;margin-top:6px}
.ua-table{width:100%;border-collapse:collapse;font-size:12px}
.ua-table th,.ua-table td{text-align:left;border-bottom:1px solid rgba(127,127,127,.16);padding:4px 5px;vertical-align:top}
.ua-table th{font-weight:600;opacity:.7}
.ua-symbol{font-size:14px;text-align:center}
.ua-list{margin:4px 0 0;padding-left:18px}
.ua-list li{margin:2px 0}
.ua-progress{height:5px;border-radius:999px;background:rgba(127,127,127,.18);overflow:hidden;margin:8px 0}
.ua-progress > div{height:100%;background:rgba(59,130,246,.75)}
.ua-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;white-space:pre-wrap;word-break:break-word}
.ua-kv{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:12px;margin:6px 0}
.ua-kv div:nth-child(odd){opacity:.6}
.ua-spin{display:inline-block;width:12px;height:12px;border:2px solid rgba(127,127,127,.35);border-top-color:currentColor;border-radius:50%;animation:ua-spin .8s linear infinite}
@keyframes ua-spin{to{transform:rotate(360deg)}}
`;

		/**
		 * Same-origin JSON helper.
		 * @param {string} path
		 * @param {unknown} [body]
		 * @returns {Promise<any>}
		 */
		async function api(path, body) {
			const res = await fetch(`${API}${path}`, body === undefined
				? { method: "GET" }
				: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
			let data;
			try {
				data = await res.json();
			} catch {
				throw new Error(`宿主返回了非 JSON 响应（HTTP ${res.status}）`);
			}
			if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
			return data;
		}

		/**
		 * SHA-256 of the report text; the same key the host uses for the DAG store.
		 * @param {string} text
		 * @returns {Promise<string>}
		 */
		async function sha256Hex(text) {
			const bytes = new TextEncoder().encode(String(text));
			const digest = await crypto.subtle.digest("SHA-256", bytes);
			return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
		}

		/**
		 * Parse the retention index textarea: JSON array, or one concept per line
		 * with `概念 | origin | self_rating | note_id | source`.
		 * @param {string} text
		 * @returns {any[]}
		 */
		function parseIndex(text) {
			const source = String(text || "").trim();
			if (!source) return [];
			try {
				const value = JSON.parse(source);
				if (Array.isArray(value)) return value;
			} catch {
				/* fall through to line parsing */
			}
			return source
				.split(/\n+/)
				.map((line) => line.trim())
				.filter(Boolean)
				.map((line) => {
					const parts = line.split(/\s*[|,，]\s*/);
					return {
						concept: parts[0],
						origin: parts[1] === "human" ? "human" : "ai",
						self_rating: ["can_explain", "heard_only", "no_memory", "no_record"].includes(parts[2])
							? parts[2]
							: "no_record",
						note_id: parts[3] || null,
						source: parts[4] || undefined
					};
				});
		}

		/**
		 * Ancestors of a node (prereq closure).
		 * @param {any} graph
		 * @param {string} id
		 * @returns {string[]}
		 */
		function ancestors(graph, id) {
			const out = [];
			const seen = new Set([id]);
			const stack = [id];
			while (stack.length) {
				const current = stack.pop();
				for (const parent of graph.nodes[current]?.parents || []) {
					if (seen.has(parent)) continue;
					seen.add(parent);
					out.push(parent);
					stack.push(parent);
				}
			}
			return out;
		}

		/**
		 * Render the DAG as a small SVG.
		 * @param {{graph: any, statuses?: Record<string,string>, active?: string, onPick?: (id:string)=>void}} props
		 */
		function GraphView(props) {
			const graph = props.graph;
			const nodes = graph?.nodes || {};
			const levels = {};
			for (const [id, node] of Object.entries(nodes)) {
				const level = Number.isFinite(node.level) ? node.level : 1;
				(levels[level] ||= []).push(id);
			}
			const maxLevel = Math.max(1, ...Object.keys(levels).map(Number));
			const rows = Math.max(1, ...Object.values(levels).map((list) => list.length));
			const boxW = 142;
			const boxH = 44;
			const gapX = 24;
			const gapY = 22;
			const width = maxLevel * (boxW + gapX) + 8;
			const height = rows * (boxH + gapY) + 8;
			const position = {};
			for (const [levelText, ids] of Object.entries(levels)) {
				const level = Number(levelText);
				ids.forEach((id, index) => {
					position[id] = { x: 8 + (level - 1) * (boxW + gapX), y: 8 + index * (boxH + gapY) };
				});
			}
			const statusColor = {
				"●": "#15803d",
				"○": "#c2410c",
				"◐": "#b45309",
				"⊘": "#6d28d9",
				"◌": "#0369a1",
				"·": "#6b7280"
			};
			const edges = graph?.edges || [];
			return h(
				"div",
				null,
				h(
					"svg",
					{ className: "ua-graph", viewBox: `0 0 ${width} ${height}`, style: { height, minHeight: 120 }, role: "img", "aria-label": "知识 DAG" },
					h(
						"defs",
						null,
						h("marker", { id: "ua-arrow", viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: "auto" }, h("path", { d: "M0,0 L8,4 L0,8 z", fill: "rgba(127,127,127,.55)" }))
					),
					edges.map((edge, index) => {
						const a = position[edge.from];
						const b = position[edge.to];
						if (!a || !b) return null;
						const x1 = a.x + boxW;
						const y1 = a.y + boxH / 2;
						const x2 = b.x;
						const y2 = b.y + boxH / 2;
						const mid = (x1 + x2) / 2;
						return h("path", {
							key: `e${index}`,
							d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`,
							fill: "none",
							stroke: "rgba(127,127,127,.45)",
							"stroke-width": 1.2,
							"marker-end": "url(#ua-arrow)"
						});
					}),
					Object.entries(nodes).map(([id, node]) => {
						const p = position[id];
						if (!p) return null;
						const symbol = props.statuses?.[id] || "·";
						const active = props.active === id;
						return h(
							"g",
							{ key: id, style: { cursor: "pointer" }, onClick: () => props.onPick?.(id) },
							h("rect", {
								x: p.x,
								y: p.y,
								width: boxW,
								height: boxH,
								rx: 8,
								fill: statusColor[symbol] || "#6b7280",
								opacity: active ? 1 : 0.86,
								stroke: active ? "rgba(59,130,246,.95)" : "rgba(255,255,255,.25)",
								"stroke-width": active ? 2.4 : 1
							}),
							h(
								"text",
								{ x: p.x + 8, y: p.y + 17, fill: "#fff", "font-size": 11, "font-weight": 600 },
								`${symbol} ${id}`
							),
							h(
								"text",
								{ x: p.x + 8, y: p.y + 33, fill: "rgba(255,255,255,.92)", "font-size": 10 },
								String(node.text || "").slice(0, 13)
							)
						);
					})
				),
				props.picked && nodes[props.picked]
					? h(
							"div",
							{ className: "ua-node-detail" },
							h("b", null, `${props.picked} · ${nodes[props.picked].kind}`),
							`  ${nodes[props.picked].text}（风险 ${nodes[props.picked].risk}）`,
							nodes[props.picked].parents?.length ? `；前置：${nodes[props.picked].parents.join("、")}` : "；无前置"
						)
					: null
			);
		}

		/**
		 * The right-sidebar page: input → graph/questions → refill → summary.
		 */
		function AuditTab(props) {
			const cwd = props && typeof props.useSession === "function" ? props.useSession((state) => state.cwd) : undefined;
			const [health, setHealth] = react.useState(null);
			const [screen, setScreen] = react.useState("input");
			const [report, setReport] = react.useState("");
			const [reportFile, setReportFile] = react.useState("");
			const [savedDag, setSavedDag] = react.useState(null);
			const [indexText, setIndexText] = react.useState("");
			const [dial, setDial] = react.useState(3);
			const [demo, setDemo] = react.useState(false);
			const [consent, setConsent] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState("");
			const [session, setSession] = react.useState(null);
			const [current, setCurrent] = react.useState(null);
			const [answer, setAnswer] = react.useState("");
			const [followupAnswer, setFollowupAnswer] = react.useState("");
			const [picked, setPicked] = react.useState("");
			const [refillText, setRefillText] = react.useState("");
			const [refillNote, setRefillNote] = react.useState("");
			const [exported, setExported] = react.useState(null);
			const [savedPath, setSavedPath] = react.useState("");
			const [stateNote, setStateNote] = react.useState("");
			const [handoff, setHandoff] = react.useState(null);
			const [handoffFile, setHandoffFile] = react.useState("");
			const [, rerender] = react.useReducer((x) => x + 1, 0);
			const fileRef = react.useRef(null);

			const flow = react.useRef({
				records: [],
				skipped: [],
				queue: [],
				asked: [],
				upgraded: false,
				upgradedEntry: null,
				spotDone: false,
				refills: [],
				refillIdx: 0
			});

			react.useEffect(() => {
				let alive = true;
				api("/health")
					.then((value) => alive && setHealth(value))
					.catch((reason) => alive && setHealth({ ok: false, error: String(reason.message || reason) }));
				return () => {
					alive = false;
				};
			}, []);

			// DAG/audit state is written to the workspace after every judgment;
			// reopening the panel restores the round instead of rebuilding it.
			react.useEffect(() => {
				void loadState(true);
			}, [cwd]);

			const budget = session?.budget || null;
			const editedReport = Boolean(
				handoff && report.trim() && report.trim() !== String(handoff.report_text || "").trim()
			);
			const totalFirst = flow.current.records.filter((r) => r.stage !== "reask").length + flow.current.queue.length;
			const progressTotal = budget ? budget.total : 0;
			const progressDone = flow.current.records.filter((r) => r.stage === "first_pass" || r.stage === "spot").length;

			/**
			 * Push questions onto the queue and show the next one.
			 * @param {any[]} questions
			 */
			function enqueue(questions) {
				if (!questions?.length) return;
				flow.current.queue.push(...questions);
				rerender();
			}

			/** Show the next queued question, or end the round when empty. */
			function next() {
				const question = flow.current.queue.shift();
				rerender();
				if (!question) {
					endRound();
					return;
				}
				const nextCurrent = { ...question, firstAnswer: "", followupUsed: false, stage: question.mode === "variant" ? "reask" : question.mode === "spot" ? "spot" : "first_pass" };
				setCurrent(nextCurrent);
				setAnswer("");
				setFollowupAnswer("");
				setPicked(question.node_id);
				setScreen("quiz");
				void saveState({ screen: "quiz", current: nextCurrent });
			}

			/** End the question queue: refill skipped nodes, then summarize. */
			async function endRound() {
				const skipped = flow.current.skipped;
				const limit = budget?.reaskLimit ?? 1;
				if (skipped.length && limit > 0) {
					setBusy(true);
					setError("");
					try {
						const cards = [];
						for (const skip of skipped.slice(0, limit)) {
							try {
								const result = await api("/micro", {
									node_id: skip.node_id,
									quote: skip.quote,
									source_span: skip.source_span || "",
									report_text: report
								});
								cards.push({ ...skip, micro: result.card?.micro || "报告没有展开这一点。", grounded: Boolean(result.card?.grounded), refillText: "", check: null, reasked: false, reaskedCorrect: false });
							} catch (reason) {
								cards.push({ ...skip, micro: `补全卡生成失败：${reason.message}`, grounded: false, refillText: "", check: null, reasked: false, reaskedCorrect: false });
							}
						}
						flow.current.refills = cards;
						flow.current.refillIdx = 0;
						setRefillText("");
						setRefillNote("");
						setScreen("refill");
						void saveState({ screen: "refill" });
					} finally {
						setBusy(false);
					}
					return;
				}
				setScreen("summary");
				void saveState({ screen: "summary" });
			}

			/**
			 * Maybe add one spot-check question after a correct first-round answer.
			 * @param {any} record
			 */
			async function maybeSpot(record) {
				if (flow.current.spotDone || record.verdict !== "correct" || record.stage !== "first_pass") return;
				if (!session?.graph || !budget) return;
				const total = flow.current.records.filter((r) => r.stage !== "reask").length + flow.current.queue.length;
				if (total >= 5) return;
				// 可复现抽查：同一 audit_id + node_id 重复审计抽到同一个点。
				let seed = 2166136261;
				for (const char of `${session.handoff_id || session.report_span}:${record.node_id}`) {
					seed ^= char.codePointAt(0);
					seed = Math.imul(seed, 16777619);
				}
				if ((seed >>> 0) / 4294967296 >= (budget.spotRate ?? 0.3)) return;
				const eligible = [];
				for (const id of ancestors(session.graph, record.node_id)) {
					if (session.graph.nodes[id]?.origin === "ai" && !flow.current.asked.includes(id) && !flow.current.confirmed.includes(id)) eligible.push(id);
				}
				for (const [id, node] of Object.entries(session.graph.nodes)) {
					if (node.origin === "ai" && !flow.current.asked.includes(id) && !flow.current.confirmed.includes(id) && id !== record.node_id) eligible.push(id);
				}
				// Seeded pick from the whole pool, not "always the first ancestor".
				const nodeId = eligible[Math.floor(((seed >>> 0) / 4294967296) * eligible.length)];
				if (!nodeId) return;
				flow.current.spotDone = true;
				try {
					const result = await api("/spot", {
						graph: session.graph,
						target: { node_id: nodeId, entry_id: record.entry_id, tier: "normal" },
						entry_id: record.entry_id,
						component_id: record.component_id,
						dial,
						asked: flow.current.asked.map((id) => ({ node_id: id })),
						report_text: report
					});
					if (result.questions?.length) enqueue(result.questions);
				} catch (reason) {
					setError(`抽查题生成失败，已跳过：${reason.message}`);
				}
			}

			/**
			 * Maybe upgrade one failed simple-tier entry with two normal questions.
			 * @param {any} record
			 */
			async function maybeUpgrade(record) {
				if (flow.current.upgraded || record.tier !== "simple" || record.verdict === "correct" || record.stage !== "first_pass") return;
				const room = 7 - (flow.current.records.filter((r) => r.stage !== "reask").length + flow.current.queue.length);
				if (room <= 0) return;
				flow.current.upgraded = true;
				flow.current.upgradedEntry = record.entry_id;
				try {
					const result = await api("/upgrade", {
						graph: session.graph,
						entry_id: record.entry_id,
						component_id: record.component_id,
						tier: "normal",
						dial,
						asked: flow.current.asked.map((id) => ({ node_id: id })),
						report_text: report
					});
					enqueue((result.questions || []).slice(0, room));
					setError("");
				} catch (reason) {
					setError(`升级题生成失败：${reason.message}（已保留缺口）`);
				}
			}

			/**
			 * Wrong/partial on a normal question: chase the unconfirmed parents
			 * once per audit, instead of walking the fixed queue.
			 * @param {any} record
			 */
			async function maybeChaseGap(record) {
				if (flow.current.chased >= 1 || record.tier !== "normal" || record.stage !== "first_pass") return;
				if (record.verdict !== "wrong" && record.verdict !== "partial") return;
				if (!session?.graph) return;
				const room = 7 - (flow.current.records.filter((r) => r.stage !== "reask").length + flow.current.queue.length);
				if (room <= 0) return;
				flow.current.chased = 1;
				try {
					const result = await api("/upgrade", {
						graph: session.graph,
						entry_id: record.node_id,
						component_id: record.component_id,
						tier: "normal",
						dial,
						asked: flow.current.asked.map((id) => ({ node_id: id })),
						report_text: report
					});
					enqueue((result.questions || []).slice(0, Math.min(2, room)));
					setError("");
				} catch (reason) {
					setError(`缺口追问生成失败：${reason.message}（已保留缺口）`);
				}
			}

			/**
			 * Finalize one judged (or skipped) question and move on.
			 * @param {any} record
			 */
			async function finalize(record) {
				flow.current.records.push(record);
				if (!flow.current.asked.includes(record.node_id)) flow.current.asked.push(record.node_id);
				if (record.verdict === "correct" && session?.graph) {
					for (const id of [record.node_id, ...ancestors(session.graph, record.node_id)]) {
						if (!flow.current.confirmed.includes(id)) flow.current.confirmed.push(id);
					}
					// 蕴含刀：祖先已推断确认，队列里还没问的祖先题直接省掉。
					flow.current.queue = flow.current.queue.filter(
						(item) => item.stage === "reask" || item.spot_check || !flow.current.confirmed.includes(item.node_id)
					);
				}
				rerender();
				void saveState();
				if (record.stage !== "reask") {
					await maybeSpot(record);
					await maybeUpgrade(record);
					await maybeChaseGap(record);
				}
				if (record.stage === "reask") {
					const refill = flow.current.refills[flow.current.refillIdx];
					if (refill) {
						refill.reasked = true;
						refill.reaskedCorrect = record.verdict === "correct";
						flow.current.refillIdx += 1;
						if (flow.current.refillIdx < flow.current.refills.length) {
							setRefillText("");
							setRefillNote("");
							setScreen("refill");
							rerender();
							return;
						}
					}
					setScreen("summary");
					return;
				}
				next();
			}

			/** Read a report file chosen by the user, then look for its saved DAG. */
			async function loadReportFile(event) {
				const file = event.target?.files?.[0];
				event.target.value = "";
				if (!file) return;
				setError("");
				if (file.size > 4 * 1024 * 1024) {
					setError("报告文件超过 4MB；请先截取 1–3 段（摘要 / 核心论证 / 结论）。");
					return;
				}
				if (!/\.(md|markdown|txt|text|csv|json|html?)$/i.test(file.name)) {
					setError("目前只支持文本类报告文件（.md / .txt / .csv / .json / .html）；PDF 请先转成文字。");
					return;
				}
				setBusy(true);
				try {
					const text = await file.text();
					setReport(text);
					setReportFile(file.name);
					setDemo(false);
					setHandoff(null);
					setHandoffFile("");
					setSavedDag(null);
					setStateNote("");
					let reportId = "";
					try {
						reportId = await sha256Hex(text);
					} catch {
						reportId = "";
					}
					if (reportId) {
						const query = `?cwd=${encodeURIComponent(cwd || "")}&report_id=${reportId}`;
						try {
							const result = await api(`/dag/get${query}`);
							setSavedDag(result.dag);
							setStateNote(`已找到「${file.name}」的 DAG：${Object.keys(result.dag?.graph?.nodes || {}).length} 个节点；开始审计时直接复用。`);
						} catch {
							setStateNote("已读取报告文件；这份报告还没有保存的 DAG，开始审计时会建一次并保存。");
						}
					} else {
						setStateNote("已读取报告文件；浏览器不支持内容哈希，开始审计时会建 DAG。");
					}
				} catch (reason) {
					setError(String(reason.message || reason));
				} finally {
					setBusy(false);
				}
			}

			/** Load the newest /record handoff from the session workspace. */
			async function loadLatestHandoff() {
				setBusy(true);
				setError("");
				try {
					const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
					const result = await api(`/handoff/latest${query}`);
					const value = result.handoff;
					setHandoff(value);
					setHandoffFile(result.file || "");
					setReport(String(value.report_text || ""));
					setIndexText(JSON.stringify(value.retention_index || [], null, 2));
					setDemo(false);
					setConsent(false);
					setReportFile("");
					setSavedDag(null);
				} catch (reason) {
					setError(String(reason.message || reason));
				} finally {
					setBusy(false);
				}
			}

			/** Snapshot the current round for durable restore. */
			function auditSnapshot(extra = {}) {
				return {
					report,
					indexText,
					dial,
					demo,
					handoff,
					handoffFile,
					reportFile,
					savedDag,
					session: extra.session ?? session,
					current: extra.current ?? current,
					screen: extra.screen ?? screen,
					flow: { ...flow.current },
					...extra
				};
			}

			/** Save the DAG, queue and verdicts after a state change. */
			async function saveState(extra = {}) {
				const snapshot = auditSnapshot(extra);
				if (!snapshot.session || !snapshot.report) return;
				try {
					await api("/state/save", { cwd, state: snapshot });
				} catch {
					// persistence must never block the audit
				}
			}

			/** Restore the newest saved round from the workspace. */
			async function loadState(silent = false) {
				if (!silent) {
					setBusy(true);
					setError("");
				}
				try {
					const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
					const result = await api(`/state/latest${query}`);
					const value = result.state;
					if (!value?.session) throw new Error("状态里没有审计会话");
					setReport(String(value.report || ""));
					setIndexText(String(value.indexText || ""));
					setDial(Number(value.dial) || 3);
					setDemo(Boolean(value.demo));
					setHandoff(value.handoff || null);
					setHandoffFile(value.handoffFile || "");
					setReportFile(String(value.reportFile || ""));
					setSavedDag(value.savedDag || null);
					flow.current = {
						records: [],
						skipped: [],
						queue: [],
						asked: [],
						confirmed: [],
						chased: 0,
						upgraded: false,
						upgradedEntry: null,
						spotDone: false,
						refills: [],
						refillIdx: 0,
						...(value.flow || {})
					};
					setSession(value.session);
					setCurrent(value.current || null);
					setScreen(value.screen === "summary" ? "summary" : value.current ? "quiz" : "input");
					setStateNote(`已恢复 ${value.saved_at ? String(value.saved_at).slice(0, 19).replace("T", " ") : "上次"} 的审计`);
					setExported(null);
					setSavedPath("");
				} catch (reason) {
					if (!silent) setError(String(reason.message || reason));
				} finally {
					if (!silent) setBusy(false);
				}
			}

			/** Start one audit from the input form. */
			async function startAudit() {
				setError("");
				if (!consent) {
					setError("请先勾选：报告已脱敏，且本次结果只给自己看。");
					return;
				}
				if (!demo && report.trim().length < 80) {
					setError("报告片段少于 80 字。换一段有论点的（摘要、核心论证段或结论）。");
					return;
				}
				setBusy(true);
				try {
					flow.current = { records: [], skipped: [], queue: [], asked: [], confirmed: [], chased: 0, upgraded: false, upgradedEntry: null, spotDone: false, refills: [], refillIdx: 0 };
					const payload = {
						mode: demo ? "demo" : "ai",
						report_text: report,
						retention_index: parseIndex(indexText),
						handoff,
						dial
					};
					if (!demo && savedDag?.graph) {
						payload.graph = savedDag.graph;
						payload.risk_points = savedDag.risk_points || [];
					}
					const data = await api("/start", payload);
					setSession(data);
					setExported(null);
					setSavedPath("");
					if (!demo && data.graph) {
						try {
							const saved = await api("/dag/save", {
								cwd,
								report_text: report,
								report_file: reportFile,
								graph: data.graph,
								risk_points: data.risk_points || []
							});
							setSavedDag({ report_id: saved.report_id, graph: data.graph, risk_points: data.risk_points || [] });
						} catch {
							// DAG persistence must not block the audit
						}
					}
					enqueue(data.questions || []);
					setScreen("quiz");
					next();
					const first = data.questions?.[0];
					await saveState({
						session: data,
						screen: "quiz",
						current: first
							? { ...first, firstAnswer: "", followupUsed: false, stage: first.mode === "variant" ? "reask" : first.mode === "spot" ? "spot" : "first_pass" }
							: null
					});
				} catch (reason) {
					setError(String(reason.message || reason));
				} finally {
					setBusy(false);
				}
			}

			/** Submit the current answer (first answer or one follow-up). */
			async function submitAnswer() {
				if (!current || busy) return;
				if (!answer.trim() && !followupAnswer.trim()) {
					setError("写一句，或点“不会，先跳过”。空着不算作答。");
					return;
				}
				setError("");
				setBusy(true);
				try {
					if (current.followupUsed) {
						const combined = `${current.firstAnswer}\n\n追问回答：${followupAnswer.trim()}`;
						const result = await api("/judge", { question: current, answer: combined, dial, followup_used: true });
						await finalize({
							...current,
							answer: combined,
							verdict: result.judgment.verdict,
							judgment: result.judgment,
							timestamp: new Date().toISOString()
						});
						return;
					}
					const result = await api("/judge", { question: current, answer, dial, followup_used: false });
					const verdict = result.judgment.verdict;
					if (verdict === "partial" && current.followup) {
						setCurrent({ ...current, firstAnswer: answer, followupUsed: true });
						setAnswer("");
						setFollowupAnswer("");
						rerender();
						return;
					}
					await finalize({
						...current,
						answer,
						verdict,
						judgment: result.judgment,
						timestamp: new Date().toISOString()
					});
				} catch (reason) {
					setError(String(reason.message || reason));
				} finally {
					setBusy(false);
				}
			}

			/** Mark the current question skipped, without judging it wrong. */
			function skipQuestion() {
				if (!current || busy) return;
				const limit = budget?.skipLimit ?? 2;
				if (flow.current.skipped.length >= limit) {
					setError(`本轮最多跳过 ${limit} 题。这题可以先写一句，或直接答“不确定”。`);
					return;
				}
				flow.current.skipped.push({
					...current,
					timestamp: new Date().toISOString()
				});
				if (!flow.current.asked.includes(current.node_id)) flow.current.asked.push(current.node_id);
				setError("");
				void saveState();
				next();
			}

			/** Check the one-sentence refill and ask for a variant question. */
			async function submitRefill() {
				const refill = flow.current.refills[flow.current.refillIdx];
				if (!refill || busy) return;
				if (!refillText.trim()) {
					setRefillNote("先写一句自己的话；写不出也没关系，可以回读原文后再来。");
					return;
				}
				setBusy(true);
				setError("");
				try {
					const check = await api("/refill-check", { node_id: refill.node_id, quote: refill.quote, refill_text: refillText });
					refill.check = check.check;
					if (!check.check?.is_own_words || !check.check?.on_topic) {
						setRefillNote(check.check?.note || "这句还不太像自己的话，或还没指向这个概念。改一句再试，不算失败。");
						rerender();
						return;
					}
					refill.refillText = refillText;
					const result = await api("/variant", {
						graph: session.graph,
						target: { node_id: refill.node_id, entry_id: refill.entry_id, tier: "normal" },
						entry_id: refill.entry_id,
						component_id: refill.component_id,
						tier: "normal",
						dial,
						asked: flow.current.asked.map((id) => ({ node_id: id })),
						report_text: report,
						variant_of: refill.id,
						original_quote: refill.quote
					});
					const variant = result.questions?.[0];
					if (!variant) throw new Error("没有生成变式题");
					const variantCurrent = { ...variant, firstAnswer: "", followupUsed: false, stage: "reask" };
					setCurrent(variantCurrent);
					setAnswer("");
					setFollowupAnswer("");
					setPicked(variant.node_id);
					setRefillNote("");
					void saveState({ screen: "quiz", current: variantCurrent });
					setScreen("quiz");
					rerender();
				} catch (reason) {
					setError(String(reason.message || reason));
				} finally {
					setBusy(false);
				}
			}

			/** One payload for export and workspace save. */
			function auditPayload() {
				return {
					audit_id: session?.audit_id,
					handoff_id: session?.handoff_id ?? session?.audit_id,
					report_id: session?.report_id,
					recording: session?.recording,
					lineage: session?.lineage,
					graph: session?.graph,
					budget: session?.budget,
					dial,
					upgraded: flow.current.upgraded,
					confirmed: flow.current.confirmed,
					records: flow.current.records,
					skipped: flow.current.skipped,
					refills: flow.current.refills,
					report_span: session?.report_span || report.slice(0, 80),
					cwd
				};
			}

			/** Build the export payload and preview. */
			async function makeExport() {
				setBusy(true);
				setError("");
				try {
					const result = await api("/export", auditPayload());
					setExported(result);
				} catch (reason) {
					setError(String(reason.message || reason));
				} finally {
					setBusy(false);
				}
			}

			/** Persist the audit under <workspace>/audit/<id>.json. */
			async function saveToWorkspace() {
				setBusy(true);
				setError("");
				try {
					const result = await api("/save", auditPayload());
					setSavedPath(result.relative || result.path);
				} catch (reason) {
					setError(String(reason.message || reason));
				} finally {
					setBusy(false);
				}
			}

			/**
			 * Trigger a browser download.
			 * @param {string} name
			 * @param {string} text
			 * @param {string} type
			 */
			function download(name, text, type) {
				const blob = new Blob([text], { type });
				const url = URL.createObjectURL(blob);
				const anchor = document.createElement("a");
				anchor.href = url;
				anchor.download = name;
				document.body.appendChild(anchor);
				anchor.click();
				anchor.remove();
				setTimeout(() => URL.revokeObjectURL(url), 1000);
			}

			/**
			 * Node status for the gap map: last record wins; refill state fills gaps.
			 * @param {string} id
			 * @returns {string}
			 */
			function statusOf(id) {
				let symbol = "·";
				for (const record of flow.current.records) {
					if (record.node_id !== id) continue;
					symbol = record.verdict === "correct" ? "●" : record.verdict === "partial" || record.verdict === "wrong" || record.verdict === "unsure" ? "○" : symbol;
				}
				if (symbol === "○" && flow.current.upgradedEntry === id) symbol = "◐";
				if (symbol === "·") {
					for (const skip of flow.current.skipped) {
						if (skip.node_id === id) symbol = "⊘";
					}
				}
				for (const refill of flow.current.refills) {
					if (refill.node_id !== id) continue;
					if (refill.reaskedCorrect) symbol = "●";
					else if (refill.refillText) symbol = "◌";
				}
				return symbol;
			}

			const statuses = {};
			for (const id of Object.keys(session?.graph?.nodes || {})) statuses[id] = statusOf(id);
			const provenanceCounts = { user_source: 0, user_note: 0, ai_summary: 0, external: 0, unknown: 0 };
			for (const node of Object.values(session?.graph?.nodes || {})) {
				const key = ['user_source', 'user_note', 'ai_summary', 'external', 'unknown'].includes(node.provenance) ? node.provenance : 'unknown';
				provenanceCounts[key] += 1;
			}
			const recordingComplete = session?.recording?.complete !== false;
			const provenanceLine = `user_source ${provenanceCounts.user_source} · user_note ${provenanceCounts.user_note} · ai_summary ${provenanceCounts.ai_summary} · external ${provenanceCounts.external} · unknown ${provenanceCounts.unknown}`;
			const currentRefill = flow.current.refills[flow.current.refillIdx];

			const healthLine =
				health === null
					? "正在连接宿主…"
					: health.ok
						? `宿主已连接 · ${health.provider} / ${health.model}`
						: `宿主未连接：${health.error || "把右侧栏关掉再打开，或重启 dsh web"}`;

			const header = h(
				"div",
				{ className: "ua-head" },
				h("h2", { className: "ua-title" }, "理解审计"),
				h("span", { className: "ua-badge" }, `深度 ${dial} · ${demo ? "演示" : "AI"}`)
			);

			const notice = h(
				"div",
				null,
				h("p", { className: "ua-sub" }, "报告由 agent 写，你给要求/材料。这里只做一件事：从冻结的 handoff 里挑出最可能“看起来会、其实讲不出”的地方，出 3–5 道必须自己回答的反向题。"),
				h("div", { className: "ua-note" }, "不评分、不排名、不判断报告观点对错。来源谱系只用于分配题目，不展示给他人、不导出。结果只建议你本人查看。")
			);

			if (screen === "input") {
				return h(
					"div",
					{ className: "ua-root" },
					h("style", null, CSS),
					header,
					notice,
					h("div", { className: "ua-card" }, h("span", { className: "ua-muted" }, healthLine)),
					handoff
						? h(
								"div",
								{ className: handoff.recording?.complete ? "ua-ok" : "ua-err" },
								`handoff：${handoff.handoff_id || "?"} · 记录${handoff.recording?.complete ? "完整" : "不完整"} · lineage ${handoff.lineage?.length ?? 0} 段 · 来源指纹 ${handoff.knowledge_spans?.length ?? 0} 段${handoff.knowledge_spans_dropped ? `（省略 ${handoff.knowledge_spans_dropped}）` : ""} · 索引 ${handoff.retention_index?.length ?? 0} 条`
							)
						: null,
					reportFile ? h("div", { className: "ua-muted" }, `报告文件：${reportFile}${savedDag ? " · 已有持久化 DAG" : ""}`) : null,
					stateNote ? h("div", { className: "ua-ok" }, stateNote) : null,
					error ? h("div", { className: "ua-err" }, error) : null,
					h("label", { className: "ua-label" }, "报告片段（1–3 段：摘要 / 核心论证段 / 结论）"),
					h("textarea", {
						className: "ua-textarea",
						rows: 8,
						value: report,
						placeholder: "粘贴已脱敏的报告片段，建议 80–2000 字（150 字以上更好）。不要贴整篇。",
						onChange: (event) => { setReport(event.target.value); setSavedDag(null); }
					}),
					h(
						"div",
						{ className: "ua-row", style: { marginTop: 6 } },
						h("input", { type: "file", ref: fileRef, style: { display: "none" }, accept: ".md,.markdown,.txt,.text,.csv,.json,.html", onChange: loadReportFile }),
						h("button", { className: "ua-btn", type: "button", disabled: busy, onClick: () => fileRef.current?.click() }, "选择报告文件"),
						h("button", { className: "ua-btn", type: "button", onClick: () => { setReport(DEMO_REPORT); setIndexText(DEMO_INDEX); setDemo(true); setDial(3); setError(""); setHandoff(null); setHandoffFile(""); setReportFile(""); setSavedDag(null); setStateNote(""); } }, "载入示例"),
						h("button", { className: "ua-btn", type: "button", disabled: busy, onClick: loadLatestHandoff }, "载入最近 handoff"),
						h("button", { className: "ua-btn", type: "button", disabled: busy, onClick: () => loadState(false) }, "恢复上次审计"),
						h("button", { className: "ua-btn ghost", type: "button", onClick: () => { setReport(""); setIndexText(""); setDemo(false); setError(""); setHandoff(null); setHandoffFile(""); setReportFile(""); setSavedDag(null); setStateNote(""); } }, "清空"),
						h("span", { className: "ua-muted" }, `${report.trim().length} 字`)
					),
					editedReport
						? h(
								"div",
								{ className: "ua-warn" },
								"报告已修改：原引用位置失效，本轮记录标为不完整。小改动（如删姓名）会按来源指纹重算；整篇换成另一份报告则按未知处理。改过的文本就是你实际要审的文本。"
							)
						: null,
					h("label", { className: "ua-label" }, "留存索引（只传索引，不传摘要全文；可留空）"),
					h("textarea", {
						className: "ua-textarea",
						rows: 4,
						value: indexText,
						placeholder: 'JSON 数组，或每行：概念 | human/ai | can_explain/heard_only/no_memory/no_record | note_id | 来源',
						onChange: (event) => setIndexText(event.target.value)
					}),
					h(
						"label",
						{ className: "ua-label" },
						`深度 ${dial} · ${3 + Math.floor((dial - 1) / 2)} 题 · 抽查 ${Math.round(dial * 10)}% · ${dial >= 4 ? "判得严" : dial >= 3 ? "标准" : "宽松"}`
					),
					h("input", {
						type: "range",
						min: 1,
						max: 5,
						step: 1,
						value: dial,
						style: { width: "100%" },
						onChange: (event) => setDial(Number(event.target.value))
					}),
					h(
						"div",
						{ className: "ua-row", style: { justifyContent: "space-between" } },
						h("span", { className: "ua-muted" }, "快 / 浅"),
						h("span", { className: "ua-muted" }, "慢 / 深")
					),
					h(
						"label",
						{ className: "ua-row", style: { marginTop: 8, alignItems: "flex-start" } },
						h("input", { type: "checkbox", checked: demo, onChange: (event) => setDemo(event.target.checked) }),
						h("span", { className: "ua-muted" }, "演示模式：用内置样例，不调用模型（适合课堂演示 / 网络不稳）")
					),
					h(
						"label",
						{ className: "ua-row", style: { marginTop: 6, alignItems: "flex-start" } },
						h("input", { type: "checkbox", checked: consent, onChange: (event) => setConsent(event.target.checked) }),
						h("span", { className: "ua-muted" }, "我已删除姓名 / 学号 / 导师 / 未公开项目名；结果只给自己看。")
					),
					h(
						"div",
						{ className: "ua-row", style: { marginTop: 12 } },
						h(
							"button",
							{ className: "ua-btn primary", type: "button", disabled: busy, onClick: startAudit },
							busy ? h("span", { className: "ua-spin" }) : null,
							busy ? "正在建图与出题…" : "开始审计"
						),
						h("span", { className: "ua-muted" }, "AI 模式会跑 P1 风险扫描 + P2 出题，通常 20–60 秒")
					)
				);
			}

			if (screen === "quiz" && current) {
				const answered = flow.current.records.filter((r) => r.stage !== "reask").length;
				const percent = progressTotal ? Math.min(100, Math.round((answered / progressTotal) * 100)) : 0;
				return h(
					"div",
					{ className: "ua-root" },
					h("style", null, CSS),
					header,
					error ? h("div", { className: "ua-err" }, error) : null,
					h(
						"div",
						{ className: "ua-row", style: { justifyContent: "space-between" } },
						h("span", { className: "ua-muted" }, `第 ${answered + 1} 题 · 计划 ${progressTotal || "?"} 题 · ${current.stage === "spot" ? "抽查" : current.stage === "reask" ? "补全回访" : current.tier === "simple" ? "简单档" : "正常档"}`),
						h("span", { className: "ua-badge" }, current.type)
					),
					h("div", { className: "ua-progress" }, h("div", { style: { width: `${percent}%` } })),
					h(
						"div",
						{ className: "ua-card" },
						h("div", { className: "ua-quote" }, `来源原文：“${current.quote}”`),
						h("div", { className: "ua-q" }, current.question),
						current.followupUsed
							? h(
									"div",
									null,
									h("div", { className: "ua-ok" }, "先按你的第一句判了“部分对”。追问一次，再判一次；追问后仍缺关键要点就记缺口，不再纠缠。"),
									h("div", { className: "ua-quote" }, `追问：${current.followup}`),
									h("textarea", {
										className: "ua-textarea",
										rows: 3,
										value: followupAnswer,
										placeholder: "回答追问；可以直接说“不确定”。",
										onChange: (event) => setFollowupAnswer(event.target.value)
									})
								)
							: h("textarea", {
									className: "ua-textarea",
									rows: 5,
									value: answer,
									placeholder: "用自己的话回答。可以答“不确定”，这不会被当成错误。",
									onChange: (event) => setAnswer(event.target.value)
								}),
						h(
							"div",
							{ className: "ua-row", style: { marginTop: 8 } },
							h(
								"button",
								{ className: "ua-btn primary", type: "button", disabled: busy, onClick: submitAnswer },
								busy ? h("span", { className: "ua-spin" }) : null,
								busy ? "判定中…" : current.followupUsed ? "提交追问" : "提交判定"
							),
							h("button", { className: "ua-btn", type: "button", disabled: busy, onClick: () => setAnswer("不确定") }, "不确定"),
							h("button", { className: "ua-btn danger", type: "button", disabled: busy, onClick: skipQuestion }, "不会，先跳过"),
							h("span", { className: "ua-muted" }, `本轮最多跳过 ${budget?.skipLimit ?? 2} 题；跳过不算错`)
						)
					),
					h(
						"div",
						{ className: "ua-card" },
						h("div", { className: "ua-row", style: { justifyContent: "space-between" } }, h("b", null, "知识 DAG"), h("span", { className: "ua-muted" }, "点节点看详情")),
						h(GraphView, { graph: session.graph, statuses, active: current.node_id, picked, onPick: setPicked })
					),
					h(
						"div",
						{ className: "ua-card" },
						h("div", { className: "ua-row", style: { justifyContent: "space-between" } }, h("b", null, "来源谱系"), h("span", { className: "ua-muted" }, recordingComplete ? "记录完整" : "记录不完整")),
						h("div", { className: "ua-muted" }, provenanceLine),
						!recordingComplete ? h("div", { className: "ua-note" }, `缺口：${(session.recording?.gaps || []).join("；") || "未执行 /record end"}；未覆盖节点按 unknown 处理。`) : null
					),
					h(
						"div",
						{ className: "ua-row", style: { justifyContent: "space-between" } },
						h("span", { className: "ua-muted" }, `${budget?.total ?? "?"} 题 · 跳过 ${flow.current.skipped.length}/${budget?.skipLimit ?? 2} · 升级 ${flow.current.upgraded ? "1" : "0"} · 抽查 ${flow.current.spotDone ? "已抽" : "未抽"}`),
						h("span", { className: "ua-muted" }, "判定只针对这道题，不汇总报告分")
					)
				);
			}

			if (screen === "refill" && currentRefill) {
				return h(
					"div",
					{ className: "ua-root" },
					h("style", null, CSS),
					header,
					error ? h("div", { className: "ua-err" }, error) : null,
					h("div", { className: "ua-note" }, "第一轮结束了。你主动跳过了题，这里只做补全：先回读原文，再用自己的话补一句。补全不判对错。"),
					h(
						"div",
						{ className: "ua-card" },
						h("div", { className: "ua-row", style: { justifyContent: "space-between" } }, h("b", null, `补全 · ${currentRefill.node_id}`), h("span", { className: "ua-badge" }, `第 ${flow.current.refillIdx + 1} / ${flow.current.refills.length} 张`)),
						h("div", { className: "ua-quote" }, `报告原文：“${currentRefill.quote}”`),
						h("div", { className: "ua-kv" }, h("div", null, "补全卡"), h("div", null, currentRefill.micro)),
						h("div", { className: "ua-muted" }, currentRefill.grounded ? "补全卡只重组报告原文，没有引入报告外内容。" : "报告没有展开这一点，补全卡只给回读位置。"),
						h("label", { className: "ua-label" }, "轮到你：用你自己的话补一句"),
						h("textarea", {
							className: "ua-textarea",
							rows: 3,
							value: refillText,
							placeholder: "一句就够，不用写成段落。",
							onChange: (event) => setRefillText(event.target.value)
						}),
						refillNote ? h("div", { className: "ua-note" }, refillNote) : null,
						h(
							"div",
							{ className: "ua-row", style: { marginTop: 8 } },
							h(
								"button",
								{ className: "ua-btn primary", type: "button", disabled: busy, onClick: submitRefill },
								busy ? h("span", { className: "ua-spin" }) : null,
								busy ? "检查中…" : "补完了，再问我一次"
							),
							h("button", { className: "ua-btn ghost", type: "button", disabled: busy, onClick: () => setScreen("summary") }, "先不补，直接看复盘")
						)
					),
					h(
						"div",
						{ className: "ua-card" },
						h("b", null, "知识 DAG"),
						h(GraphView, { graph: session.graph, statuses, active: currentRefill.node_id, picked, onPick: setPicked })
					)
				);
			}

			if (screen === "summary" && session) {
				const rows = Object.keys(session.graph.nodes).map((id) => ({
					id,
					symbol: statuses[id],
					text: session.graph.nodes[id].text,
					note:
						statuses[id] === "●"
							? "已通过"
							: statuses[id] === "◐"
								? "简单档未过关，升级后仍有缺口"
								: statuses[id] === "○"
									? "有缺口"
									: statuses[id] === "⊘"
										? "主动跳过，未补全"
										: statuses[id] === "◌"
											? "已补全，待回访"
											: "本轮未考察"
				}));
				const count = (verdict) => flow.current.records.filter((r) => r.verdict === verdict).length;
				return h(
					"div",
					{ className: "ua-root" },
					h("style", null, CSS),
					header,
					error ? h("div", { className: "ua-err" }, error) : null,
					h("div", { className: "ua-ok" }, "本轮结束。下面是抽样结果，不是评分；未考察不代表没问题。"),
					h(
						"div",
						{ className: "ua-card" },
						h("div", { className: "ua-kv" },
							h("div", null, "本轮"),
							h("div", null, `${flow.current.records.length} 题（正常 ${flow.current.records.filter((r) => r.tier === "normal" && r.stage !== "reask").length} · 简单 ${flow.current.records.filter((r) => r.tier === "simple").length} · 抽查 ${flow.current.records.filter((r) => r.stage === "spot").length}）`),
							h("div", null, "判定"),
							h("div", null, `对 ${count("correct")} · 部分对 ${count("partial")} · 错 ${count("wrong")} · 不确定 ${count("unsure")} · 跳过 ${flow.current.skipped.length}`),
							h("div", null, "升级 / 回访"),
							h("div", null, `${flow.current.upgraded ? "1 处" : "0 处"} / ${flow.current.refills.length} 题`),
							h("div", null, "深度"),
							h("div", null, `${dial}（${budget?.total ?? "?"} 题 · 抽查 ${Math.round((budget?.spotRate ?? 0) * 100)}%）`)
						)
					),
					h(
						"div",
						{ className: "ua-card" },
						h("div", { className: "ua-row", style: { justifyContent: "space-between" } }, h("b", null, "知识 DAG"), h("span", { className: "ua-muted" }, "● 通过 · ○ 缺口 · ⊘ 跳过 · ◌ 待回访 · · 未考察")),
						h(GraphView, { graph: session.graph, statuses, active: picked, picked, onPick: setPicked })
					),
					h(
						"div",
						{ className: "ua-card" },
						h("div", { className: "ua-row", style: { justifyContent: "space-between" } }, h("b", null, "来源谱系"), h("span", { className: "ua-muted" }, recordingComplete ? "记录完整" : "记录不完整")),
						h("div", { className: "ua-muted" }, provenanceLine),
						!recordingComplete ? h("div", { className: "ua-note" }, `缺口：${(session.recording?.gaps || []).join("；") || "未执行 /record end"}。审计只覆盖已记录的片段。`) : null
					),
					h(
						"div",
						{ className: "ua-card" },
						h("b", null, "缺口地图"),
						h(
							"table",
							{ className: "ua-table" },
							h("thead", null, h("tr", null, h("th", null, "状态"), h("th", null, "节点"), h("th", null, "知识点"), h("th", null, "说明"))),
							h("tbody", null, rows.map((row) => h("tr", { key: row.id }, h("td", { className: "ua-symbol" }, row.symbol), h("td", null, row.id), h("td", null, row.text), h("td", null, row.note))))
						)
					),
					h(
						"div",
						{ className: "ua-card" },
						h("b", null, "逐题判定"),
						flow.current.records.length
							? h(
									"ol",
									{ className: "ua-list" },
									flow.current.records.map((record, index) =>
										h(
											"li",
											{ key: `${record.id}-${index}` },
											h("b", null, `${record.id} · ${record.type}`),
											`：${record.verdict === "correct" ? "对" : record.verdict === "partial" ? "部分对" : record.verdict === "wrong" ? "错" : "不确定"}`,
											record.judgment?.miss_points?.length ? h("div", { className: "ua-muted" }, `缺：${record.judgment.miss_points.join("；")}`) : null,
											record.judgment?.reread?.length ? h("div", { className: "ua-muted" }, `回读：${record.judgment.reread.join("；")}`) : null
										)
									)
								)
							: h("div", { className: "ua-muted" }, "本轮没有已判定的题。")
					),
					h(
						"div",
						{ className: "ua-card" },
						h("b", null, "导出"),
						h("p", { className: "ua-muted", style: { margin: "4px 0 8px" } }, "默认脱敏、隐藏来源标签；导出只包含本轮题目与判定，不含对话原文。"),
						h(
							"div",
							{ className: "ua-row" },
							h("button", { className: "ua-btn primary", type: "button", disabled: busy, onClick: makeExport }, busy ? "整理中…" : "生成导出预览"),
							exported
								? h("button", { className: "ua-btn", type: "button", onClick: () => download(`理解审计-${session.audit_id}.json`, JSON.stringify(exported.quiz, null, 2), "application/json") }, "下载 JSON")
								: null,
							exported
								? h("button", { className: "ua-btn", type: "button", onClick: () => download(`理解审计-${session.audit_id}.md`, exported.markdown, "text/markdown") }, "下载 Markdown")
								: null,
							h("button", { className: "ua-btn", type: "button", disabled: busy, onClick: saveToWorkspace }, "保存到工作区 audit/")
						),
						savedPath ? h("div", { className: "ua-ok" }, `已保存：${savedPath}（只写这一份审计记录，不改留存库）`) : null,
						exported ? h("pre", { className: "ua-code", style: { maxHeight: 220, overflow: "auto", marginTop: 8 } }, exported.markdown.slice(0, 1600)) : null
					),
					h(
						"div",
						{ className: "ua-note" },
						h("b", null, "声明："),
						DISCLAIMER
					),
					h(
						"div",
						{ className: "ua-row", style: { marginTop: 10 } },
						h("button", { className: "ua-btn", type: "button", onClick: () => { setScreen("input"); setSession(null); setExported(null); setSavedPath(""); setError(""); flow.current = { records: [], skipped: [], queue: [], asked: [], confirmed: [], chased: 0, upgraded: false, upgradedEntry: null, spotDone: false, refills: [], refillIdx: 0 }; } }, "再审计一段"),
						h("button", { className: "ua-btn ghost", type: "button", onClick: makeExport }, "刷新导出")
					)
				);
			}

			return h("div", { className: "ua-root" }, h("style", null, CSS), header, h("div", { className: "ua-card" }, healthLine));
		}

		function HeaderButton(props) {
			return h(
				"button",
				{
					type: "button",
					title: "理解审计：报告写完后，检查哪里讲不清",
					onClick: props.open,
					style: {
						display: "inline-flex",
						alignItems: "center",
						gap: 4,
						height: 28,
						padding: "0 9px",
						borderRadius: 8,
						border: "1px solid var(--dsh-border, rgba(127,127,127,.28))",
						background: "transparent",
						color: "inherit",
						fontSize: 12,
						cursor: "pointer",
						whiteSpace: "nowrap"
					}
				},
				h("span", { "aria-hidden": "true", style: { fontSize: 13 } }, "◍"),
				"审计"
			);
		}

		const inject = ["slots", "sidebarRightTabs", "sidebarRight"];

		function apply(ctx) {
			ctx.effect(
				() =>
					ctx.sidebarRightTabs.register({
						id: ID,
						kind: KIND,
						title: () => "理解审计",
						guide: [
							{
								id: "understanding-audit",
								order: 20,
								title: () => "理解审计",
								description: () => "把报告变成 3–5 道必须自己回答的反向题"
							}
						]
					}),
				"understanding-auditor: tab type"
			);
			ctx.effect(
				() =>
					ctx.slots.inject("sidebar.right.pane.tab", () =>
						ctx.slots.register({ name: "sidebar.right.pane.tab", key: ID }, AuditTab)
					),
				"understanding-auditor: tab body"
			);
			ctx.effect(
				() =>
					ctx.slots.inject("conversation.session.header.utilities", () =>
						ctx.slots.register(
							{
								name: "conversation.session.header.utilities",
								id: "understanding-auditor",
								order: 15,
								inject: () => ({ open: () => ctx.sidebarRight.openTab(KIND) })
							},
							HeaderButton
						)
					),
				"understanding-auditor: header button"
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
