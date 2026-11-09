/**
 * 理解审计员 v1.9 —— Host 半：/record 记录器 + /audit 审计。
 *
 * 只做五件事：
 *  1. 在 /dsh-understanding-auditor 下提供本地 HTTP 路由（同源，供右侧栏页面调用）；
 *  2. 把 P1–P4 提示词与输入拼成模型请求，走 ctx.llm（温度 0）；
 *  3. 解析/校验模型返回的 JSON，对缺字段、错引文做兜底与丢弃；
 *  4. 预算、升级、抽查、跳过、回访的规则计算；
 *  5. P4 导出（JSON + Markdown），默认脱敏、隐藏来源标签。
 *
 * 边界：不联网、不写报告、不读留存摘要全文、不汇总报告总分。
 */
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { isAbsolute, join } from 'node:path'
import { extractAttachmentText } from './attachment-text.js'

const ROUTE_PREFIX = '/dsh-understanding-auditor'
const MAX_BODY = 4 * 1024 * 1024
const PROMPT_URL = new URL('../prompts/', import.meta.url)
const PROMPT_DIR = fileURLToPath(PROMPT_URL)
const DISCLAIMER =
  '本结果是对你理解状态的一次抽样提示，不是评分，也不代表报告内容正确或错误。题目只覆盖了本轮抽到的知识点，未覆盖的部分不代表没有问题。请把它当作回读的线索，而不是结论。'

/** @type {string[]} */
export const inject = ['webServer', 'llm', 'commands', 'sessions']

const PROMPTS = {
  p0: 'P0-系统提示词.md',
  p1: 'P1-风险扫描.md',
  p2: 'P2-出题.md',
  p3: 'P3-判定.md',
  p4: 'P4-导出.md',
}

/**
 * Read a prompt file. No cache: editing prompts must take effect on the next
 * call, without restarting the Host.
 * @param {string} name file name under prompts/
 * @returns {Promise<string>}
 */
async function prompt(name) {
  return readFile(new URL(name, PROMPT_URL), 'utf8')
}

/**
 * Compose the system message shared by P1–P4.
 * @param {'p1'|'p2'|'p3'|'p4'} stage
 * @returns {Promise<string>}
 */
async function systemFor(stage) {
  const p0 = await prompt(PROMPTS.p0)
  const body = await prompt(PROMPTS[stage])
  return p0.replace('{{P段正文}}', () => body)
}

/**
 * Collect a bounded JSON request body.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<any>}
 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体超过 4MB'), { statusCode: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (size === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { statusCode: 400 }))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} value
 */
function sendJson(res, status, value) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

/**
 * Strip Markdown fences and isolate the outermost JSON object.
 * @param {string} text
 * @returns {any}
 */
function parseLooseJson(text) {
  let s = String(text ?? '').trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  return JSON.parse(s)
}

/**
 * Resolve the provider/model for one auxiliary call: first registered provider
 * with an advertised model, so the plugin follows the profile's configured route.
 * @param {any} ctx
 * @returns {Promise<{provider: string, model: string}>}
 */
async function route(ctx) {
  const providers = ctx.llm.listProviders()
  if (!providers.length) throw Object.assign(new Error('没有可用的模型 provider'), { statusCode: 503 })
  for (const provider of providers) {
    const models = await ctx.llm.listModels(provider.id)
    if (!models.length) continue
    const model = models[0].id
    let effort
    let info
    try {
      info = await ctx.llm.resolveModelInfo(provider.id, model)
      effort = info?.reasoning?.efforts?.[0]?.id
    } catch {
      // 元数据不可用时不传 reasoningEffort，交给适配器默认
    }
    return { provider: provider.id, model, reasoningEffort: effort, info }
  }
  throw Object.assign(new Error('provider 没有可用模型，请先在设置里选择模型'), { statusCode: 503 })
}

/**
 * Run one model call at temperature 0 and return joined text.
 * @param {any} ctx
 * @param {string} system
 * @param {unknown} payload
 * @returns {Promise<string>}
 */
async function complete(ctx, system, payload) {
  const { provider, model, reasoningEffort } = await route(ctx)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 180_000)
  let text = ''
  let blockText = ''
  try {
    for await (const chunk of ctx.llm.stream({
      provider,
      model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(payload) }] }],
      temperature: 0,
      maxTokens: 8192,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      signal: controller.signal,
    })) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'block-end' && chunk.block?.type === 'text') blockText += chunk.block.text
      else if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
        throw Object.assign(new Error(`模型调用失败：${chunk.reason.failure?.message ?? 'unknown'}`), { statusCode: 502 })
      } else if (chunk.type === 'finish' && chunk.reason?.kind === 'aborted') {
        throw Object.assign(new Error('模型调用超时或被取消'), { statusCode: 504 })
      }
    }
  } finally {
    clearTimeout(timer)
  }
  return text || blockText
}

/**
 * Run one prompt stage and parse its JSON reply.
 * @param {any} ctx
 * @param {'p1'|'p2'|'p3'|'p4'} stageName
 * @param {unknown} payload
 * @returns {Promise<any>}
 */
async function stage(ctx, stageName, payload) {
  const text = await complete(ctx, await systemFor(stageName), payload)
  let parsed
  try {
    parsed = parseLooseJson(text)
  } catch {
    throw Object.assign(new Error(`模型没有返回可解析的 JSON（${stageName.toUpperCase()}）`), {
      statusCode: 502,
      raw: text.slice(0, 500),
    })
  }
  if (parsed?.error) {
    throw Object.assign(new Error(parsed.error.message ?? '模型返回错误'), {
      statusCode: 422,
      code: parsed.error.code,
    })
  }
  return parsed
}

const RISK_ORDER = { high: 3, mid: 2, low: 1 }
const PROVENANCE = new Set(['user_source', 'user_note', 'ai_summary', 'external', 'unknown'])

// ---------------------------------------------------------------------------
// Concept provenance (v1.9.1)
//
// v1.9.0 matched a node's text against the *report* and asked which lineage
// range covered that character position. Since the report is written by the
// agent, a user's pasted material is paraphrased and never appears verbatim,
// so almost every node fell back to `ai`. v1.9.1 records an unreadable
// n-gram fingerprint of every knowledge span at freeze time and matches the
// node's concept against *those spans* instead. Nothing but hashes leaves the
// writing session: no user sentence, no question, no conversation text.
// ---------------------------------------------------------------------------

const GRAM_HASH_LENGTH = 12
const MAX_GRAMS_PER_SPAN = 4000
const MAX_KNOWLEDGE_SPANS = 60
const MAX_GRAM_BUDGET = 80000

/** Lowercase and strip whitespace/punctuation so matching ignores formatting. */
function normalizeForMatch(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
}

/** Hash every n-gram of `text` (truncated SHA-256, fixed order). */
function gramHashes(text, size) {
  const value = normalizeForMatch(text)
  const out = []
  for (let index = 0; index + size <= value.length && out.length < MAX_GRAMS_PER_SPAN; index += 1) {
    out.push(createHash('sha256').update(value.slice(index, index + size)).digest('hex').slice(0, GRAM_HASH_LENGTH))
  }
  return out
}

/**
 * Build the stored fingerprint of one span: length plus 2-gram and 3-gram
 * hashes. Hashes only; the original text is not kept.
 * @param {string} text
 * @returns {{length: number, bi: string[], tri: string[]}}
 */
function fingerprint(text) {
  const length = normalizeForMatch(text).length
  if (!length) return { length: 0, bi: [], tri: [] }
  return { length, bi: gramHashes(text, 2), tri: gramHashes(text, 3) }
}

/** All 2-grams of a text, uncapped (similarity must see the whole report). */
function bigramSet(text) {
  const value = normalizeForMatch(text)
  const out = new Set()
  for (let index = 0; index + 2 <= value.length; index += 1) out.add(value.slice(index, index + 2))
  return out
}

/** Jaccard similarity of two texts' 2-gram sets. Used only to tell an edit
 * (delete a name) from a different report pasted over the handoff. */
function textSimilarity(left, right) {
  const a = bigramSet(left)
  const b = bigramSet(right)
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const gram of a) if (b.has(gram)) shared += 1
  return shared / (a.size + b.size - shared)
}

/** Fraction of `grams` present in `set`. */
function ratio(grams, set) {
  if (!grams.length || !set) return 0
  let hit = 0
  for (const gram of grams) if (set.has(gram)) hit += 1
  return hit / grams.length
}

/**
 * Coverage test for one node: a short term needs almost every gram, a claim
 * needs about half of its trigrams. Deliberately conservative — a miss keeps
 * the node `ai` (safe), a false hit would claim knowledge the user never
 * supplied (unsafe).
 * @param {string} text
 * @returns {(span: {biSet: Set<string>, triSet: Set<string>}) => boolean}
 */
function makeSpanMatcher(text) {
  const value = normalizeForMatch(text)
  const bi = gramHashes(value, 2)
  const tri = gramHashes(value, 3)
  return (span) => {
    if (!value || !span) return false
    if (value.length <= 3) return ratio(bi, span.biSet) >= 1
    const triHit = ratio(tri, span.triSet)
    if (value.length <= 8) return Math.min(triHit, ratio(bi, span.biSet)) >= 0.85
    return triHit >= 0.45
  }
}

/**
 * v1.9.0 fallback: only used for handoffs frozen before `knowledge_spans`
 * existed. Conservative on purpose — a user span may keep `human`, an AI span
 * may only claim `ai_summary`, never `human`.
 * @param {any} graph
 * @param {string} report
 * @param {any[]} lineage
 */
function applyRangeProvenance(graph, report, lineage) {
  const spans = Array.isArray(lineage) ? lineage.filter((span) => Array.isArray(span?.range) && span.range.length === 2) : []
  const covering = (position) =>
    spans.filter((span) => Number(span.range[0]) <= position && position < Number(span.range[1]))
  for (const node of Object.values(graph.nodes)) {
    const text = String(node.text ?? '')
    let position = text ? report.indexOf(text) : -1
    if (position < 0 && text.length >= 6) position = report.indexOf(text.slice(0, 6))
    const hits = position >= 0 ? covering(position) : []
    const user = hits.find((span) => span.author === 'user')
    const ai = hits.find((span) => span.author === 'ai')
    const external = hits.find((span) => span.author === 'external')
    if (user) {
      node.origin = 'human'
      node.provenance = user.event === 'rewrite' ? 'user_note' : 'user_source'
      node.origin_basis = `报告原句落在用户段落 ${user.span_id ?? ''} 内`
      if (ai) node.ai_variant = true
    } else if (ai) {
      node.origin = 'ai'
      node.provenance = 'ai_summary'
      node.origin_basis = `报告原句落在 AI 段落 ${ai.span_id ?? ''} 内`
    } else if (external) {
      node.origin = 'ai'
      node.provenance = 'external'
      node.origin_basis = `报告原句落在工具/检索段落 ${external.span_id ?? ''} 内`
    } else {
      node.origin = 'ai'
      node.provenance = 'unknown'
      node.origin_basis = '没有可对应的来源段落，默认未知'
    }
  }
  return graph
}

/**
 * Judge each node's concept against the recorded knowledge spans (not the
 * report). A concept that appears in a user span (paste / attachment / own
 * words) is `human`, even if the report paraphrases it; a question or a
 * writing instruction never counts; an AI-only concept stays `ai`.
 * @param {any} graph
 * @param {string} report
 * @param {any[]} lineage
 * @param {any[]} [knowledgeSpans] fingerprints from the handoff
 * @returns {any}
 */
