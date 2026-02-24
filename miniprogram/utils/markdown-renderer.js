// miniprogram/utils/markdown-renderer.js
// Markdown renderer for WeChat Mini Program.
// Primary parser: markdown-it (npm dependency)
// Fallback parser: lightweight built-in parser to avoid runtime crash if npm not built.

let markdownItInstance = null
let markdownItLoadError = ''
let warnedMissingMarkdownIt = false

try {
  const MarkdownIt = require('markdown-it')
  markdownItInstance = new MarkdownIt({
    html: false,
    xhtmlOut: false,
    breaks: true,
    linkify: true,
    typographer: false
  })
} catch (err) {
  markdownItLoadError = err && err.message ? err.message : String(err || 'unknown')
}

function toSafeText(value) {
  return typeof value === 'string' ? value : ''
}

function createBlockFactory() {
  let seed = 0
  return function createBlock(type, extra) {
    seed += 1
    return Object.assign({ id: `md-${seed}`, type }, extra || {})
  }
}

function pushSegment(segments, type, text, extra) {
  const content = toSafeText(text)
  if (!content) return

  const patch = Object.assign({ type, text: content }, extra || {})
  const last = segments.length > 0 ? segments[segments.length - 1] : null

  if (
    last &&
    last.type === patch.type &&
    (last.url || '') === (patch.url || '')
  ) {
    last.text += patch.text
    return
  }

  segments.push(patch)
}

function normalizeInlineType(state) {
  if (state.linkUrl) return 'link'
  if (state.strong) return 'strong'
  if (state.em) return 'em'
  return 'text'
}

function parseInlineChildren(children) {
  const tokens = Array.isArray(children) ? children : []
  const segments = []
  const state = {
    strong: false,
    em: false,
    linkUrl: ''
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    const tokenType = toSafeText(token && token.type)

    if (tokenType === 'strong_open') {
      state.strong = true
      continue
    }
    if (tokenType === 'strong_close') {
      state.strong = false
      continue
    }
    if (tokenType === 'em_open') {
      state.em = true
      continue
    }
    if (tokenType === 'em_close') {
      state.em = false
      continue
    }
    if (tokenType === 'link_open') {
      state.linkUrl = typeof token.attrGet === 'function' ? (token.attrGet('href') || '') : ''
      continue
    }
    if (tokenType === 'link_close') {
      state.linkUrl = ''
      continue
    }
    if (tokenType === 'code_inline') {
      pushSegment(segments, 'code', token.content || '')
      continue
    }
    if (tokenType === 'text') {
      const inlineType = normalizeInlineType(state)
      const extra = inlineType === 'link' && state.linkUrl ? { url: state.linkUrl } : null
      pushSegment(segments, inlineType, token.content || '', extra)
      continue
    }
    if (tokenType === 'softbreak' || tokenType === 'hardbreak') {
      const inlineType = normalizeInlineType(state)
      const extra = inlineType === 'link' && state.linkUrl ? { url: state.linkUrl } : null
      pushSegment(segments, inlineType, '\n', extra)
      continue
    }
    if (tokenType === 'html_inline') {
      pushSegment(segments, 'text', token.content || '')
    }
  }

  return segments
}

function inlineTokenToSegments(token) {
  const input = token && typeof token === 'object' ? token : {}
  const children = Array.isArray(input.children) ? input.children : []
  if (children.length > 0) return parseInlineChildren(children)

  const text = toSafeText(input.content)
  return text ? [{ type: 'text', text }] : []
}

function appendSegments(target, source, withLineBreak) {
  const list = Array.isArray(source) ? source : []
  if (list.length === 0) return
  if (withLineBreak && target.length > 0) {
    pushSegment(target, 'text', '\n')
  }
  list.forEach((seg) => {
    if (!seg || typeof seg !== 'object') return
    pushSegment(target, seg.type || 'text', seg.text || '', seg.url ? { url: seg.url } : null)
  })
}

function parseAlignment(token) {
  if (!token || typeof token !== 'object') return 'left'
  const style = typeof token.attrGet === 'function' ? (token.attrGet('style') || '') : ''
  const alignAttr = typeof token.attrGet === 'function' ? (token.attrGet('align') || '') : ''
  const source = `${style} ${alignAttr}`.toLowerCase()
  if (source.indexOf('center') >= 0) return 'center'
  if (source.indexOf('right') >= 0) return 'right'
  return 'left'
}

