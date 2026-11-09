/**
 * Attachment text extraction for `/record`.
 *
 * Only two things are needed from an attachment: words that can be fingerprinted
 * as user-supplied material. PDFs go through pdfjs-dist when it is installed
 * (optional dependency); plain text files are read directly. Everything else,
 * including images, is reported as "unparsed" so the handoff can mark the
 * recording incomplete instead of silently treating the material as AI.
 */
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

export const MAX_ATTACHMENT_CHARS = 60_000
const MAX_PDF_PAGES = 200

let pdfjsPromise

/**
 * Load pdfjs-dist lazily. It is an optional dependency: a missing install is a
 * normal state, not a plugin failure.
 * @returns {Promise<any | null>}
 */
async function loadPdfjs() {
  if (pdfjsPromise === undefined) {
    pdfjsPromise = (async () => {
      for (const specifier of ['pdfjs-dist/legacy/build/pdf.mjs', 'pdfjs-dist']) {
        try {
          return await import(specifier)
        } catch {
          // try the next specifier
        }
      }
      return null
    })()
  }
  return pdfjsPromise
}

/**
 * Extract text from PDF bytes with pdfjs-dist.
 * @param {Uint8Array} bytes
 * @returns {Promise<{ok: true, text: string, pages: number} | {ok: false, reason: string}>}
 */
export async function extractPdfText(bytes) {
  const pdfjs = await loadPdfjs()
  if (!pdfjs) {
    return { ok: false, reason: '没有安装 pdfjs-dist（在插件目录执行 npm i pdfjs-dist）' }
  }
  let document
  try {
    const data = new Uint8Array(bytes)
    document = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise
  } catch (error) {
    return { ok: false, reason: `PDF 打不开：${String(error?.message ?? error)}` }
  }
  const pages = Math.min(document.numPages, MAX_PDF_PAGES)
  const parts = []
  let length = 0
  for (let index = 1; index <= pages; index += 1) {
    try {
      const page = await document.getPage(index)
      const content = await page.getTextContent()
      const text = content.items.map((item) => (typeof item?.str === 'string' ? item.str : '')).join(' ')
      parts.push(text)
      length += text.length
    } catch {
      // skip a page that fails to render; the rest may still be usable
    }
    if (length >= MAX_ATTACHMENT_CHARS) break
  }
  const text = parts.join('\n').slice(0, MAX_ATTACHMENT_CHARS).trim()
  if (!text) return { ok: false, reason: 'PDF 没有可提取的文字（可能是扫描件）' }
  return { ok: true, text, pages: document.numPages }
}

/**
 * Extract fingerprintable text from one attachment.
 * @param {{name?: string, path?: string, bytes?: Uint8Array}} input
 * @returns {Promise<{ok: true, text: string, pages?: number} | {ok: false, reason: string}>}
 */
export async function extractAttachmentText(input) {
  const name = String(input?.name ?? input?.path ?? '')
  const extension = extname(name).toLowerCase()
  try {
    if (extension === '.pdf') {
      const bytes = input.bytes ?? (await readFile(input.path))
      return await extractPdfText(bytes)
    }
    if (['.txt', '.md', '.markdown', '.csv', '.json', '.html', '.htm'].includes(extension)) {
      const text = input.bytes ? Buffer.from(input.bytes).toString('utf8') : await readFile(input.path, 'utf8')
      const clipped = text.slice(0, MAX_ATTACHMENT_CHARS).trim()
      if (!clipped) return { ok: false, reason: '文件是空的' }
      return { ok: true, text: clipped }
    }
    return { ok: false, reason: `暂不解析 ${extension || '这种'} 格式` }
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) }
  }
}