function applyLineageProvenance(graph, report, lineage, knowledgeSpans) {
  const recorded = Array.isArray(knowledgeSpans)
    ? knowledgeSpans.filter(
        (span) => span && Array.isArray(span.bi) && Array.isArray(span.tri) && span.length && span.event !== 'inquiry'
      )
    : []
  if (!recorded.length) return applyRangeProvenance(graph, report, lineage)
  const spans = recorded.map((span) => ({
    ...span,
    biSet: new Set(span.bi),
    triSet: new Set(span.tri),
  }))
  for (const node of Object.values(graph.nodes)) {
    const covers = makeSpanMatcher(node.text)
    const hits = spans.filter((span) => covers(span))
    const user = hits.find((span) => span.author === 'user')
    const ai = hits.find((span) => span.author === 'ai')
    const external = hits.find((span) => span.author === 'external')
    if (user) {
      node.origin = 'human'
      node.provenance = user.event === 'rewrite' ? 'user_note' : 'user_source'
      node.origin_basis = `来源指纹命中用户材料 ${user.span_id ?? ''}（${user.event ?? 'typed'}）`
      if (ai) node.ai_variant = true
    } else if (ai) {
      node.origin = 'ai'
      node.provenance = 'ai_summary'
      node.origin_basis = `来源指纹只命中 AI 段落 ${ai.span_id ?? ''}`
    } else if (external) {
      node.origin = 'ai'
      node.provenance = 'external'
      node.origin_basis = `来源指纹只命中工具/检索段落 ${external.span_id ?? ''}`
    } else {
      node.origin = 'ai'
      node.provenance = 'unknown'
      node.origin_basis = '没有用户材料覆盖这个概念，默认未知'
    }
  }
  return graph
}
const KINDS = new Set(['claim', 'term', 'reason', 'evidence', 'conclusion'])
const TYPES = new Set(['复述解释题', '前提变换题', '术语定义题'])

/**
 * Human ancestors are assumed known by design: if a human-supplied node has
 * children, it is a prerequisite the user brought in, not a question target.
 * @param {any} graph
 */
function markAssumedKnown(graph) {
  for (const node of Object.values(graph?.nodes ?? {})) {
    if (node.origin === 'human' && Array.isArray(node.children) && node.children.length > 0) node.assumed_known = true
  }
  return graph
}

/**
 * Normalize P1 output: fill parents/children from edges, drop dangling edges,
 * ensure one component covers every node, and recompute levels.
 * @param {any} raw
 * @param {string} report
 * @param {number} dial
 * @returns {{graph: any, risk_points: any[]}}
 */
function normalizeGraph(raw, report, dial, lineage, knowledgeSpans) {
  const source = raw?.graph ?? raw
  const nodes = source?.nodes
  if (!nodes || typeof nodes !== 'object' || !Object.keys(nodes).length) {
    throw Object.assign(new Error('P1 没有返回 nodes'), { statusCode: 502 })
  }
  const out = {}
  for (const [id, node] of Object.entries(nodes)) {
    if (!node || typeof node !== 'object') continue
    out[id] = {
      text: String(node.text ?? '').trim(),
      kind: KINDS.has(node.kind) ? node.kind : 'claim',
      origin: node.origin === 'human' ? 'human' : 'ai',
      origin_basis: node.origin_basis ? String(node.origin_basis) : undefined,
      parents: Array.isArray(node.parents) ? node.parents.filter((p) => typeof p === 'string' && p in nodes) : [],
      children: [],
      level: Number.isFinite(node.level) ? node.level : 1,
      risk: RISK_ORDER[node.risk] ? node.risk : 'mid',
      provenance: ['user_source', 'user_note', 'ai_summary', 'external', 'unknown'].includes(node.provenance)
        ? node.provenance
        : node.origin === 'human'
          ? 'user_source'
          : 'unknown',
      ...(node.ai_variant ? { ai_variant: true } : {}),
      ...(node.evidence ? { evidence: node.evidence } : {}),
      ...(node.cluster_id ? { cluster_id: String(node.cluster_id) } : {}),
      ...(node.assumed_known ? { assumed_known: true } : {}),
    }
  }
  for (const node of Object.values(out)) {
    if (!node.text) node.text = '（未命名节点）'
  }
  for (const [id, node] of Object.entries(out)) {
    for (const parent of node.parents) {
      if (!out[parent].children.includes(id)) out[parent].children.push(id)
    }
  }
  const edges = []
  for (const [id, node] of Object.entries(out)) {
    for (const parent of node.parents) {
      if (out[parent].parents.includes(id)) {
        // 环：保留节点，去掉形成环的那条边，避免遍历死循环
        node.parents = node.parents.filter((p) => p !== parent)
        continue
      }
      edges.push({ from: parent, to: id, type: 'prereq' })
    }
  }
  // 重算 level：无前置为 1
  const byId = out
  const level = (id, seen = new Set()) => {
    if (seen.has(id)) return 1
    seen.add(id)
    const node = byId[id]
    if (!node || !node.parents.length) return 1
    return 1 + Math.max(...node.parents.map((p) => level(p, seen)))
  }
  for (const id of Object.keys(out)) out[id].level = level(id, new Set())

  // 入口：children 为空
  const entries = Object.keys(out).filter((id) => out[id].children.length === 0)
  // 若 P1 给了 components，尽量沿用；否则按弱连通分量分组
  const components = []
  if (Array.isArray(source?.components) && source.components.length) {
    for (const component of source.components) {
      const ids = (component.node_ids ?? []).filter((id) => id in out)
      if (!ids.length) continue
      const cid = String(component.component_id ?? `G-${String(components.length + 1).padStart(2, '0')}`)
      components.push({
        component_id: cid,
        entry_ids: (component.entry_ids ?? []).filter((id) => ids.includes(id) && entries.includes(id)),
        node_ids: ids,
        status: { state: 'unchecked', asked: 0, skipped: [], refilled: [], reasked: [], spot_checks: [] },
      })
    }
  }
  const covered = new Set(components.flatMap((c) => c.node_ids))
  const missing = Object.keys(out).filter((id) => !covered.has(id))
  if (missing.length) {
    components.push({
      component_id: `G-${String(components.length + 1).padStart(2, '0')}`,
      entry_ids: missing.filter((id) => entries.includes(id)),
      node_ids: missing,
      status: { state: 'unchecked', asked: 0, skipped: [], refilled: [], reasked: [], spot_checks: [] },
    })
  }
  for (const component of components) {
    if (!component.entry_ids.length) {
      component.entry_ids = component.node_ids.filter((id) => entries.includes(id))
    }
  }
  const riskPoints = (Array.isArray(raw?.risk_points) ? raw.risk_points : [])
    .filter((rp) => rp && rp.node_id in out && typeof rp.quote === 'string' && report.includes(rp.quote.trim()))
    .slice(0, 5)
    .map((rp) => ({
      node_id: rp.node_id,
      quote: rp.quote.trim(),
      question_type: TYPES.has(rp.question_type) ? rp.question_type : '复述解释题',
      level: RISK_ORDER[rp.level] ? rp.level : 'mid',
      reason: String(rp.reason ?? ''),
    }))
  applyLineageProvenance({ nodes: out }, report, lineage, knowledgeSpans)
  markAssumedKnown({ nodes: out })
  return {
    graph: {
      graph_id: String(source?.graph_id ?? `audit-${Date.now()}`),
      version: '1.2',
      created_at: new Date().toISOString(),
      report_span: report.slice(0, 80),
      nodes: out,
      edges,
      cycles: Array.isArray(source?.cycles) ? source.cycles : [],
      non_prereq_links: Array.isArray(source?.non_prereq_links) ? source.non_prereq_links : [],
      components,
      dial,
    },
    risk_points: riskPoints,
  }
}

/**
 * Compute the first-round budget from entry origins and risk.
 * @param {any} graph
 * @param {number} dial
 * @returns {{total: number, simple: number, normal: number, spotRate: number, skipLimit: number, reaskLimit: number, items: any[]}}
 */
function budgetPlan(graph, dial) {
  const total = 3 + Math.floor((dial - 1) / 2)
  const entries = []
  for (const component of graph.components) {
    for (const id of component.entry_ids) {
      const node = graph.nodes[id]
      if (!node) continue
      entries.push({ component_id: component.component_id, entry_id: id, node })
    }
  }
  // 信息刀的一小步：风险相同，优先问被更多后继共用的前置。
  const entryScore = (entry) =>
    (RISK_ORDER[entry.node.risk] ?? 1) * (1 + Math.log1p(entry.node.children?.length ?? 0))
  const byRisk = (a, b) => entryScore(b) - entryScore(a)
  const ai = entries.filter((e) => e.node.origin === 'ai').sort(byRisk)
  const human = entries.filter((e) => e.node.origin !== 'ai').sort(byRisk)
  const items = []
  let used = 0
  for (const entry of ai.slice(0, 2)) {
    if (used >= total) break
    const count = Math.min(2, total - used)
    items.push({ ...entry, tier: 'normal', count, reason: 'AI 入口：优先考察' })
    used += count
  }
  if (used < total) {
    for (const entry of human.slice(0, 2)) {
      if (used >= total) break
      items.push({ ...entry, tier: 'simple', count: 1, reason: '人类入口：先做一次廉价信任校验' })
      used += 1
    }
  }
  // 入口不足时，把剩余题量补给风险最高的入口，保证 3–5 题
  for (const entry of [...ai, ...human]) {
    if (used >= total) break
    const existing = items.find((item) => item.entry_id === entry.entry_id)
    if (existing) {
      existing.count += 1
      used += 1
    } else {
      items.push({ ...entry, tier: entry.node.origin === 'ai' ? 'normal' : 'simple', count: 1, reason: '入口不足，补足题量' })
      used += 1
    }
  }
  const simple = items.filter((item) => item.tier === 'simple').reduce((n, item) => n + item.count, 0)
  return {
    total,
    simple,
    normal: total - simple,
    spotRate: 0.1 * dial,
    skipLimit: dial >= 4 ? 1 : 2,
    reaskLimit: dial <= 1 ? 0 : dial === 2 ? 1 : 2,
    items: items.map(({ node, ...rest }) => ({ ...rest, node_id: rest.entry_id, risk: node.risk, origin: node.origin })),
  }
}

/**
 * Keep only questions whose quote really appears in the report.
 * @param {any} raw
 * @param {any} graph
 * @param {string} report
 * @param {{mode: string, budget?: any}} context
 * @returns {any[]}
 */
function normalizeQuestions(raw, graph, report, context) {
  const list = Array.isArray(raw?.questions) ? raw.questions : Array.isArray(raw) ? raw : []
  const out = []
  for (const q of list) {
    if (!q || typeof q !== 'object') continue
    const quote = String(q.quote ?? '').trim()
    if (!quote || !report.includes(quote)) continue
    const type = TYPES.has(q.type) ? q.type : null
    if (!type) continue
    const nodeId = q.node_id in graph.nodes ? q.node_id : null
    if (!nodeId) continue
    if (graph.nodes[nodeId]?.assumed_known) continue
    const entryId = q.entry_id in graph.nodes ? q.entry_id : nodeId
    const points = Array.isArray(q.rubric?.expected_points)
      ? q.rubric.expected_points.map((p) => String(p)).filter(Boolean).slice(0, 4)
      : []
    if (!points.length) continue
    out.push({
      id: `Q${out.length + 1}`,
      mode: context.mode,
      variant_of: q.variant_of ?? null,
      type,
      tier: q.tier === 'simple' ? 'simple' : 'normal',
      entry_id: entryId,
      component_id:
        graph.components.find((c) => c.node_ids.includes(entryId))?.component_id ??
        graph.components[0]?.component_id,
      node_id: nodeId,
      dial: context.dial,
      spot_check: Boolean(q.spot_check),
      skip_allowed: true,
      quote,
      question: String(q.question ?? '').trim(),
      rubric: {
        expected_points: points,
        must_not: Array.isArray(q.rubric?.must_not)
          ? q.rubric.must_not.map((p) => String(p)).filter(Boolean).slice(0, 3)
          : [],
      },
      followup: String(q.followup ?? '').trim() || '你能用“因为—所以”再讲一遍吗？',
      difficulty: ['低', '中', '高'].includes(q.difficulty) ? q.difficulty : '中',
    })
    if (!out.at(-1).question) out.pop()
  }
  return out
}

/**
 * Deterministic fallback question for a node, used only when P2 returns fewer
 * valid questions than the budget needs.
 * @param {any} graph
 * @param {string} nodeId
 * @param {string} entryId
 * @param {'simple'|'normal'} tier
 * @param {string} report
 * @param {number} dial
 * @param {number} index
 * @returns {any}
 */