function parseListFromTokens(tokens, startIndex, createBlock) {
  const listOpen = tokens[startIndex]
  const ordered = listOpen && listOpen.type === 'ordered_list_open'
  const startNo = ordered && typeof listOpen.attrGet === 'function'
    ? Number.parseInt(listOpen.attrGet('start') || '1', 10)
    : 1
  let nextIndex = startIndex + 1
  let orderCounter = Number.isFinite(startNo) ? startNo : 1
  const items = []

  while (nextIndex < tokens.length) {
    const token = tokens[nextIndex]
    const tokenType = toSafeText(token && token.type)

    if (tokenType === (ordered ? 'ordered_list_close' : 'bullet_list_close')) {
      nextIndex += 1
      break
    }

    if (tokenType !== 'list_item_open') {
      nextIndex += 1
      continue
    }

    nextIndex += 1
    const itemSegments = []
    while (nextIndex < tokens.length) {
      const inner = tokens[nextIndex]
      const innerType = toSafeText(inner && inner.type)
      if (innerType === 'list_item_close') {
        nextIndex += 1
        break
      }
      if (innerType === 'inline') {
        appendSegments(itemSegments, inlineTokenToSegments(inner), itemSegments.length > 0)
      }
      nextIndex += 1
    }

    items.push({
      id: `item-${items.length + 1}`,
      marker: ordered ? `${orderCounter}.` : '•',
      segments: itemSegments
    })
    if (ordered) orderCounter += 1
  }

  return {
    block: createBlock('list', { ordered, items }),
    nextIndex
  }
}

function parseBlockquoteFromTokens(tokens, startIndex, createBlock) {
  let nextIndex = startIndex + 1
  const segments = []

  while (nextIndex < tokens.length) {
    const token = tokens[nextIndex]
    const tokenType = toSafeText(token && token.type)
    if (tokenType === 'blockquote_close') {
      nextIndex += 1
      break
    }
    if (tokenType === 'inline') {
      appendSegments(segments, inlineTokenToSegments(token), segments.length > 0)
    }
    nextIndex += 1
  }

  return {
    block: createBlock('blockquote', { segments }),
    nextIndex
  }
}

function parseTableFromTokens(tokens, startIndex, createBlock) {
  let nextIndex = startIndex + 1
  const header = []
  const rows = []
  let currentCells = null
  let inHead = false

  while (nextIndex < tokens.length) {
    const token = tokens[nextIndex]
    const tokenType = toSafeText(token && token.type)

    if (tokenType === 'table_close') {
      nextIndex += 1
      break
    }
    if (tokenType === 'thead_open') {
      inHead = true
      nextIndex += 1
      continue
    }
    if (tokenType === 'thead_close') {
      inHead = false
      nextIndex += 1
      continue
    }
    if (tokenType === 'tr_open') {
      currentCells = []
      nextIndex += 1
      continue
    }
    if (tokenType === 'tr_close') {
      if (currentCells) {
        if (inHead || header.length === 0) {
          for (let i = 0; i < currentCells.length; i += 1) {
            header.push(currentCells[i])
          }
        } else {
          rows.push({
            id: `row-${rows.length + 1}`,
            cells: currentCells
          })
        }
      }
      currentCells = null
      nextIndex += 1
      continue
    }

    if (tokenType === 'th_open' || tokenType === 'td_open') {
      const closeType = tokenType === 'th_open' ? 'th_close' : 'td_close'
      const align = parseAlignment(token)
      const segments = []
      nextIndex += 1

      while (nextIndex < tokens.length) {
        const cellToken = tokens[nextIndex]
        const cellType = toSafeText(cellToken && cellToken.type)
        if (cellType === closeType) {
          nextIndex += 1
          break
        }
        if (cellType === 'inline') {
          appendSegments(segments, inlineTokenToSegments(cellToken), segments.length > 0)
        }
        nextIndex += 1
      }

      if (currentCells) {
        currentCells.push({
          id: `cell-${currentCells.length + 1}`,
          align,
          segments
        })
      }
      continue
    }

    nextIndex += 1
  }

  return {
    block: createBlock('table', {
      header,
      rows,
      columnCount: Math.max(header.length, rows.length > 0 ? rows[0].cells.length : 0)
    }),
    nextIndex
  }
}