function fallbackQuestion(graph, nodeId, entryId, tier, report, dial, index, avoidQuote) {
  const node = graph.nodes[nodeId]
  const sentences = report.split(/(?<=[。！？；])/).map((s) => s.trim()).filter(Boolean)
  const pool = avoidQuote ? sentences.filter((s) => s !== avoidQuote) : sentences
  const quote =
    pool.find((s) => node.text && s.includes(node.text.slice(0, Math.min(6, node.text.length)))) ??
    pool[index % Math.max(1, pool.length)] ??
    pool[0] ??
    report.slice(0, 60)
  const type = node.kind === 'term' ? '术语定义题' : node.kind === 'conclusion' ? '前提变换题' : '复述解释题'
  const question =
    type === '术语定义题'
      ? `请用自己的话定义“${node.text}”，并说明它在本报告里具体指什么。`
      : type === '前提变换题'
        ? `如果报告里的一个关键前提不成立，关于“${node.text}”的结论还成立吗？请说明理由。`
        : `请不用报告里的原词，解释“${node.text}”这句话的意思，并说明它为什么可能成立。`
  return {
    id: `Q${index + 1}`,
    mode: 'first_pass',
    variant_of: null,
    type,
    tier,
    entry_id: entryId,
    component_id: graph.components.find((c) => c.node_ids.includes(entryId))?.component_id ?? 'G-01',
    node_id: nodeId,
    dial,
    spot_check: false,
    skip_allowed: true,
    quote,
    question,
    rubric: {
      expected_points: [`说清“${node.text}”在报告里的意思`, '说明它与报告结论的关系', '给出报告内的理由或条件'],
      must_not: ['只照抄原文而不解释', '引入报告以外的理论或数据'],
    },
    followup: '你能用“因为—所以”再讲一遍吗？',
    difficulty: node.risk === 'high' ? '高' : '中',
  }
}

/**
 * Ensure the requested number of questions exists, filling from risk points.
 * @param {any[]} questions
 * @param {number} count
 * @param {any} graph
 * @param {any[]} riskPoints
 * @param {string} report
 * @param {number} dial
 * @returns {any[]}
 */
function fillQuestions(questions, count, graph, riskPoints, report, dial) {
  const out = questions.slice(0, Math.max(count, 1))
  const pool = riskPoints.filter((rp) => rp?.node_id && !graph.nodes[rp.node_id]?.assumed_known)
  const fallbackNode = Object.keys(graph.nodes).find((id) => !graph.nodes[id]?.assumed_known)
  let guard = 0
  while (out.length < count && guard < 12) {
    guard += 1
    const rp = pool[out.length % Math.max(1, pool.length)]
    const nodeId = rp?.node_id ?? fallbackNode
    if (!nodeId) break
    const q = fallbackQuestion(graph, nodeId, nodeId, 'normal', report, dial, out.length)
    if (!out.some((x) => x.quote === q.quote && x.node_id === q.node_id)) out.push(q)
    else break
  }
  return out
}

/**
 * P3 judge with one automatic second pass when confidence is low.
 * @param {any} ctx
 * @param {any} question
 * @param {string} answer
 * @param {number} dial
 * @param {boolean} followupUsed
 * @returns {Promise<any>}
 */
async function judge(ctx, question, answer, dial, followupUsed) {
  const payload = {
    mode: 'judge',
    question: {
      id: question.id,
      type: question.type,
      quote: question.quote,
      rubric: question.rubric,
    },
    answer,
    dial,
    followup_used: Boolean(followupUsed),
    second_pass: false,
  }
  const first = await stage(ctx, 'p3', payload)
  const verdicts = new Set(['correct', 'partial', 'wrong', 'unsure'])
  if (!verdicts.has(first.verdict)) throw Object.assign(new Error('P3 返回了未知 verdict'), { statusCode: 502 })
  const normalized = {
    mode: 'judge',
    question_id: question.id,
    verdict: first.verdict,
    hit_points: Array.isArray(first.hit_points) ? first.hit_points.map(String) : [],
    miss_points: Array.isArray(first.miss_points) ? first.miss_points.map(String) : [],
    conflict: Boolean(first.conflict),
    evidence: String(first.evidence ?? ''),
    confidence: Number.isFinite(first.confidence) ? Math.max(0, Math.min(1, first.confidence)) : 0.6,
    needs_review: Boolean(first.needs_review),
    reread: Array.isArray(first.reread) ? first.reread.map(String).slice(0, 2) : [],
    first_verdict: first.verdict,
    disclaimer: '这是对这道题回答的判定，不是对报告的评分。',
  }
  if (normalized.confidence < 0.7 && normalized.verdict !== 'unsure') {
    try {
      const second = await stage(ctx, 'p3', { ...payload, second_pass: true })
      if (second.verdict !== normalized.verdict) {
        normalized.needs_review = true
        normalized.second_verdict = second.verdict
        normalized.confidence = 0.5
      } else {
        normalized.confidence = Math.max(normalized.confidence, 0.7)
      }
    } catch {
      // 二次判定失败不阻塞：保留第一次结果并标记 needs_review
      normalized.needs_review = true
    }
  }
  return normalized
}

const DEMO_REPORT =
  '该方案通过过程性追问提升学生的认知参与度。相比于传统课堂提问，过程性追问不追求标准答案，而是不断逼近学生的真实思路。已有研究表明，认知卸载会削弱深度学习，因此减少认知卸载是提升参与度的关键。如果追问只发生在学习结束后，学生已经离开思考现场，教师拿到的就只是答案，而不是思路。这也是报告把“过程中”单独提出来的原因。'

const DEMO_INDEX = [
  { concept: '认知卸载', origin: 'human', self_rating: 'can_explain', note_id: 'n-12', source: '文献[3]' },
  { concept: '认知参与度', origin: 'ai', self_rating: 'heard_only', note_id: 'n-08' },
  { concept: '过程性追问', origin: 'ai', self_rating: 'heard_only' },
]

/**
 * Canned demo payload: same sample as 设计文档 附录 A, so the UI can be shown
 * without a model call and without network.
 * @param {number} dial
 * @returns {any}
 */
function demoPayload(dial) {
  const nodes = {
    R1: { text: '过程性追问提升认知参与度', kind: 'claim', origin: 'ai', origin_basis: 'AI 生成，用户未重写', provenance: 'ai_summary', parents: ['T1', 'T3'], children: [], level: 3, risk: 'high' },
    T1: { text: '过程性追问', kind: 'term', origin: 'ai', origin_basis: 'AI 生成，用户未重写', provenance: 'ai_summary', parents: [], children: ['R1'], level: 1, risk: 'mid' },
    T3: { text: '认知参与度', kind: 'term', origin: 'ai', origin_basis: 'AI 生成，全文未定义', provenance: 'ai_summary', parents: ['T4'], children: ['R1'], level: 2, risk: 'high' },
    T4: { text: '认知卸载', kind: 'term', origin: 'human', origin_basis: '用户来源 + 文献[3]', provenance: 'user_source', parents: [], children: ['T3', 'R2'], level: 1, risk: 'low', evidence: { type: 'citation', ref: '[3]' } },
    R2: { text: '减少认知卸载是提升参与度的关键', kind: 'claim', origin: 'ai', origin_basis: 'AI 生成，用户未重写', provenance: 'ai_summary', parents: ['T4', 'T5'], children: [], level: 2, risk: 'mid' },
    T5: { text: '虚假掌握', kind: 'term', origin: 'ai', origin_basis: 'AI 生成，用户未重写', provenance: 'ai_summary', parents: [], children: ['R2'], level: 1, risk: 'mid' },
  }
  const edges = [
    { from: 'T1', to: 'R1', type: 'prereq' },
    { from: 'T3', to: 'R1', type: 'prereq' },
    { from: 'T4', to: 'T3', type: 'prereq' },
    { from: 'T4', to: 'R2', type: 'prereq' },
    { from: 'T5', to: 'R2', type: 'prereq' },
  ]
  const graph = {
    graph_id: `audit-demo-${Date.now()}`,
    version: '1.2',
    created_at: new Date().toISOString(),
    report_span: DEMO_REPORT,
    nodes,
    edges,
    cycles: [],
    non_prereq_links: [],
    components: [
      {
        component_id: 'G-01',
        entry_ids: ['R1', 'R2'],
        node_ids: ['R1', 'T1', 'T3', 'T4', 'R2', 'T5'],
        status: { state: 'unchecked', asked: 0, skipped: [], refilled: [], reasked: [], spot_checks: [] },
      },
    ],
    dial,
  }
  const risk_points = [
    { node_id: 'R1', quote: '该方案通过过程性追问提升学生的认知参与度。', question_type: '复述解释题', level: 'high', reason: '核心结论，未说明机制' },
    { node_id: 'T3', quote: '该方案通过过程性追问提升学生的认知参与度。', question_type: '术语定义题', level: 'high', reason: '全文使用，未定义' },
    { node_id: 'R2', quote: '减少认知卸载是提升参与度的关键。', question_type: '前提变换题', level: 'mid', reason: '依赖隐含前提' },
  ]
  const budget = budgetPlan(graph, dial)
  const questions = [
    {
      id: 'Q1',
      mode: 'first_pass',
      variant_of: null,
      type: '复述解释题',
      tier: 'normal',
      entry_id: 'R1',
      component_id: 'G-01',
      node_id: 'R1',
      dial,
      spot_check: false,
      skip_allowed: true,
      quote: '该方案通过过程性追问提升学生的认知参与度。',
      question: '请不用“过程性追问”“认知参与度”这两个词，解释这句话在说什么，并说明它为什么可能成立。',
      rubric: {
        expected_points: ['追问发生在学习过程中，而不是学习结束后', '追问迫使学生把思路说出来', '思路外化之后才可能被教师调整'],
        must_not: ['把追问等同于普通课堂提问', '声称追问能直接提高考试分数'],
      },
      followup: '你能用“因为—所以”再讲一遍吗？',
      difficulty: '中',
    },
    {
      id: 'Q2',
      mode: 'first_pass',
      variant_of: null,
      type: '前提变换题',
      tier: 'normal',
      entry_id: 'R1',
      component_id: 'G-01',
      node_id: 'R1',
      dial,
      spot_check: false,
      skip_allowed: true,
      quote: '相比于传统课堂提问，过程性追问不追求标准答案，而是不断逼近学生的真实思路。',
      question: '如果教师把“逼近真实思路”换成了“核对标准答案”，原结论还成立吗？请说明理由。',
      rubric: {
        expected_points: ['原结论依赖“追问不追求标准答案”', '换成核对答案后，学生更可能迎合而不是外化思路', '结论应限定为“在不追求标准答案的前提下成立”'],
        must_not: ['只答成立/不成立而不给理由'],
      },
      followup: '如果换一个前提，结论会变成什么？',
      difficulty: '中',
    },
    {
      id: 'Q3',
      mode: 'first_pass',
      variant_of: null,
      type: '术语定义题',
      tier: 'simple',
      entry_id: 'T4',
      component_id: 'G-01',
      node_id: 'T4',
      dial,
      spot_check: false,
      skip_allowed: true,
      quote: '已有研究表明，认知卸载会削弱深度学习，因此减少认知卸载是提升参与度的关键。',
      question: '请用自己的话定义“认知卸载”，并说明它和“抄袭”的区别。',
      rubric: {
        expected_points: ['认知卸载是把思考过程外包给工具或他人', '抄袭是未标注地占有他人成果', '两者都可能发生，但判断标准不同'],
        must_not: ['用“卸载”解释“卸载”', '把认知卸载直接等同于抄袭'],
      },
      followup: '在本报告里，这个词具体指什么？',
      difficulty: '低',
    },
    {
      id: 'Q4',
      mode: 'first_pass',
      variant_of: null,
      type: '术语定义题',
      tier: 'normal',
      entry_id: 'R2',
      component_id: 'G-01',
      node_id: 'T5',
      dial,
      spot_check: false,
      skip_allowed: true,
      quote: '因此减少认知卸载是提升参与度的关键。',
      question: '请用自己的话说明“虚假掌握”和“没学会”的区别，并指出报告里用的是哪一种。',
      rubric: {
        expected_points: ['虚假掌握指能复述/使用但讲不出理由', '没学会指连复述或使用也做不到', '报告关注的是前者'],
        must_not: ['把两者当成同一个概念'],
      },
      followup: '在本报告里，这个词具体指什么？',
      difficulty: '中',
    },
    {
      id: 'Q5',
      mode: 'first_pass',
      variant_of: null,
      type: '复述解释题',
      tier: 'normal',
      entry_id: 'R2',
      component_id: 'G-01',
      node_id: 'R2',
      dial,
      spot_check: false,
      skip_allowed: true,
      quote: '因此减少认知卸载是提升参与度的关键。',
      question: '请不用“认知卸载”“参与度”这两个词，解释“减少认知卸载是提升参与度的关键”这句话为什么可能成立，并说明它依赖什么条件。',
      rubric: {
        expected_points: ['减少外部工具替学生思考的机会', '学生因此需要自己完成深度加工', '结论依赖“被卸载的是需要深度加工的任务”'],
        must_not: ['把认知卸载等同于使用任何工具'],
      },
      followup: '如果换一个前提，结论会变成什么？',
      difficulty: '高',
    },
  ].slice(0, budget.total)
  return {
    audit_id: graph.graph_id,
    graph,
    risk_points,
    budget,
    questions,
    dial,
    demo: true,
    provider: 'demo',
    model: 'canned',
    report_span: DEMO_REPORT,
    handoff_id: null,
    report_id: null,
    recorded_by: 'manual',
    recording: {
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      complete: true,
      gaps: [],
    },
    lineage: [{ span_id: 's1', turn_id: 'm0', author: 'ai', event: 'generated', range: [0, DEMO_REPORT.length] }],
  }
}

/**
 * Explain why a 3–5 question set cannot be built, or run P1 + budget + P2.
 * @param {any} ctx
 * @param {{report_text: string, retention_index: any[], dial: number, mode?: string}} input
 * @returns {Promise<any>}
 */
/**
 * Decide which report / lineage / index this audit uses when a handoff is
 * loaded. The panel prefills the report box from the handoff; if the user
 * edited it (e.g. to delete a name), the edited text is what they consented to
 * and what they see, so it must be the text that gets audited. Position-based
 * lineage no longer applies to edited text, so it is dropped and the recording
 * is marked incomplete; `knowledge_spans` stay valid because they match by
 * fingerprint, not by offset.
 * @param {any} handoff
 * @param {any} input
 * @returns {{report: string, lineage: any[], recording: any, retentionIndex: any[], edited: boolean, knowledgeSpans: any[]}}
 */
function resolveHandoffInput(handoff, input) {
  const now = new Date().toISOString()
  const handoffReport = String(handoff?.report_text ?? '').trim()
  const typedReport = String(input.report_text ?? '').trim()
  const edited = Boolean(handoff && typedReport && typedReport !== handoffReport)
  const report = typedReport || handoffReport
  const baseRecording = handoff?.recording ?? {
    started_at: now,
    ended_at: now,
    complete: false,
    gaps: ['未使用 /record 记录，来源谱系为空'],
  }
  // A small edit (deleting a name) keeps the fingerprints meaningful; a
  // wholesale replacement would attribute the old report's sources to a new
  // text, so it drops them instead.
  const replaced = edited && textSimilarity(report, handoffReport) < 0.5
  const recording = edited
    ? {
        ...baseRecording,
        complete: false,
        gaps: [
          ...(Array.isArray(baseRecording.gaps) ? baseRecording.gaps : []),
          replaced
            ? '报告与 handoff 差异过大，原来源指纹作废，本轮按未知处理'
            : '报告在审计前被编辑：原引用位置失效，来源按指纹重算',
        ],
      }
    : baseRecording
  const lineage = edited ? [] : Array.isArray(handoff?.lineage) ? handoff.lineage : []
  const indexInput = Array.isArray(input.retention_index) ? input.retention_index : null
  const retentionIndex = indexInput ?? (Array.isArray(handoff?.retention_index) ? handoff.retention_index : [])
  return {
    report,
    lineage,
    recording,
    retentionIndex,
    edited,
    knowledgeSpans: !replaced && Array.isArray(handoff?.knowledge_spans) ? handoff.knowledge_spans : [],
  }
}

async function start(ctx, input) {
  if (input.mode === 'demo') return demoPayload(input.dial)
  const handoff = input.handoff && typeof input.handoff === 'object' ? input.handoff : null
  const { report, lineage, recording, retentionIndex, edited, knowledgeSpans } = resolveHandoffInput(handoff, input)
  if (report.length < 80) {
    throw Object.assign(new Error('这段更像背景铺垫：少于 80 字，换一段有论点的。'), { statusCode: 422, code: 'INPUT_TOO_THIN' })
  }
  let graph
  let risk_points
  if (
    input.graph &&
    typeof input.graph === 'object' &&
    input.graph.nodes &&
    typeof input.graph.nodes === 'object' &&
    Array.isArray(input.graph.edges)
  ) {
    // Reuse a persisted DAG for the same report file: skip P1, still build the
    // budget and questions from the stored graph.
    graph = input.graph
    if (!graph.graph_id) graph.graph_id = `g-${reportDigest(report).slice(0, 12)}`
    risk_points = Array.isArray(input.risk_points) ? input.risk_points : []
  } else {
    const scan = await stage(ctx, 'p1', {
      report_text: report,
      lineage,
      retention_index: retentionIndex,
      recording,
      dial: input.dial,
    })
    const normalized = normalizeGraph(scan, report, input.dial, lineage, knowledgeSpans)
    graph = normalized.graph
    risk_points = normalized.risk_points
  }
  const budget = budgetPlan(graph, input.dial)
  const asked = []
  let questions = []
  try {
    const raw = await stage(ctx, 'p2', {
      graph,
      entry_ids: graph.components.flatMap((c) => c.entry_ids),
      budget: budget.items,
      dial: input.dial,
      mode: 'first_pass',
      asked,
    })
    questions = normalizeQuestions(raw, graph, report, { mode: 'first_pass', dial: input.dial })
  } catch (error) {
    if (error.code === 'INPUT_TOO_THIN') throw error
    // 出题失败不阻塞：用风险点兜底，但明确告诉界面
    questions = []
  }
  questions = fillQuestions(questions, budget.total, graph, risk_points, report, input.dial)
  return {
    audit_id: graph.graph_id,
    graph,
    risk_points,
    budget,
    questions,
    dial: input.dial,
    demo: false,
    provider: 'model',
    model: 'profile-default',
    report_span: report.slice(0, 80),
    handoff_id: handoff?.handoff_id ?? null,
    report_id: handoff?.report_id ?? null,
    lineage,
    recording,
    recorded_by: handoff?.recorded_by ?? 'manual',
    edited,
    knowledge_span_count: knowledgeSpans.length,
  }
}

/**
 * Basic desensitization for the exported copy. It cannot recognize every
 * Chinese name, so the entry screen still asks the user to remove names first.
 * @param {unknown} value
 * @returns {string}
 */
function redact(value) {
  return String(value ?? '')
    .replace(/1[3-9]\d{9}/g, '〔手机号已脱敏〕')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '〔邮箱已脱敏〕')
    .replace(/(学号|工号|导师|项目号|项目名)\s*[:：]?\s*[A-Za-z0-9\u4e00-\u9fa5-]{2,}/g, '$1〔已脱敏〕')
}

/**
 * Build a deterministic Markdown + JSON export. No model call: export must be
 * reproducible and must not re-judge anything.
 * @param {any} input
 * @returns {any}
 */
function exportAudit(input) {
  const records = Array.isArray(input.records) ? input.records : []
  const graph = input.graph ?? { nodes: {} }
  const skipped = Array.isArray(input.skipped) ? input.skipped : []
  const refills = Array.isArray(input.refills) ? input.refills : []
  const questions = records.map((r, i) => ({
    id: r.id ?? `Q${i + 1}`,
    阶段: r.stage === 'reask' ? 'reask' : r.spot_check ? 'spot' : 'first_pass',
    题型: r.type,
    档位: r.tier,
    来源原文: redact(r.quote),
    题目: redact(r.question),
    期望要点: r.expected_points ?? r.rubric?.expected_points ?? [],
    追问: r.followup ?? '',
    用户回答: redact(String(r.answer ?? '').slice(0, 200)),
    判定: r.verdict,
    判定依据: {
      hit_points: r.judgment?.hit_points ?? [],
      miss_points: r.judgment?.miss_points ?? [],
      evidence: redact(r.judgment?.evidence ?? ''),
      confidence: r.judgment?.confidence ?? 0,
      needs_review: Boolean(r.judgment?.needs_review),
      first_verdict: r.judgment?.first_verdict,
    },
    建议: r.judgment?.reread ?? [],
    时间戳: r.timestamp ?? new Date().toISOString(),
    entry_id: r.entry_id,
    component_id: r.component_id,
    variant_of: r.variant_of ?? null,
    dial: input.dial,
    spot_check: Boolean(r.spot_check),
  }))
  for (const skip of skipped) {
    if (questions.some((q) => q.id === skip.id)) continue
    questions.push({
      id: skip.id,
      阶段: 'first_pass',
      题型: skip.type,
      档位: skip.tier,
      来源原文: redact(skip.quote),
      题目: redact(skip.question),
      期望要点: skip.expected_points ?? skip.rubric?.expected_points ?? [],
      追问: skip.followup ?? '',
      用户回答: '',
      判定: 'skipped',
      判定依据: { hit_points: [], miss_points: [], evidence: '用户主动跳过', confidence: 1, needs_review: false },
      建议: [],
      时间戳: skip.timestamp ?? new Date().toISOString(),
      entry_id: skip.entry_id,
      component_id: skip.component_id,
      variant_of: null,
      dial: input.dial,
      spot_check: false,
    })
  }
  const counts = { correct: 0, partial: 0, wrong: 0, unsure: 0, skipped: 0 }
  for (const q of questions) if (q.判定 in counts) counts[q.判定] += 1

  // 缺口地图：节点状态
  const status = new Map()
  for (const id of Object.keys(graph.nodes ?? {})) status.set(id, '·')
  for (const record of records) {
    const node = record.node_id
    if (!node) continue
    if (record.verdict === 'correct') status.set(node, '●')
    else if (record.verdict === 'partial' || record.verdict === 'wrong' || record.verdict === 'unsure') status.set(node, '○')
  }
  if (input.upgraded) {
    for (const record of records) {
      if (record.tier === 'simple' && record.verdict !== 'correct' && status.get(record.node_id) !== '●') status.set(record.node_id, '◐')
    }
  }
  for (const skip of skipped) {
    if (skip.node_id && status.get(skip.node_id) === '·') status.set(skip.node_id, '⊘')
  }
  for (const refill of refills) {
    if (!refill.node_id) continue
    if (refill.reasked_correct) status.set(refill.node_id, '●')
    else if (refill.refill_text) status.set(refill.node_id, '◌')
  }
  for (const [id, node] of Object.entries(graph.nodes ?? {})) {
    if (node?.assumed_known && status.get(id) === '·') status.set(id, '●')
  }
  const symbolName = { '●': '已通过（含人类材料默认确认）', '○': '有缺口', '◐': '简单档未过关，已升级', '⊘': '主动跳过，待补全', '◌': '已补全，待回访', '·': '本轮未考察' }
  const gapRows = [...status.entries()].map(([id, sym]) => `| ${sym} | ${id} | ${graph.nodes?.[id]?.text ?? ''} | ${symbolName[sym]} |`)

  const quiz = {
    version: '1.0',
    audit_id: input.audit_id ?? `audit-${Date.now()}`,
    handoff_id: input.handoff_id ?? null,
    report_id: input.report_id ?? null,
    recording: input.recording ?? { complete: false, gaps: ['未执行 /record end'] },
    created_at: new Date().toISOString(),
    report_span: '〔已脱敏〕' + redact(input.report_span ?? '').slice(0, 80),
    budget: input.budget
      ? { total: input.budget.total, simple: input.budget.simple, normal: input.budget.normal, upgraded: Boolean(input.upgraded) }
      : undefined,
    dial: input.dial,
    questions,
    disclaimer: DISCLAIMER,
  }
  const budgetLine = input.budget
    ? `${input.dial}（${input.budget.total} 题 · 抽查 ${Math.round(input.budget.spotRate * 100)}%）`
    : `${input.dial}`
  const questionBlocks = questions
    .map(
      (q) => `### ${q.id} · ${q.题型} · ${q.档位 === 'simple' ? '简单档' : '正常档'}
- 来源原文：“${q.来源原文}”
- 题目：${q.题目}
- 你的回答：“${q.用户回答 || '（未作答）'}”
- 判定：${{ correct: '对', partial: '部分对', wrong: '错', unsure: '不确定', skipped: '主动跳过' }[q.判定] ?? q.判定}
- 命中：${q.判定依据.hit_points.join('；') || '—'}
- 缺失：${q.判定依据.miss_points.join('；') || '—'}
- 回读：${q.建议.join('；') || '—'}`
    )
    .join('\n\n')
  const rereadAll = [...new Set(questions.flatMap((q) => (Array.isArray(q.建议) ? q.建议 : [])))].slice(0, 6)
  const recordingNote = input.recording?.complete === false
    ? `\n> ⚠ 记录不完整：${(input.recording.gaps || []).join('；') || '没有 /record end'}。未覆盖片段按 unknown 处理。\n`
    : ''
  const markdown = `# 理解审计 · 复盘

> ${DISCLAIMER}
${recordingNote}
- handoff：${input.handoff_id ?? quiz.audit_id}
- 深度：${budgetLine}
- 本轮：${questions.length} 题；升级 ${input.upgraded ? '1 处' : '0 处'}；回访 ${refills.length} 题
- 判定：对 ${counts.correct} · 部分对 ${counts.partial} · 错 ${counts.wrong} · 不确定 ${counts.unsure} · 跳过 ${counts.skipped}

## 缺口地图

| 状态 | 节点 | 知识点 | 说明 |
|---|---|---|---|
${gapRows.join('\n')}

符号：● 已通过（含人类材料默认确认） / ○ 有缺口 / ◐ 升级过 / ⊘ 跳过待补 / ◌ 补全待回访 / · 未考察。

## 逐题

${questionBlocks}
${rereadAll.length ? `\n## 回读建议\n\n${rereadAll.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n` : ''}
## 声明

${DISCLAIMER}
`
  return { quiz, markdown }
}

/**
 * Persist one audit under `<workspace>/audit/<id>.json` — the plugin's only
 * file write, matching the design's audit/<id>.json state boundary.
 * @param {any} ctx
 * @param {any} input
 * @returns {Promise<{path: string}>}
 */
async function saveAudit(ctx, input) {
  const requested = typeof input.cwd === 'string' && isAbsolute(input.cwd) ? input.cwd : undefined
  const root = requested ?? ctx.get('profileContext')?.cwd ?? process.cwd()
  const dir = join(root, 'audit')
  await mkdir(dir, { recursive: true })
  const id = String(input.audit_id || Date.now()).replace(/[^A-Za-z0-9._-]/g, '_')
  const file = join(dir, `${id}.json`)
  const { quiz } = exportAudit(input)
  await writeFile(file, JSON.stringify({ version: '1.0', saved_at: new Date().toISOString(), quiz }, null, 2), 'utf8')
  return { path: file, relative: `audit/${id}.json` }
}

/**
 * Durable audit state: the DAG, budget, question queue, answers and verdicts.
 * The panel writes it after every judged question, so a refresh or context
 * compaction can restore the round instead of rebuilding it.
 */
const STATE_ROOT = 'understanding-auditor'
const STATE_SUBDIR = 'audit-state'
const MAX_STATE_BYTES = 8 * 1024 * 1024

/**
 * @param {string} cwd
 * @returns {string}
 */
function auditStateDir(cwd) {
  return join(cwd, STATE_ROOT, STATE_SUBDIR)
}

/**
 * Save one audit snapshot under `<cwd>/understanding-auditor/audit-state/`.
 * @param {any} ctx
 * @param {any} body
 * @returns {Promise<{file: string, relative: string}>}
 */
async function saveAuditState(ctx, body) {
  const state = body?.state
  if (!state || typeof state !== 'object') throw Object.assign(new Error('缺少审计状态'), { statusCode: 400 })
  const report = String(state.report ?? '')
  if (report.length > MAX_STATE_BYTES) throw Object.assign(new Error('审计状态超过 8MB'), { statusCode: 413 })
  const cwd = typeof body.cwd === 'string' && isAbsolute(body.cwd) ? body.cwd : (ctx.get('profileContext')?.cwd ?? process.cwd())
  const auditId = String(state.session?.audit_id ?? state.audit_id ?? `audit-${Date.now()}`)
  const safeId = auditId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96) || `audit-${Date.now()}`
  const dir = auditStateDir(cwd)
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${safeId}.json`)
  const payload = { version: '1.0', saved_at: new Date().toISOString(), ...state }
  const text = JSON.stringify(payload, null, 2)
  if (text.length > MAX_STATE_BYTES) throw Object.assign(new Error('审计状态超过 8MB'), { statusCode: 413 })
  await writeFile(file, text, 'utf8')
  return { file, relative: join(STATE_ROOT, STATE_SUBDIR, `${safeId}.json`) }
}