function parseByMarkdownIt(source) {
  const createBlock = createBlockFactory()
  const tokens = markdownItInstance.parse(source, {})
  const blocks = []
  let index = 0

  while (index < tokens.length) {
    const token = tokens[index]
    const tokenType = toSafeText(token && token.type)

    if (tokenType === 'heading_open') {
      const inlineToken = tokens[index + 1]
      const level = Number.parseInt(toSafeText(token.tag).replace('h', ''), 10)
      blocks.push(createBlock('heading', {
        level: Number.isFinite(level) ? level : 1,
        segments: inlineTokenToSegments(inlineToken)
      }))
      index += 3
      continue
    }

    if (tokenType === 'paragraph_open') {
      const inlineToken = tokens[index + 1]
      blocks.push(createBlock('paragraph', {
        segments: inlineTokenToSegments(inlineToken)
      }))
      index += 3
      continue
    }

    if (tokenType === 'bullet_list_open' || tokenType === 'ordered_list_open') {
      const listResult = parseListFromTokens(tokens, index, createBlock)
      blocks.push(listResult.block)
      index = listResult.nextIndex
      continue
    }

    if (tokenType === 'blockquote_open') {
      const quoteResult = parseBlockquoteFromTokens(tokens, index, createBlock)
      blocks.push(quoteResult.block)
      index = quoteResult.nextIndex
      continue
    }

    if (tokenType === 'table_open') {
      const tableResult = parseTableFromTokens(tokens, index, createBlock)
      blocks.push(tableResult.block)
      index = tableResult.nextIndex
      continue
    }

    if (tokenType === 'fence' || tokenType === 'code_block') {
      const language = toSafeText(token.info).trim().split(/\s+/)[0] || ''
      blocks.push(createBlock('code', {
        language,
        code: toSafeText(token.content)
      }))
      index += 1
      continue
    }

    if (tokenType === 'hr') {
      blocks.push(createBlock('hr'))
      index += 1
      continue
    }

    if (tokenType === 'inline') {
      const segments = inlineTokenToSegments(token)
      if (segments.length > 0) {
        blocks.push(createBlock('paragraph', { segments }))
      }
      index += 1
      continue
    }

    index += 1
  }

  return blocks
}

function parseInlineByRegex(text) {
  const input = toSafeText(text)
  if (!input) return []

  const tokenRegex = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*|_([^_]+)_)/g
  const segments = []
  let cursor = 0
  let match

  while ((match = tokenRegex.exec(input)) !== null) {
    if (match.index > cursor) {
      segments.push({ type: 'text', text: input.slice(cursor, match.index) })
    }

    if (match[2] && match[3]) {
      segments.push({ type: 'link', text: match[2], url: match[3] })
    } else if (match[4]) {
      segments.push({ type: 'strong', text: match[4] })
    } else if (match[5]) {
      segments.push({ type: 'code', text: match[5] })
    } else if (match[6] || match[7]) {
      segments.push({ type: 'em', text: match[6] || match[7] })
    }
    cursor = match.index + match[0].length
  }

  if (cursor < input.length) {
    segments.push({ type: 'text', text: input.slice(cursor) })
  }
  return segments
}

function parseByFallback(source) {
  const createBlock = createBlockFactory()
  const lines = toSafeText(source).replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  const paragraph = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push(createBlock('paragraph', {
      segments: parseInlineByRegex(paragraph.join('\n'))
    }))
    paragraph.length = 0
  }

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]
    const line = raw.trim()
    if (!line) {
      flushParagraph()
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      blocks.push(createBlock('heading', {
        level: heading[1].length,
        segments: parseInlineByRegex(heading[2])
      }))
      continue
    }

    paragraph.push(raw)
  }

  flushParagraph()
  return blocks
}

function renderMarkdownToBlocks(markdownText) {
  const source = toSafeText(markdownText)
  if (!source.trim()) return []

  if (markdownItInstance) {
    try {
      return parseByMarkdownIt(source)
    } catch (err) {
      console.warn('[markdown-renderer] markdown-it parse failed, fallback parser used', err)
      return parseByFallback(source)
    }
  }

  if (!warnedMissingMarkdownIt) {
    warnedMissingMarkdownIt = true
    console.warn('[markdown-renderer] markdown-it not available, fallback parser used:', markdownItLoadError)
  }
  return parseByFallback(source)
}

module.exports = {
  renderMarkdownToBlocks
}