/**
 * Read the newest audit snapshot under `<cwd>/understanding-auditor/audit-state/`.
 * @param {any} ctx
 * @param {string} [requested]
 * @returns {Promise<{file: string, state: any} | undefined>}
 */
async function readLatestAuditState(ctx, requested) {
  const cwd = typeof requested === 'string' && isAbsolute(requested) ? requested : (ctx.get('profileContext')?.cwd ?? process.cwd())
  const dir = auditStateDir(cwd)
  let names
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json'))
  } catch {
    return undefined
  }
  let best
  for (const name of names) {
    const file = join(dir, name)
    try {
      const info = await stat(file)
      if (!best || info.mtimeMs > best.mtimeMs) best = { file, mtimeMs: info.mtimeMs }
    } catch {
      // ignore a file that vanished
    }
  }
  if (!best) return undefined
  try {
    const state = JSON.parse(await readFile(best.file, 'utf8'))
    if (!state || typeof state !== 'object' || !state.session) return undefined
    return { file: best.file, state }
  } catch {
    return undefined
  }
}

/**
 * Persistent DAG store: one normalized graph per report file, keyed by the
 * SHA-256 of the report text. The report itself is not copied here — only the
 * graph and its risk points — so re-selecting the same file can reuse the DAG
 * without another P1 call.
 */
const DAG_SUBDIR = 'dags'
const MAX_DAG_BYTES = 2 * 1024 * 1024

/** @param {string} text */
function reportDigest(text) {
  return createHash('sha256').update(String(text)).digest('hex')
}

/** @param {string} cwd */
function dagDir(cwd) {
  return join(cwd, STATE_ROOT, DAG_SUBDIR)
}

/**
 * @param {any} ctx
 * @param {any} body
 * @returns {Promise<{file: string, report_id: string}>}
 */
async function saveDag(ctx, body) {
  const graph = body?.graph
  if (!graph || typeof graph !== 'object' || !graph.nodes || !Array.isArray(graph.edges)) {
    throw Object.assign(new Error('缺少可保存的 DAG'), { statusCode: 400 })
  }
  const report = String(body.report_text ?? '')
  const reportId = String(body.report_id || (report ? reportDigest(report) : '')).trim()
  if (!/^[a-f0-9]{32,64}$/i.test(reportId)) {
    throw Object.assign(new Error('report_id 需要是报告正文的 SHA-256'), { statusCode: 400 })
  }
  const cwd = typeof body.cwd === 'string' && isAbsolute(body.cwd) ? body.cwd : (ctx.get('profileContext')?.cwd ?? process.cwd())
  const dir = dagDir(cwd)
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${reportId}.json`)
  const payload = {
    version: '1.0',
    report_id: reportId,
    report_file: String(body.report_file ?? '').slice(0, 240),
    report_chars: report.length,
    saved_at: new Date().toISOString(),
    graph,
    risk_points: Array.isArray(body.risk_points) ? body.risk_points : [],
  }
  const text = JSON.stringify(payload, null, 2)
  if (text.length > MAX_DAG_BYTES) throw Object.assign(new Error('DAG 超过 2MB'), { statusCode: 413 })
  await writeFile(file, text, 'utf8')
  return { file, report_id: reportId }
}

/**
 * @param {any} ctx
 * @param {string} [requested]
 * @param {string} reportId
 * @returns {Promise<{file: string, dag: any} | undefined>}
 */
async function loadDag(ctx, requested, reportId) {
  const id = String(reportId ?? '').trim()
  if (!/^[a-f0-9]{32,64}$/i.test(id)) return undefined
  const cwd = typeof requested === 'string' && isAbsolute(requested) ? requested : (ctx.get('profileContext')?.cwd ?? process.cwd())
  const file = join(dagDir(cwd), `${id}.json`)
  try {
    const dag = JSON.parse(await readFile(file, 'utf8'))
    if (!dag || typeof dag !== 'object' || !dag.graph) return undefined
    return { file, dag }
  } catch {
    return undefined
  }
}

/**
 * Plugin body.
 * @param {any} ctx
 */

// ---------------------------------------------------------------------------
// v1.9 `/record` recorder: a manual, side-channel lineage recorder.
// It subscribes to committed session events only while a recording window is
// open, writes lineage/handoff files, and never sends a message or tool.
// ---------------------------------------------------------------------------

/** @type {Map<string, {startedAt: string, startSeq: number, spans: any[], lastAt: string}>} */
const recorders = new Map()

// Live recording is a write-ahead log on disk, not an in-memory buffer: one
// append per settled event, under <workspace>/understanding-auditor/recording/.
// Report text and hashes share one JSONL line, so the hot path is a single
// appendFile; slow work (PDF extraction, model summary) has its own queue and
// can never hold up the next assistant message. `/record end` only reads this
// log; it never reads the conversation history.
const RECORD_ROOT = 'understanding-auditor'
const RECORD_SUBDIR = 'recording'
const RECORD_VERSION = '1.9.8'

/**
 * Extract visible text from a content-block array.
 * @param {any[]} content
 * @returns {string}
 */
function contentText(content) {
  return (Array.isArray(content) ? content : [])
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/**
 * Heuristic: a short imperative user message is a writing instruction, not
 * knowledge. v1.9 explicitly says instructions do not count as known.
 * @param {string} text
 * @returns {boolean}
 */
function isInstruction(text) {
  const value = text.trim()
  if (!value) return true
  // Imperative openers win regardless of length: a long "请帮我写…" is still
  // an instruction, and its topic words must not become user-supplied knowledge.
  if (/^(请|帮我|帮忙|给我|把|不要|别|不用|需要你|你(来|先|帮|写|改|给|把))/u.test(value)) return true
  if (/^(写|生成|修改|润色|扩写|缩写|继续|再来|重写)(一|个|段|篇|份|下|成|这|那|写)/u.test(value)) return true
  if (/你(来|先|帮|写|改)/u.test(value) && /(报告|论文|摘要|段落|框架|提纲|字数|字左右|格式|要求)/u.test(value)) return true
  return false
}

/**
 * Heuristic: a question is an inquiry, not knowledge the user supplied.
 * Asking "什么是认知卸载" must not turn that concept into `human`.
 * @param {string} text
 * @returns {boolean}
 */
function isInquiry(text) {
  const value = text.trim()
  if (!value) return true
  if (/[？?]\s*$/u.test(value)) return true
  if (value.length > 120) return false
  return /^(什么是|为什么|怎么|如何|是否|能不能|可不可以|请问|解释一下|这段是|这句是)/u.test(value)
}

/**
 * Resolve the writing session's working directory.
 * @param {any} ctx
 * @param {any} session
 * @returns {string}
 */
function cwdOf(ctx, session) {
  return session?.header?.cwd ?? ctx.get('profileContext')?.cwd ?? process.cwd()
}

/** Hard ceiling for one attachment read. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/**
 * Read one attachment's bytes through the host attachment service.
 * @param {any} ctx
 * @param {any} ref
 * @returns {Promise<Buffer>}
 */
async function readAttachmentBytes(ctx, ref) {
  const declared = Number(ref?.bytes ?? 0)
  if (declared > MAX_ATTACHMENT_BYTES) throw new Error(`附件超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB`)
  const service = ctx.attachments
  if (!service) throw new Error('附件服务不可用')
  const hostPath = typeof service.fileHostPath === 'function' ? service.fileHostPath(ref) : undefined
  if (hostPath) return readFile(hostPath)
  if (typeof service.readFileStream === 'function') {
    const chunks = []
    let size = 0
    for await (const chunk of service.readFileStream(ref)) {
      size += chunk.length
      if (size > MAX_ATTACHMENT_BYTES) throw new Error(`附件超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB`)
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }
  throw new Error('附件服务没有提供读取方法')
}

/**
 * Keep only concepts whose quote really occurs in the attachment text. The
 * summary itself is model-generated and must never become a source by itself.
 * @param {string} text
 * @param {any} raw
 * @returns {{summary: string, concepts: Array<{concept: string, quote: string}>}}
 */
function validateAttachmentSummary(text, raw) {
  const source = normalizeForMatch(text)
  const summary = String(raw?.summary ?? '').trim().slice(0, 400)
  const concepts = []
  for (const item of Array.isArray(raw?.concepts) ? raw.concepts : []) {
    const concept = String(item?.concept ?? '').trim().slice(0, 80)
    const quote = String(item?.quote ?? '').trim()
    if (!concept || quote.length < 4) continue
    if (!source.includes(normalizeForMatch(quote))) continue
    concepts.push({ concept, quote })
    if (concepts.length >= 12) break
  }
  return { summary, concepts }
}

/**
 * Summarise one attachment with the model outside the writing conversation:
 * a direct `ctx.llm` call, no session message, no tool.
 * @param {any} ctx
 * @param {string} name
 * @param {string} text
 * @returns {Promise<{status: 'ok'|'skipped', summary: string, concepts: any[], reason?: string}>}
 */
async function summarizeAttachment(ctx, name, text) {
  try {
    const body = await prompt('P5-附件摘要.md')
    const rawText = await complete(ctx, body, { name, text: text.slice(0, 30_000) })
    const parsed = parseLooseJson(rawText)
    return { status: 'ok', ...validateAttachmentSummary(text, parsed) }
  } catch (error) {
    return { status: 'skipped', summary: '', concepts: [], reason: String(error?.message ?? error) }
  }
}

/** Root folder for live recordings under one workspace. */
function recordingBase(cwd) {
  return join(cwd, RECORD_ROOT, RECORD_SUBDIR)
}

/** One folder name per recording: timestamp + short session id. */
function recordingName(startedAt, sessionId) {
  const stamp = String(startedAt).replace(/[-:.TZ]/g, '').slice(0, 17)
  const tail = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '').slice(-8) || 'session'
  return `${stamp}-${tail}`
}

/**
 * Append one JSON line to the recording log. All writes (hot and slow tasks)
 * go through `rec.writeQueue`, so two queues can never interleave a line; the
 * slow *work* stays parallel, only the append is serialized.
 * @param {any} rec
 * @param {any} event
 * @returns {Promise<void>}
 */
function appendEvent(rec, event) {
  const line = JSON.stringify(event) + '\n'
  const write = rec.writeQueue.then(() => appendFile(join(rec.dir, 'events.jsonl'), line, 'utf8'))
  rec.writeQueue = write.catch((error) => {
    rec.lastError = String(error?.message ?? error)
  })
  return write
}

/** Read the recording log; a torn last line after a crash is skipped. */
async function readEvents(dir) {
  let raw = ''
  try {
    raw = await readFile(join(dir, 'events.jsonl'), 'utf8')
  } catch {
    return []
  }
  const out = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // skip a torn tail
    }
  }
  return out
}

/**
 * Serialize writes for one recording. Two independent chains: the hot chain
 * carries report/spans, the slow chain carries attachment extraction and model
 * summaries. The event handler never awaits either.
 * @param {any} rec
 * @param {() => Promise<void>} task
 * @param {boolean} [slow]
 */
function enqueue(rec, task, slow = false) {
  const key = slow ? 'slowQueue' : 'queue'
  rec[key] = rec[key].then(task).catch((error) => {
    rec.lastError = String(error?.message ?? error)
  })
}

/**
 * Give already-fingerprinted records a stable order and a size budget.
 * @param {any[]} rows
 * @returns {{knowledgeSpans: any[], dropped: number}}
 */
function selectKnowledgeSpans(rows) {
  const candidates = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && Array.isArray(row.bi) && Array.isArray(row.tri) && row.length && row.event !== 'inquiry')
    .sort((left, right) => Number(left.seq) - Number(right.seq))
  let kept = candidates
  if (kept.length > MAX_KNOWLEDGE_SPANS) {
    const userSpans = kept.filter((span) => span.author === 'user').slice(-MAX_KNOWLEDGE_SPANS)
    const rest = kept.filter((span) => span.author !== 'user')
    kept = [...userSpans, ...rest.slice(-(MAX_KNOWLEDGE_SPANS - userSpans.length))].sort(
      (left, right) => Number(left.seq) - Number(right.seq)
    )
  }
  const ordered = [...kept].sort((left, right) => {
    const rank = (span) => (span.author === 'user' ? 0 : 1)
    return rank(left) - rank(right) || Number(left.seq) - Number(right.seq)
  })
  let gramBudget = MAX_GRAM_BUDGET
  const knowledgeSpans = []
  for (const span of ordered) {
    const cost = span.bi.length + span.tri.length
    if (cost > gramBudget && knowledgeSpans.length > 0) continue
    gramBudget -= cost
    knowledgeSpans.push({
      span_id: span.span_id,
      turn_id: span.turn_id,
      author: span.author,
      event: span.event,
      seq: span.seq,
      length: span.length,
      bi: span.bi,
      tri: span.tri,
    })
  }
  knowledgeSpans.sort((left, right) => Number(left.seq) - Number(right.seq))
  return { knowledgeSpans, dropped: Math.max(0, candidates.length - knowledgeSpans.length) }
}

/**
 * Fingerprint raw spans (test helper).
 * @param {any[]} spans
 * @returns {{knowledgeSpans: any[], dropped: number}}
 */
function buildKnowledgeSpans(spans) {
  const fingerprinted = (Array.isArray(spans) ? spans : [])
    .filter((span) => span.text && span.text.trim().length >= (span.author === 'user' ? 4 : 8) && span.event !== 'inquiry')
    .map((span) => ({
      span_id: span.span_id,
      turn_id: span.turn_id,
      author: span.author,
      event: span.event,
      seq: span.seq,
      ...fingerprint(span.text),
    }))
  return selectKnowledgeSpans(fingerprinted)
}

/**
 * Create the recording folder for one session and its meta file.
 * @param {any} ctx
 * @param {any} session
 * @returns {Promise<any>}
 */
async function createRecorder(ctx, session) {
  const startedAt = new Date().toISOString()
  const dir = join(recordingBase(cwdOf(ctx, session)), recordingName(startedAt, session.id))
  await mkdir(dir, { recursive: true })
  const meta = {
    version: RECORD_VERSION,
    session_id: String(session.id),
    started_at: startedAt,
    start_seq: Number(session.seq ?? 0),
    status: 'recording',
  }
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  await writeFile(join(dir, 'events.jsonl'), '', 'utf8')
  return {
    sessionId: String(session.id),
    dir,
    startedAt,
    startSeq: meta.start_seq,
    parts: 0,
    chars: 0,
    counts: { user: 0, ai: 0, external: 0, inquiry: 0, attachments: 0, attachmentText: 0 },
    lastError: '',
    queue: Promise.resolve(),
    slowQueue: Promise.resolve(),
    writeQueue: Promise.resolve(),
    writeQueue: Promise.resolve(),
  }
}

/**
 * Rebuild one recording's handle from disk (after a restart). Only counts and
 * paths stay in memory; report text is read from the log at `end`.
 * @param {any} ctx
 * @param {any} session
 * @returns {Promise<any | undefined>}
 */
async function loadOpenRecording(ctx, session) {
  const base = recordingBase(cwdOf(ctx, session))
  let names
  try {
    names = await readdir(base)
  } catch {
    return undefined
  }
  let best
  for (const name of names) {
    const dir = join(base, name)
    try {
      const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
      if (meta.status !== 'recording' || String(meta.session_id) !== String(session.id)) continue
      if (!best || String(meta.started_at) > String(best.meta.started_at)) best = { dir, meta }
    } catch {
      // not a recording folder
    }
  }
  if (!best) return undefined
  const events = await readEvents(best.dir)
  const parts = events.filter((event) => event.type === 'part')
  const spans = events.filter((event) => event.type === 'span')
  const attachments = events.filter((event) => event.type === 'attachment')
  const counts = { user: 0, ai: parts.length, external: 0, inquiry: 0, attachments: attachments.length, attachmentText: 0 }
  for (const span of spans) counts[span.author] = (counts[span.author] ?? 0) + 1
  counts.attachmentText = attachments.filter((row) => row.parsed).length
  const ordered = [...parts].sort((left, right) => Number(left.part) - Number(right.part))
  const chars = ordered.reduce((sum, row, index) => sum + Number(row.length || 0) + (index > 0 ? 2 : 0), 0)
  return {
    sessionId: String(session.id),
    dir: best.dir,
    startedAt: best.meta.started_at,
    startSeq: Number(best.meta.start_seq ?? 0),
    parts: parts.reduce((max, row) => Math.max(max, Number(row.part) || 0), 0),
    chars,
    counts,
    lastError: '',
    queue: Promise.resolve(),
    slowQueue: Promise.resolve(),
    writeQueue: Promise.resolve(),
  }
}

/**
 * Reattach open recordings after a plugin restart.
 * @param {any} ctx
 */
async function rehydrateRecordings(ctx) {
  let sessions = []
  try {
    sessions = ctx.sessions.list()
  } catch {
    return
  }
  for (const session of sessions) {
    if (!session?.header?.cwd) continue
    try {
      const rec = await loadOpenRecording(ctx, session)
      if (rec && !recorders.has(rec.sessionId)) recorders.set(rec.sessionId, rec)
    } catch {
      // ignore a broken folder
    }
  }
}

/**
 * Whether one assistant message looks like a report body rather than status
 * chatter. Used by `/record end` so the handoff does not concatenate the whole
 * chat window into `report_text`.
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeReportBody(text) {
  const value = String(text ?? '').trim()
  if (value.length < 80) return false
  if (/^#{1,6}\s/m.test(value)) return true
  // A trailing "已完成 / 报告见上 / 文件在…" message is not the report.
  if (/^(已|完成|好了|收到|我写|文件|见|下一步|可以|这是|报告已|正文已)/.test(value) && value.length < 600) return false
  return value.length >= 100
}

/**
 * Pick the last assistant message that looks like the report body. Earlier
 * messages stay in the recording log and in `knowledge_spans`, but not in
 * `report_text`; a multi-part report must be frozen from a file.
 * @param {any[]} parts
 * @returns {{row: any, text: string} | undefined}
 */
function selectReportPart(parts) {
  const rows = (Array.isArray(parts) ? parts : [])
    .map((row) => ({ row, text: String(row.text ?? '').trim() }))
    .filter((item) => item.text)
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (looksLikeReportBody(rows[index].text)) return rows[index]
  }
  // Nothing looked like a full report: keep the last non-empty message so a
  // short report is still usable, but the command will warn below.
  return rows.length ? rows[rows.length - 1] : undefined
}

/**
 * Write one handoff from the recording log. It reads `events.jsonl`, not the
 * conversation and not the report buffer.
 * @param {any} ctx
 * @param {any} session
 * @param {any} rec
 * @returns {Promise<{file: string, handoff: any}>}
 */
async function freezeRecording(ctx, session, rec, reportPath) {
  await Promise.all([rec.queue, rec.slowQueue, rec.writeQueue])
  if (rec.lastError) throw new Error(`记录写盘失败：${rec.lastError}`)
  const meta = JSON.parse(await readFile(join(rec.dir, 'meta.json'), 'utf8'))
  const events = await readEvents(rec.dir)
  const parts = events.filter((event) => event.type === 'part').sort((left, right) => Number(left.part) - Number(right.part))
  const gaps = []
  let report = ''
  let reportSource = 'chat'
  const lineage = []
  if (reportPath) {
    // The agent wrote the report to a file instead of the chat. Freeze that
    // file; provenance still comes from the recorded user/attachment spans.
    const absolute = isAbsolute(reportPath) ? reportPath : join(cwdOf(ctx, session), reportPath)
    report = (await readFile(absolute, 'utf8')).trim()
    if (!report) throw new Error(`报告文件是空的：${absolute}`)
    reportSource = 'file'
    lineage.push({ span_id: 'file-1', turn_id: 'm0', author: 'ai', event: 'generated', range: [0, report.length] })
  } else {
    let expected = 1
    for (const row of parts) {
      if (Number(row.part) !== expected) gaps.push(`缺少第 ${expected} 段正文`)
      expected = Number(row.part) + 1
    }
    const selected = selectReportPart(parts)
    if (selected) {
      report = selected.text
      lineage.push({
        span_id: selected.row.span_id,
        turn_id: selected.row.turn_id,
        author: 'ai',
        event: selected.row.event,
        range: [0, report.length],
      })
    }
  }
  if (!report) {
    throw new Error('记录窗口里没有 agent 写的正文：正文在聊天里就 /record end；写进了文件就 /record end <报告文件.md>')
  }
  const attachments = events.filter((event) => event.type === 'attachment')
  for (const row of attachments) {
    if (row.parsed) continue
    gaps.push(`附件 ${row.name} 未解析：${row.reason ?? '未知原因'}`)
  }
  const spanRows = events.filter((event) => event.type === 'span' || event.type === 'part')
  const { knowledgeSpans, dropped: knowledgeSpansDropped } = selectKnowledgeSpans(spanRows)
  const stamp = new Date()
  const idPart = `${stamp.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${String(session.id).slice(-6)}`
  const handoff = {
    handoff_id: `h-${idPart}`,
    report_id: `r-${idPart}`,
    finalized_at: stamp.toISOString(),
    report_text: report,
    report_source: reportSource,
    recorded_by: 'plugin-hook',
    recording: {
      started_at: meta.started_at,
      ended_at: stamp.toISOString(),
      complete: gaps.length === 0,
      gaps,
    },
    lineage,
    ...(reportSource === 'chat' && parts.length > 1
      ? {
          report_selection: {
            parts: parts.length,
            selected_part: lineage[0]?.span_id ?? null,
            note: '默认只取最后一条报告正文；多段报告请用 /record end <文件>',
          },
        }
      : {}),
    knowledge_spans: knowledgeSpans,
    knowledge_spans_dropped: knowledgeSpansDropped,
    retention_index: [],
    dial: 3,
    consent: true,
  }
  const cwd = cwdOf(ctx, session)
  const handoffDir = join(cwd, 'handoff')
  const lineageDir = join(cwd, 'lineage')
  await mkdir(handoffDir, { recursive: true })
  await mkdir(lineageDir, { recursive: true })
  const file = join(handoffDir, `${handoff.handoff_id}.json`)
  await writeFile(file, JSON.stringify(handoff, null, 2), 'utf8')
  await writeFile(
    join(lineageDir, `${session.id}.jsonl`),
    spanRows
      .map((span) =>
        JSON.stringify({
          span_id: span.span_id,
          turn_id: span.turn_id,
          author: span.author,
          event: span.event,
          length: span.length,
          seq: span.seq,
        })
      )
      .join('\n') + '\n',
    'utf8'
  )
  try {
    await writeFile(
      join(rec.dir, 'meta.json'),
      JSON.stringify({ ...meta, status: 'finalized', finalized_at: handoff.finalized_at, handoff_id: handoff.handoff_id }, null, 2),
      'utf8'
    )
  } catch {
    // the handoff is written; a stale meta must not fail the command
  }
  return { file, handoff }
}

/**
 * Read the newest handoff JSON under <cwd>/handoff.
 * @param {string} cwd
 * @returns {Promise<{file: string, handoff: any} | undefined>}
 */
async function readLatestHandoff(cwd) {
  const dir = join(cwd, 'handoff')
  let names
  try {
    names = await readdir(dir)
  } catch {
    return undefined
  }
  const files = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const file = join(dir, name)
    try {
      const info = await stat(file)
      files.push({ file, mtime: info.mtimeMs })
    } catch {
      // ignore a file that disappeared
    }
  }
  files.sort((left, right) => right.mtime - left.mtime)
  for (const entry of files) {
    try {
      const handoff = JSON.parse(await readFile(entry.file, 'utf8'))
      if (handoff && typeof handoff.report_text === 'string') return { file: entry.file, handoff }
    } catch {
      // skip malformed handoff and try the next
    }
  }
  return undefined
}

/**
 * Find the newest handoff across the requested cwd, the profile cwd, and every
 * live session's cwd. The audit tab may not receive the writing session's cwd,
 * so falling back to live session headers keeps the button usable.
 * @param {any} ctx
 * @param {string} requested
 * @returns {Promise<{file: string, handoff: any} | undefined>}
 */
async function readLatestHandoffAnywhere(ctx, requested) {
  const roots = new Set()
  if (requested && isAbsolute(requested)) roots.add(requested)
  const profileCwd = ctx.get('profileContext')?.cwd
  if (profileCwd) roots.add(profileCwd)
  for (const session of ctx.sessions.list()) {
    if (session?.header?.cwd) roots.add(session.header.cwd)
  }
  let best
  for (const root of roots) {
    const found = await readLatestHandoff(root)
    if (!found) continue
    try {
      const info = await stat(found.file)
      if (!best || info.mtimeMs > best.mtime) best = { ...found, mtime: info.mtimeMs }
    } catch {
      // ignore
    }
  }
  return best ? { file: best.file, handoff: best.handoff } : undefined
}

/**
 * Register the two manual ASCII commands and the passive event subscriber.
 * `/record start|status|end` is the v1.9 `/记`; `/audit` is the v1.9 `/审计`.
 * @param {any} ctx
 */
function registerCommands(ctx) {
  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'record',
        description: '理解审计员记录器（v1.9 /记）：start / status / end，只写工作区里的记录文件夹，不改报告',
        input: { hint: 'start | status | end [报告文件]' },
        handler: async ({ agent, rawInput }) => {
          const raw = String(rawInput ?? '').trim()
          const [verb, ...rest] = raw.split(/\s+/)
          const action = String(verb ?? '').toLowerCase()
          const argument = rest.join(' ').trim()
          const sessionId = String(agent.id)
          const session = ctx.sessions.get(sessionId)
          if (!session) return { kind: 'error', text: `找不到写作会话 ${sessionId}` }
          if (action === 'start') {
            if (recorders.has(sessionId)) {
              const active = recorders.get(sessionId)
              return { kind: 'error', text: `已经在记录中（开始于 ${active.startedAt}）。先 /record end 再开新一轮。` }
            }
            const existing = await loadOpenRecording(ctx, session)
            if (existing) {
              recorders.set(sessionId, existing)
              return {
                kind: 'error',
                text: `已有一个未结束的记录（开始于 ${existing.startedAt}）：${existing.dir}\n先 /record end，或把它当本轮记录继续写。`,
              }
            }
            const rec = await createRecorder(ctx, session)
            recorders.set(sessionId, rec)
            return {
              kind: 'success',
              text: `● 记录中\n开始：${rec.startedAt}\n记录目录：${rec.dir}\n之前写的内容不追溯，审计时按 unknown 处理。\n结束：/record end`,
            }
          }
          if (action === 'status') {
            let rec = recorders.get(sessionId)
            if (!rec) {
              rec = await loadOpenRecording(ctx, session)
              if (rec) recorders.set(sessionId, rec)
            }
            if (!rec) return { kind: 'success', text: '当前没有记录窗口。开始：/record start' }
            const counts = rec.counts ?? {}
            return {
              kind: 'success',
              text: `● 记录中\n开始：${rec.startedAt}\n已记录 ${(counts.user ?? 0) + (counts.ai ?? 0) + (counts.external ?? 0)} 段（user ${counts.user ?? 0} / ai ${counts.ai ?? 0} / external ${counts.external ?? 0}；其中提问 ${counts.inquiry ?? 0} 段不计来源）\n附件 ${counts.attachments ?? 0} 个（已解析 ${counts.attachmentText ?? 0}）\n报告已累计 ${rec.chars} 字（${rec.parts} 段正文）\n记录目录：${rec.dir}\n结束：/record end`,
            }
          }
          if (action === 'end') {
            let rec = recorders.get(sessionId)
            if (!rec) rec = await loadOpenRecording(ctx, session)
            if (!rec) return { kind: 'error', text: '当前没有记录窗口。先 /record start。' }
            try {
              const { file, handoff } = await freezeRecording(ctx, session, rec, argument || undefined)
              recorders.delete(sessionId)
              return {
                kind: 'success',
                text: `■ 已冻结\nhandoff：${handoff.handoff_id}\n文件：${file}\n报告 ${handoff.report_text.length} 字（${handoff.report_source === 'file' ? '来自报告文件' : `${handoff.lineage.length} 段聊天正文`}）\n记录目录：${rec.dir}\n下一步：/audit`,
              }
            } catch (error) {
              return { kind: 'error', text: `冻结失败：${String(error.message ?? error)}` }
            }
          }
          return { kind: 'error', text: '用法：/record start | status | end' }
        },
      }),
    'understanding-auditor: /record'
  )
  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'audit',
        description: '理解审计员 /审计：读取最近冻结的 handoff，打开右上角“审计”面板开始提问',
        input: { hint: '[可留空]' },
        handler: async ({ agent }) => {
          const sessionId = String(agent.id)
          const session = ctx.sessions.get(sessionId)
          const cwd = cwdOf(ctx, session)
          const latest = await readLatestHandoff(cwd)
          if (!latest) {
            return { kind: 'error', text: `没有找到 handoff（${join(cwd, 'handoff')}）。先在写作会话执行 /record start → /record end。` }
          }
          const { handoff, file } = latest
          const complete = handoff.recording?.complete === true
          return {
            kind: 'success',
            text: `最近 handoff：${handoff.handoff_id}\n记录：${complete ? '完整' : '不完整（没有 /record end）'}\n报告：${String(handoff.report_text ?? '').length} 字；lineage：${handoff.lineage?.length ?? 0} 段\n文件：${file}\n下一步：点右上角“◍ 审计”，在面板里点“载入最近 handoff”。`,
          }
        },
      }),
    'understanding-auditor: /audit'
  )
  ctx.effect(
    () =>
      ctx.on('session/event', (session, event) => {
        const rec = recorders.get(String(session.id))
        if (!rec) return
        const seq = Number(event.seq)
        if (seq <= rec.startSeq) return
        const data = event.data
        if (event.type === 'user/message') {
          if (data?.source?.kind !== 'user') return
          const text = contentText(data.content)
          if (text && !isInstruction(text)) {
            if (isInquiry(text)) {
              rec.counts.inquiry = (rec.counts.inquiry ?? 0) + 1
            } else {
              const kind = text.includes('\n') || text.length > 120 ? 'pasted' : 'typed'
              rec.counts.user = (rec.counts.user ?? 0) + 1
              // Hot path: one append, hashing included in the write task.
              enqueue(rec, () =>
                appendEvent(rec, {
                  type: 'span',
                  span_id: `s${seq}`,
                  turn_id: `m${seq}`,
                  author: 'user',
                  event: kind,
                  seq,
                  length: text.length,
                  ...fingerprint(text),
                })
              )
            }
          }
          // Attachments go to the slow queue: PDF extraction and the optional
          // model summary can take seconds and must not hold up the next
          // assistant message.
          const blocks = Array.isArray(data?.content) ? data.content : []
          blocks.forEach((block, index) => {
            if (!block || (block.type !== 'file' && block.type !== 'image') || !block.attachment) return
            const ref = block.attachment
            const name = String(ref.name || `附件${index + 1}`)
            rec.counts.attachments = (rec.counts.attachments ?? 0) + 1
            if (block.type === 'image') {
              enqueue(
                rec,
                () =>
                  appendEvent(rec, {
                    type: 'attachment',
                    span_id: `s${seq}-a${index}`,
                    name,
                    seq,
                    parsed: false,
                    reason: '图片没有 OCR，未解析',
                  }),
                true
              )
              return
            }
            enqueue(
              rec,
              async () => {
                let result
                try {
                  const bytes = await readAttachmentBytes(ctx, ref)
                  result = await extractAttachmentText({ name, bytes })
                } catch (error) {
                  result = { ok: false, reason: String(error?.message ?? error) }
                }
                const parsed = Boolean(result.ok && result.text.trim())
                const summary = parsed
                  ? await summarizeAttachment(ctx, name, result.text)
                  : { status: 'skipped', summary: '', concepts: [], reason: result.reason }
                await appendEvent(rec, {
                  type: 'attachment',
                  span_id: `s${seq}-a${index}`,
                  name,
                  seq,
                  parsed,
                  chars: parsed ? result.text.length : 0,
                  ...(parsed
                    ? {
                        summary_status: summary.status,
                        summary: summary.summary,
                        concept_count: summary.concepts.length,
                        ...(summary.status === 'ok' ? {} : { summary_reason: summary.reason }),
                      }
                    : { reason: result.reason }),
                })
                if (!parsed) return
                rec.counts.attachmentText = (rec.counts.attachmentText ?? 0) + 1
                await appendEvent(rec, {
                  type: 'span',
                  span_id: `s${seq}-a${index}`,
                  turn_id: `m${seq}`,
                  author: 'user',
                  event: 'attachment',
                  seq,
                  length: result.text.length,
                  ...fingerprint(result.text),
                })
                for (const [conceptIndex, concept] of summary.concepts.entries()) {
                  await appendEvent(rec, {
                    type: 'span',
                    span_id: `s${seq}-a${index}-c${conceptIndex}`,
                    turn_id: `m${seq}`,
                    author: 'user',
                    event: 'attachment',
                    seq,
                    length: concept.quote.length,
                    ...fingerprint(concept.quote),
                  })
                }
              },
              true
            )
          })
          return
        }
        if (event.type === 'assistant/message') {
          const text = contentText(data?.message?.content)
          if (!text) return
          rec.parts += 1
          const part = rec.parts
          rec.chars += text.length + (part > 1 ? 2 : 0)
          rec.counts.ai = (rec.counts.ai ?? 0) + 1
          // One JSONL line carries the text and its hashes: the append itself
          // is the stream; there is no second pass over the message.
          enqueue(rec, () =>
            appendEvent(rec, {
              type: 'part',
              span_id: `s${seq}`,
              turn_id: `m${seq}`,
              author: 'ai',
              event: 'generated',
              part,
              seq,
              length: text.length,
              text,
              ...fingerprint(text),
            })
          )
          return
        }
        if (event.type === 'tool/result') {
          const text = contentText(data?.message?.content)
          if (!text) return
          rec.counts.external = (rec.counts.external ?? 0) + 1
          enqueue(rec, () =>
            appendEvent(rec, {
              type: 'span',
              span_id: `s${seq}`,
              turn_id: `m${seq}`,
              author: 'external',
              event: 'generated',
              seq,
              length: text.length,
              ...fingerprint(text),
            })
          )
        }
      }),
    'understanding-auditor: lineage subscriber'
  )
}

export function apply(ctx) {
  registerCommands(ctx)
  void rehydrateRecordings(ctx)
  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      const url = new URL(String(req.url), 'http://localhost')
      const path = url.pathname.slice(ROUTE_PREFIX.length) || '/'
      try {
        if (path === '/health' && req.method === 'GET') {
          let info
          try {
            info = await route(ctx)
          } catch (error) {
            sendJson(res, 200, { ok: false, version: '1.9.8', error: String(error.message ?? error) })
            return
          }
          sendJson(res, 200, { ok: true, version: '1.9.8', provider: info.provider, model: info.model, reasoningEffort: info.reasoningEffort })
          return
        }
        if (path === '/models' && req.method === 'GET') {
          const providers = ctx.llm.listProviders()
          const models = []
          for (const provider of providers) {
            for (const model of await ctx.llm.listModels(provider.id)) {
              let info = null
              try {
                info = await ctx.llm.resolveModelInfo(provider.id, model.id)
              } catch {
                info = null
              }
              models.push({ provider: provider.id, id: model.id, name: model.name, reasoning: info?.reasoning ?? null })
            }
          }
          sendJson(res, 200, { ok: true, models })
          return
        }
        if (path === '/demo' && req.method === 'GET') {
          sendJson(res, 200, { ok: true, demo: demoPayload(3), demo_report: DEMO_REPORT, demo_index: DEMO_INDEX })
          return
        }
        if (path === '/handoff/latest' && req.method === 'GET') {
          const cwd = url.searchParams.get('cwd') || ctx.get('profileContext')?.cwd || process.cwd()
          const latest = await readLatestHandoffAnywhere(ctx, cwd)
          if (!latest) {
            sendJson(res, 404, { ok: false, error: `没有找到 handoff（已查找 ${cwd} 与当前会话工作区）` })
            return
          }
          sendJson(res, 200, { ok: true, file: latest.file, handoff: latest.handoff })
          return
        }
        if (path === '/dag/get' && req.method === 'GET') {
          const cwd = url.searchParams.get('cwd') || ctx.get('profileContext')?.cwd || process.cwd()
          const found = await loadDag(ctx, cwd, url.searchParams.get('report_id') || '')
          if (!found) {
            sendJson(res, 404, { ok: false, error: '这份报告还没有保存的 DAG' })
            return
          }
          sendJson(res, 200, { ok: true, ...found })
          return
        }
        if (path === '/state/latest' && req.method === 'GET') {
          const cwd = url.searchParams.get('cwd') || ctx.get('profileContext')?.cwd || process.cwd()
          const latest = await readLatestAuditState(ctx, cwd)
          if (!latest) {
            sendJson(res, 404, { ok: false, error: '没有可恢复的审计状态' })
            return
          }
          sendJson(res, 200, { ok: true, ...latest })
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        const body = await readJson(req)
        const dial = Math.max(1, Math.min(5, Math.round(Number(body.dial) || 3)))
        if (path === '/debug') {
          const info = await route(ctx)
          const types = {}
          let text = ''
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 180_000)
          try {
            for await (const chunk of ctx.llm.stream({
              provider: info.provider,
              model: info.model,
              ...(info.reasoningEffort ? { reasoningEffort: info.reasoningEffort } : {}),
              system: '只输出 JSON：{"ok":true}',
              messages: [{ role: 'user', content: [{ type: 'text', text: '请只输出这个 JSON。' }] }],
              temperature: 0,
              maxTokens: 2048,
              signal: controller.signal,
            })) {
              types[chunk.type] = (types[chunk.type] ?? 0) + 1
              if (chunk.type === 'text-delta') text += chunk.text
              if (chunk.type === 'block-end' && chunk.block?.type === 'text') text += chunk.block.text
              if (chunk.type === 'finish') types.finishReason = chunk.reason
            }
          } finally {
            clearTimeout(timer)
          }
          sendJson(res, 200, { ok: true, info, types, text: text.slice(0, 2000) })
          return
        }
        if (path === '/start') {
          sendJson(res, 200, { ok: true, ...(await start(ctx, { ...body, dial })) })
          return
        }
        if (path === '/judge') {
          const answer = String(body.answer ?? '').trim()
          if (!answer) throw Object.assign(new Error('回答为空：请写一句，或点“不会，先跳过”'), { statusCode: 422 })
          if (/^(不确定|不知道|不清楚|不会|说不清|没印象)$/.test(answer)) {
            sendJson(res, 200, {
              ok: true,
              judgment: {
                mode: 'judge',
                question_id: body.question?.id,
                verdict: 'unsure',
                hit_points: [],
                miss_points: ['用户回答“不确定”'],
                conflict: false,
                evidence: `用户原话：“${answer}”`,
                confidence: 1,
                needs_review: false,
                reread: [],
                disclaimer: '这是对这道题回答的判定，不是对报告的评分。',
              },
            })
            return
          }
          sendJson(res, 200, { ok: true, judgment: await judge(ctx, body.question, answer, dial, body.followup_used) })
          return
        }
        if (path === '/upgrade' || path === '/spot' || path === '/variant') {
          const mode = path.slice(1)
          const raw = await stage(ctx, 'p2', {
            graph: body.graph,
            entry_ids: [body.entry_id ?? body.target?.entry_id].filter(Boolean),
            budget: [
              {
                component_id: body.component_id,
                entry_id: body.entry_id ?? body.target?.entry_id,
                tier: mode === 'variant' ? body.tier ?? 'normal' : 'normal',
                count: mode === 'upgrade' ? 2 : 1,
                reason: mode === 'upgrade' ? '简单档未过关，沿 parents 补 2 题' : mode === 'spot' ? '抽查' : '补全后的变式题',
              },
            ],
            dial,
            mode,
            asked: Array.isArray(body.asked) ? body.asked : [],
            target: body.target ?? null,
            variant_of: body.variant_of ?? null,
          })
          let questions = normalizeQuestions(raw, body.graph, String(body.report_text ?? ''), { mode, dial })
          if (mode === 'variant' && body.original_quote) {
            questions = questions.filter((q) => q.quote !== body.original_quote)
          }
          if (!questions.length) {
            const nodeId = body.target?.node_id ?? body.entry_id
            if (body.graph?.nodes?.[nodeId]?.assumed_known) {
              sendJson(res, 200, { ok: true, questions: [] })
              return
            }
            questions = [fallbackQuestion(body.graph, nodeId, body.entry_id ?? nodeId, body.tier ?? 'normal', String(body.report_text ?? ''), dial, 0, body.original_quote)]
          }
          questions = questions.slice(0, mode === 'upgrade' ? 2 : 1).map((q, i) => ({
            ...q,
            id: `${mode === 'upgrade' ? 'U' : mode === 'spot' ? 'S' : 'V'}${i + 1}`,
            mode,
            variant_of: mode === 'variant' ? body.variant_of ?? null : null,
            spot_check: mode === 'spot',
          }))
          sendJson(res, 200, { ok: true, questions })
          return
        }
        if (path === '/micro') {
          const result = await stage(ctx, 'p3', {
            mode: 'micro_explain',
            node_id: body.node_id,
            quote: body.quote,
            source_span: body.source_span ?? '',
            report_text: body.report_text ?? '',
          })
          sendJson(res, 200, {
            ok: true,
            card: {
              mode: 'micro_explain',
              node_id: body.node_id,
              source_quote: String(result.source_quote ?? body.quote ?? ''),
              source_span: String(result.source_span ?? ''),
              micro: String(result.micro ?? '报告没有展开这一点。'),
              grounded: Boolean(result.grounded),
            },
          })
          return
        }
        if (path === '/refill-check') {
          const result = await stage(ctx, 'p3', {
            mode: 'refill_check',
            node_id: body.node_id,
            quote: body.quote,
            refill_text: body.refill_text,
          })
          sendJson(res, 200, {
            ok: true,
            check: {
              mode: 'refill_check',
              node_id: body.node_id,
              is_own_words: Boolean(result.is_own_words),
              on_topic: Boolean(result.on_topic),
              note: String(result.note ?? ''),
            },
          })
          return
        }
        if (path === '/export') {
          sendJson(res, 200, { ok: true, ...exportAudit(body) })
          return
        }
        if (path === '/save') {
          sendJson(res, 200, { ok: true, ...(await saveAudit(ctx, body)) })
          return
        }
        if (path === '/state/save') {
          sendJson(res, 200, { ok: true, ...(await saveAuditState(ctx, body)) })
          return
        }
        if (path === '/dag/save') {
          sendJson(res, 200, { ok: true, ...(await saveDag(ctx, body)) })
          return
        }
        sendJson(res, 404, { ok: false, error: 'unknown route' })
      } catch (error) {
        ctx.logger?.warn?.(`understanding-auditor: ${error}`)
        sendJson(res, error.statusCode ?? 500, {
          ok: false,
          error: String(error.message ?? error),
          code: error.code,
          raw: error.raw,
        })
      }
    },
  })
  ctx.effect(() => dispose, 'understanding-auditor: http routes')
}

/**
 * Test-only handles. The plugin entry (`apply`) is the production surface;
 * these let `tests/unit.mjs` exercise provenance and export without a Host or
 * a model call.
 */
export const __test = {
  normalizeForMatch,
  fingerprint,
  makeSpanMatcher,
  applyLineageProvenance,
  resolveHandoffInput,
  buildKnowledgeSpans,
  selectKnowledgeSpans,
  validateAttachmentSummary,
  looksLikeReportBody,
  selectReportPart,
  saveAuditState,
  readLatestAuditState,
  reportDigest,
  saveDag,
  loadDag,
  markAssumedKnown,
  loadOpenRecording,
  exportAudit,
  isInquiry,
  isInstruction,
}
