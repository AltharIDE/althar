import { Schema } from 'effect'

/*
 * Jira's text, to Markdown and back. Jira Cloud writes descriptions and
 * comments in the Atlassian Document Format (ADF), a tree of JSON nodes;
 * Jira Data Center in wiki markup. The model's text is Markdown, so an issue
 * is read into it from either, and a comment is written in whichever the
 * edition takes. Each covers what issues and Althar's comments hold:
 * paragraphs, headings, emphasis, code, links, lists, quotes, rules, tables
 * and mentions. Anything else keeps its text.
 */

// ---- The Atlassian Document Format ---------------------------------------

export interface AdfMark {
  readonly type: string
  readonly attrs?: { readonly [key: string]: unknown } | undefined
}

/** A node of an ADF document: the document itself, a block, or a run of text. */
export interface AdfNode {
  readonly type: string
  readonly text?: string | undefined
  readonly attrs?: { readonly [key: string]: unknown } | undefined
  readonly marks?: ReadonlyArray<AdfMark> | undefined
  readonly content?: ReadonlyArray<AdfNode> | undefined
}

const Attrs = Schema.Record(Schema.String, Schema.Unknown)

export const AdfNode: Schema.Codec<AdfNode> = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
  attrs: Schema.optional(Attrs),
  marks: Schema.optional(Schema.Array(Schema.Struct({ type: Schema.String, attrs: Schema.optional(Attrs) }))),
  content: Schema.optional(Schema.Array(Schema.suspend((): Schema.Codec<AdfNode> => AdfNode))),
})

/** A document as Jira takes one. */
export interface AdfDoc {
  readonly type: 'doc'
  readonly version: 1
  readonly content: ReadonlyArray<AdfNode>
}

// ---- Markdown, as written here --------------------------------------------

/** A code span, fenced by more backticks than the code holds in a row. */
const codeSpan = (code: string) => {
  const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((run) => run[0].length))
  const fence = '`'.repeat(longest + 1)
  return longest === 0 ? `${fence}${code}${fence}` : `${fence} ${code} ${fence}`
}

/** A fenced code block, with its language when it has one. */
const codeBlock = (code: string, language: string) => {
  const longest = Math.max(2, ...[...code.matchAll(/`{3,}/g)].map((run) => run[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${language}\n${code.replace(/\r\n?/g, '\n').replace(/\n+$/, '')}\n${fence}`
}

/** Emphasis around text, with its spaces outside, where Markdown needs them. */
const wrap = (text: string, mark: string) => {
  const core = text.trim()
  if (core === '') return text
  const lead = text.slice(0, text.indexOf(core))
  return `${lead}${mark}${core}${mark}${text.slice(lead.length + core.length)}`
}

/** Text under a list marker: its first line after the marker, the rest lined up with it. */
const under = (marker: string, text: string) =>
  text
    .split('\n')
    .map((line, index) => (index === 0 ? `${marker}${line}` : line === '' ? '' : `${' '.repeat(marker.length)}${line}`))
    .join('\n')

const quoted = (text: string) =>
  text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n')

/** A table, its first row the header, as Markdown has to have one. */
const table = (rows: ReadonlyArray<ReadonlyArray<string>>) => {
  if (rows.length === 0) return ''
  const width = Math.max(...rows.map((row) => row.length))
  const line = (cells: ReadonlyArray<string>) =>
    `| ${Array.from({ length: width }, (_, index) => (cells[index] ?? '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|')).join(' | ')} |`
  const [head = [], ...body] = rows
  return [line(head), line(Array.from({ length: width }, () => '---')), ...body.map(line)].join('\n')
}

// ---- ADF to Markdown ------------------------------------------------------

/** The nodes that sit in a line of text, rather than holding blocks. */
const INLINE: ReadonlySet<string> = new Set(['text', 'hardBreak', 'mention', 'emoji', 'inlineCard', 'date', 'status', 'mediaInline'])

const attr = (node: AdfNode, name: string): string | undefined => {
  const value = node.attrs?.[name]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

const withMarks = (text: string, marks: ReadonlyArray<AdfMark>) => {
  const has = (type: string) => marks.some((mark) => mark.type === type)
  let out = has('code') ? codeSpan(text) : text
  if (has('strike')) out = wrap(out, '~~')
  if (has('em')) out = wrap(out, '*')
  if (has('strong')) out = wrap(out, '**')
  const href = marks.find((mark) => mark.type === 'link')?.attrs?.href
  return typeof href !== 'string' ? out : out === href ? `<${href}>` : `[${out}](${href})`
}

/** What a node Althar doesn't know has to say: its text, its label, its link, or its children's. */
const textOf = (node: AdfNode): string =>
  node.text ?? attr(node, 'text') ?? attr(node, 'shortName') ?? attr(node, 'url') ?? attr(node, 'alt') ?? inlineOf(node.content ?? [])

const inlineOf = (nodes: ReadonlyArray<AdfNode>): string =>
  nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return withMarks(node.text ?? '', node.marks ?? [])
        case 'hardBreak':
          return '  \n'
        case 'mention':
          return `@${(attr(node, 'text') ?? attr(node, 'id') ?? '').replace(/^@/, '')}`
        case 'date': {
          const at = Number(attr(node, 'timestamp'))
          return Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : ''
        }
        default:
          return textOf(node)
      }
    })
    .join('')

const isList = (node: AdfNode) => node.type.endsWith('List')

/** A list item's blocks, a list within it close under its first line. */
const itemOf = (content: ReadonlyArray<AdfNode>) =>
  content.every((node) => INLINE.has(node.type))
    ? inlineOf(content)
    : content.reduce((text, node) => {
        const block = blockOf(node)
        return block === '' ? text : text === '' ? block : `${text}${isList(node) ? '\n' : '\n\n'}${block}`
      }, '')

const listOf = (items: ReadonlyArray<AdfNode>, marker: (index: number, item: AdfNode) => string) =>
  items
    .map((item, index) => (isList(item) ? under('  ', blockOf(item)) : under(marker(index, item), itemOf(item.content ?? []))))
    .join('\n')

const blocksOf = (nodes: ReadonlyArray<AdfNode>): string =>
  nodes
    .map(blockOf)
    .filter((block) => block !== '')
    .join('\n\n')

const blockOf = (node: AdfNode): string => {
  const content = node.content ?? []
  switch (node.type) {
    case 'paragraph':
      return inlineOf(content)
    case 'heading':
      return `${'#'.repeat(Math.min(Math.max(Number(attr(node, 'level')) || 1, 1), 6))} ${inlineOf(content)}`
    case 'codeBlock':
      return codeBlock(content.map((child) => child.text ?? '').join(''), attr(node, 'language') ?? '')
    case 'blockquote':
      return quoted(blocksOf(content))
    case 'bulletList':
      return listOf(content, () => '- ')
    case 'orderedList': {
      const start = Number(attr(node, 'order')) || 1
      return listOf(content, (index) => `${start + index}. `)
    }
    case 'taskList':
    case 'decisionList':
      return listOf(content, (_, item) => (attr(item, 'state') === 'DONE' || attr(item, 'state') === 'DECIDED' ? '- [x] ' : '- [ ] '))
    case 'rule':
      return '---'
    case 'table':
      return table(content.map((row) => (row.content ?? []).map((cell) => blocksOf(cell.content ?? []))))
    default: {
      if (content.every((child) => INLINE.has(child.type))) return textOf(node)
      // A panel, an expand, a layout: its blocks, under its title when it has one.
      const title = attr(node, 'title')
      return [title === undefined || title === '' ? '' : `**${title}**`, blocksOf(content)].filter((part) => part !== '').join('\n\n')
    }
  }
}

/** An ADF document as Markdown. */
export const markdownOfAdf = (doc: AdfNode): string => blockOf(doc)

// ---- Wiki markup to Markdown ----------------------------------------------

/**
 * Text set aside while the rest of a line is converted, so nothing converts
 * it twice: code, links, escaped characters. Each leaves a mark of two
 * private-use characters around its number.
 */
const makeStash = () => {
  const kept: Array<string> = []
  const restore = (text: string): string => text.replace(/\uE000(\d+)\uE001/g, (_, index: string) => restore(kept[Number(index)] ?? ''))
  return { keep: (text: string) => `\uE000${kept.push(text) - 1}\uE001`, restore }
}
type Stash = ReturnType<typeof makeStash>

const LETTER = String.raw`\p{L}\p{N}`
const BOLD = new RegExp(String.raw`(^|[^${LETTER}*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![${LETTER}*])`, 'gu')
const STRUCK = new RegExp(String.raw`(^|[^${LETTER}-])-(?=[^\s-])([^-\n]*?[^\s-])-(?![${LETTER}-])`, 'gu')

/** Wiki markup's bold and strikethrough, as Markdown has them; its italic is Markdown's already. */
const emphasis = (text: string) => text.replace(BOLD, '$1**$2**').replace(STRUCK, '$1~~$2~~')

const WEB = /^(?:https?|mailto|ftp):/i

/** A line of wiki markup as Markdown. */
const wikiLine = (line: string, { keep }: Stash) =>
  emphasis(
    line
      // The editor's empty braces and braced marks: {{{}Login{}}} is {{Login}}, {*}x{*} is *x*.
      .replace(/\{\}/g, '')
      .replace(/\{([*_\-+^~?])\}/g, '$1')
      .replace(/\{\{(.+?)\}\}/g, (_, code: string) => keep(codeSpan(code)))
      .replace(/\\([^\s\w])/g, (_, char: string) => keep(/[*_`~\\[\]]/.test(char) ? `\\${char}` : char))
      // A macro left in a line (a colour, a panel's edges) says nothing itself; a title it has is kept.
      .replace(/\{\w+(?::([^}]*))?\}/g, (_, params: string | undefined) => {
        const title = /(?:^|\|)title=([^|]*)/.exec(params ?? '')?.[1]?.trim()
        return title === undefined || title === '' ? '' : keep(`**${title}**`)
      })
      .replace(/\[~([^\]\s]+)\]/g, (_, user: string) => keep(`@${user}`))
      .replace(/\[([^\]|\n]*)\|([^\]\n]+)\]/g, (_, label: string, target: string) =>
        WEB.test(target.trim()) ? keep(`[${label.trim() === '' ? target.trim() : emphasis(label)}](${target.trim()})`) : label,
      )
      .replace(/\[((?:https?|mailto|ftp):[^\]\s|]+)\]/gi, (_, url: string) => keep(`<${url}>`))
      // An attached image is its file's name: it can't be shown from here.
      .replace(/!([^!\s|]+\.[a-z0-9]+)(?:\|[^!\n]*)?!/gi, (_, name: string) => keep(name))
      .replace(/https?:\/\/[^\s\]|<>"]+/g, (url) => keep(url)),
  )

/** A code macro's language: its first parameter that isn't `key=value` (`{code:java}`, not `{code:title=Bar.java}`). */
const languageOf = (params: string | undefined) =>
  (params ?? '')
    .split('|')
    .map((part) => part.trim())
    .find((part) => part !== '' && !part.includes('=')) ?? ''

interface Chunk {
  readonly kind: 'text' | 'item' | 'block'
  text: string
  /** Where a line that carries on an item lines up. */
  readonly indent: string
  /** A table's rows, while it has more. */
  readonly rows?: Array<ReadonlyArray<string>>
}

/** Wiki markup's blocks, with code already set aside. */
const wikiBlocks = (text: string, stash: Stash): string => {
  const unquoted = text.replace(
    /\{quote\}([\s\S]*?)\{quote\}/g,
    (_, inner: string) => `\n${stash.keep(quoted(stash.restore(wikiBlocks(inner, stash))))}\n`,
  )
  const chunks: Array<Chunk> = []
  /** The paragraph, item or table the next line may carry on. */
  let open: Chunk | undefined
  const block = (text: string) => {
    chunks.push({ kind: 'block', text, indent: '' })
    open = undefined
  }
  for (const raw of unquoted.split('\n')) {
    const line = raw.trim()
    const heading = /^h([1-6])\.\s*(.*)$/.exec(line)
    const item = /^([*#]+|-)\s+(.*)$/.exec(line)
    if (line === '') open = undefined
    else if (heading !== null) block(`${'#'.repeat(Number(heading[1]))} ${wikiLine(heading[2] ?? '', stash)}`)
    else if (/^-{4,}$/.test(line)) block('---')
    else if (/^bq\.\s/.test(line)) block(quoted(wikiLine(line.slice(3).trim(), stash)))
    else if (/^\uE000\d+\uE001$/.test(line)) block(line)
    else if (line.startsWith('|')) {
      // ||a header||cell|| or |a|row|: a cell's links and code are set aside before it is split.
      const cells = wikiLine(line, stash).split(/\|\|?/).slice(1)
      if (cells.at(-1)?.trim() === '') cells.pop()
      const rows = open?.rows ?? []
      if (open?.rows === undefined) {
        open = { kind: 'block', text: '', indent: '', rows }
        chunks.push(open)
      }
      rows.push(cells.map((cell) => cell.trim()))
      open.text = table(rows)
    } else if (item !== null) {
      const markers = item[1] === '-' ? '*' : (item[1] ?? '*')
      // Nested under the item before it; with none (a quote came between), as deep as a list can start.
      const indent =
        chunks.at(-1)?.kind === 'item' ? Array.from(markers.slice(0, -1), (marker) => (marker === '#' ? '   ' : '  ')).join('') : ''
      const bullet = markers.endsWith('#') ? '1. ' : '- '
      open = { kind: 'item', text: `${indent}${bullet}${wikiLine(item[2] ?? '', stash)}`, indent: `${indent}${' '.repeat(bullet.length)}` }
      chunks.push(open)
    } else {
      // A line on its own is a line of its own, as Jira shows it.
      const converted = wikiLine(line, stash).trim()
      if (converted === '') open = undefined
      else if (open === undefined || open.rows !== undefined) {
        open = { kind: 'text', text: converted, indent: '' }
        chunks.push(open)
      } else open.text = `${open.text}  \n${open.indent}${converted}`
    }
  }
  return chunks
    .map((chunk, index) => {
      const before = chunks[index - 1]
      const gap = before === undefined ? '' : chunk.kind === 'item' && before.kind !== 'block' ? '\n' : '\n\n'
      return `${gap}${chunk.text}`
    })
    .join('')
}

/** Wiki markup, Jira Data Center's text, as Markdown. */
export const markdownOfWiki = (wiki: string): string => {
  const stash = makeStash()
  const text = wiki
    .replace(/\r\n?/g, '\n')
    .replace(
      /\{(code|noformat)(?::([^}]*))?\}\n?([\s\S]*?)\n?\{\1\}/g,
      (_, _macro: string, params: string | undefined, code: string) => `\n${stash.keep(codeBlock(code, languageOf(params)))}\n`,
    )
  return stash.restore(wikiBlocks(text, stash))
}

// ---- Markdown, read ---------------------------------------------------------

type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'break' }
  | { readonly kind: 'strong' | 'em' | 'strike'; readonly content: ReadonlyArray<Inline> }
  | { readonly kind: 'link'; readonly href: string; readonly content: ReadonlyArray<Inline> }

type Block =
  | { readonly kind: 'paragraph'; readonly content: ReadonlyArray<Inline> }
  | { readonly kind: 'heading'; readonly level: number; readonly content: ReadonlyArray<Inline> }
  | { readonly kind: 'code'; readonly language: string; readonly text: string }
  | { readonly kind: 'quote'; readonly blocks: ReadonlyArray<Block> }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly start: number; readonly items: ReadonlyArray<ReadonlyArray<Block>> }
  | { readonly kind: 'rule' }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE = /^ {0,3}> ?(.*)$/
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/

const startsBlock = (line: string) => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line)
const indentOf = (line: string) => /^ */.exec(line)?.[0].length ?? 0
const isLetter = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char)

/** The index of the bracket that closes the one at `open`, or -1. */
const closing = (text: string, open: number, left: string, right: string) => {
  let depth = 0
  for (let at = open; at < text.length; at += 1) {
    if (text[at] === '\\') at += 1
    else if (text[at] === left) depth += 1
    else if (text[at] === right && (depth -= 1) === 0) return at
  }
  return -1
}

/** Emphasis opened at `at`, if something closes it: `*`, `_`, `**`, `__` or `~~`. */
const emphasisAt = (text: string, at: number) => {
  const mark = text[at] ?? ''
  const double = text[at + 1] === mark
  if (mark === '~' && !double) return null
  const delimiter = double ? mark + mark : mark
  const first = text[at + delimiter.length]
  if (first === undefined || /\s/.test(first) || (mark === '_' && isLetter(text[at - 1]))) return null
  for (let close = at + delimiter.length + 1; close < text.length; close += 1) {
    // Code spans are passed over whole; a lone mark passes over a double one, which is emphasis within.
    if (text[close] === '`') close = Math.max(close, text.indexOf('`', close + 1))
    else if (text.startsWith(delimiter, close) && !(!double && text[close + 1] === mark) && !/\s/.test(text[close - 1] ?? ' ')) {
      if (mark === '_' && isLetter(text[close + delimiter.length])) continue
      let end = close
      while (double && text[end + delimiter.length] === mark) end += 1
      const kind = mark === '~' ? 'strike' : double ? 'strong' : 'em'
      return { kind, inner: text.slice(at + delimiter.length, end), next: end + delimiter.length } as const
    } else if (!double && text[close] === mark && text[close + 1] === mark) close += 1
  }
  return null
}

/** A paragraph's text; within a link's text (`linked`), nothing is a link again. */
const parseInline = (text: string, linked = false): ReadonlyArray<Inline> => {
  const out: Array<Inline> = []
  let plain = ''
  const flush = () => {
    if (plain !== '') out.push({ kind: 'text', text: plain })
    plain = ''
  }
  let at = 0
  while (at < text.length) {
    const char = text[at] ?? ''
    if (char === '\\' && /^[!-/:-@[-`{-~]$/.test(text[at + 1] ?? '')) {
      plain += text[at + 1]
      at += 2
      continue
    }
    if (char === '\n') {
      // Every line of a paragraph keeps its own line: Jira shows them so, as GitHub does.
      plain = plain.replace(/(?: +|\\)$/, '')
      flush()
      out.push({ kind: 'break' })
      at += 1
      continue
    }
    if (char === '`') {
      const run = /^`+/.exec(text.slice(at))?.[0] ?? '`'
      let end = text.indexOf(run, at + run.length)
      while (end !== -1 && text[end + run.length] === '`') end = text.indexOf(run, end + run.length + 1)
      if (end === -1) {
        plain += run
        at += run.length
        continue
      }
      const code = text.slice(at + run.length, end).replace(/\n/g, ' ')
      flush()
      out.push({ kind: 'code', text: /^ .*\S.* $/.test(code) ? code.slice(1, -1) : code })
      at = end + run.length
      continue
    }
    if (char === '[' && !linked) {
      const close = closing(text, at, '[', ']')
      const end = close !== -1 && text[close + 1] === '(' ? closing(text, close + 1, '(', ')') : -1
      if (end !== -1) {
        const target = text.slice(close + 2, end).trim()
        flush()
        out.push({
          kind: 'link',
          href: /^<([^>]*)>/.exec(target)?.[1] ?? target.split(/\s+/)[0] ?? '',
          content: parseInline(text.slice(at + 1, close), true),
        })
        at = end + 1
        continue
      }
    }
    // <https://…>, or a bare link.
    const url = linked
      ? undefined
      : char === '<'
        ? /^<((?:https?|mailto):[^\s>]+)>/.exec(text.slice(at))?.[1]
        : char === 'h' && !isLetter(text[at - 1])
          ? /^https?:\/\/[^\s<]*[^\s<.,;:!?'")\]]/.exec(text.slice(at))?.[0]
          : undefined
    if (url !== undefined) {
      flush()
      out.push({ kind: 'link', href: url, content: [{ kind: 'text', text: url }] })
      at += char === '<' ? url.length + 2 : url.length
      continue
    }
    const found = char === '*' || char === '_' || char === '~' ? emphasisAt(text, at) : null
    if (found !== null) {
      flush()
      out.push({ kind: found.kind, content: parseInline(found.inner, linked) })
      at = found.next
      continue
    }
    plain += char
    at += 1
  }
  flush()
  return out
}

/** A list from its first item on: its items' lines, without their markers and indents. */
const parseList = (lines: ReadonlyArray<string>, from: number) => {
  const first = ITEM.exec(lines[from] ?? '')
  const indent = first?.[1]?.length ?? 0
  const ordered = /\d/.test(first?.[2] ?? '')
  const items: Array<Array<string>> = []
  let offset = 0
  let at = from
  for (; at < lines.length; at += 1) {
    const line = lines[at] ?? ''
    const item = ITEM.exec(line)
    if (item !== null && (item[1]?.length ?? 0) <= indent && !RULE.test(line)) {
      // A marker of the other kind starts another list.
      if (/\d/.test(item[2] ?? '') !== ordered) break
      offset = indent + (item[2]?.length ?? 1) + Math.min(item[3]?.length ?? 1, 4)
      items.push([item[4] ?? ''])
      continue
    }
    if (line.trim() === '') {
      const next = lines.slice(at + 1).find((later) => later.trim() !== '')
      if (next === undefined || (indentOf(next) <= indent && !ITEM.test(next))) break
      items.at(-1)?.push('')
      continue
    }
    if (indentOf(line) > indent) items.at(-1)?.push(line.slice(Math.min(indentOf(line), offset)))
    // A line that carries on the item's paragraph without its indent.
    else if (!startsBlock(line) && (lines[at - 1] ?? '').trim() !== '') items.at(-1)?.push(line.trim())
    else break
  }
  const start = Number.parseInt(first?.[2] ?? '1', 10)
  return { block: { kind: 'list', ordered, start: Number.isNaN(start) ? 1 : start, items: items.map(parseBlocks) } as const, next: at }
}

const parseBlocks = (lines: ReadonlyArray<string>): ReadonlyArray<Block> => {
  const blocks: Array<Block> = []
  let at = 0
  while (at < lines.length) {
    const line = lines[at] ?? ''
    const fence = FENCE.exec(line)
    const heading = HEADING.exec(line)
    if (line.trim() === '') at += 1
    else if (fence !== null) {
      const marker = fence[1] ?? '```'
      const closes = (later: string) => later.trim().startsWith(marker) && later.trim().replaceAll(marker[0] ?? '`', '') === ''
      const end = lines.findIndex((later, index) => index > at && closes(later))
      const stop = end === -1 ? lines.length : end
      blocks.push({
        kind: 'code',
        language: fence[2] ?? '',
        text: lines
          .slice(at + 1, stop)
          .join('\n')
          .replace(/\n+$/, ''),
      })
      at = stop + 1
    } else if (heading !== null) {
      blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, content: parseInline(heading[2] ?? '') })
      at += 1
    } else if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      at += 1
    } else if (QUOTE.test(line)) {
      const quoted: Array<string> = []
      for (; at < lines.length && QUOTE.test(lines[at] ?? ''); at += 1) quoted.push(QUOTE.exec(lines[at] ?? '')?.[1] ?? '')
      blocks.push({ kind: 'quote', blocks: parseBlocks(quoted) })
    } else if (ITEM.test(line)) {
      const list = parseList(lines, at)
      blocks.push(list.block)
      at = list.next
    } else {
      const paragraph: Array<string> = []
      for (; at < lines.length && (lines[at] ?? '').trim() !== '' && (paragraph.length === 0 || !startsBlock(lines[at] ?? '')); at += 1)
        paragraph.push((lines[at] ?? '').trimStart())
      blocks.push({ kind: 'paragraph', content: parseInline(paragraph.join('\n').trimEnd()) })
    }
  }
  return blocks
}

const parseMarkdown = (markdown: string) => parseBlocks(markdown.replace(/\r\n?/g, '\n').split('\n'))

/** What a quote or a list item can hold in both of Jira's forms: a heading is a paragraph there, and a quote or rule gives way. */
const nested = (blocks: ReadonlyArray<Block>): ReadonlyArray<Block> =>
  blocks.flatMap((block): ReadonlyArray<Block> =>
    block.kind === 'heading'
      ? [{ kind: 'paragraph', content: block.content }]
      : block.kind === 'quote'
        ? nested(block.blocks)
        : block.kind === 'rule'
          ? []
          : [block],
  )

// ---- Markdown to ADF ------------------------------------------------------

const withMark = (marks: ReadonlyArray<AdfMark>, mark: AdfMark) => (marks.some((has) => has.type === mark.type) ? marks : [...marks, mark])

const adfInline = (nodes: ReadonlyArray<Inline>, marks: ReadonlyArray<AdfMark> = []): ReadonlyArray<AdfNode> =>
  nodes.flatMap((node): ReadonlyArray<AdfNode> => {
    switch (node.kind) {
      case 'text':
        return [{ type: 'text', text: node.text, ...(marks.length === 0 ? {} : { marks }) }]
      case 'code':
        // Code takes no other mark but a link.
        return [{ type: 'text', text: node.text, marks: [{ type: 'code' }, ...marks.filter((mark) => mark.type === 'link')] }]
      case 'break':
        return [{ type: 'hardBreak' }]
      case 'link':
        return adfInline(node.content, withMark(marks, { type: 'link', attrs: { href: node.href } }))
      default:
        return adfInline(node.content, withMark(marks, { type: node.kind }))
    }
  })

const adfBlock = (block: Block): AdfNode => {
  switch (block.kind) {
    case 'paragraph':
      return { type: 'paragraph', content: adfInline(block.content) }
    case 'heading':
      return { type: 'heading', attrs: { level: block.level }, content: adfInline(block.content) }
    case 'code':
      return {
        type: 'codeBlock',
        ...(block.language === '' ? {} : { attrs: { language: block.language } }),
        content: block.text === '' ? [] : [{ type: 'text', text: block.text }],
      }
    case 'quote':
      return { type: 'blockquote', content: nested(block.blocks).map(adfBlock) }
    case 'list':
      return {
        type: block.ordered ? 'orderedList' : 'bulletList',
        ...(block.ordered ? { attrs: { order: block.start } } : {}),
        content: block.items.map((item) => {
          // An item starts with a paragraph, even an empty one.
          const blocks = nested(item)
          const first = blocks[0]?.kind
          return {
            type: 'listItem',
            content: (first === 'paragraph' || first === 'code' ? blocks : [{ kind: 'paragraph' as const, content: [] }, ...blocks]).map(
              adfBlock,
            ),
          }
        }),
      }
    case 'rule':
      return { type: 'rule' }
  }
}

/** Markdown as an ADF document, for Jira Cloud. */
export const adfOf = (markdown: string): AdfDoc => ({ type: 'doc', version: 1, content: parseMarkdown(markdown).map(adfBlock) })

// ---- Markdown to wiki markup ----------------------------------------------

/** The languages Jira's code macro colours, by the names Markdown's fences use for them; any other is plain text. */
const CODE_LANGUAGES: ReadonlyMap<string, string> = new Map([
  ...'actionscript ada applescript bash c c# c++ css erlang go groovy haskell html java javascript json lua objc perl php python r ruby scala sql swift xml yaml'
    .split(' ')
    .map((name) => [name, name] as const),
  ['sh', 'bash'],
  ['shell', 'bash'],
  ['js', 'javascript'],
  ['py', 'python'],
  ['rb', 'ruby'],
  ['yml', 'yaml'],
  ['cpp', 'c++'],
  ['cs', 'c#'],
  ['csharp', 'c#'],
])

/** Text as it is, where wiki markup would read a mark, a macro or a link. */
const escapeWiki = (text: string) => text.replace(/[\\{}[\]*_]/g, '\\$&')

const wikiInline = (nodes: ReadonlyArray<Inline>): string =>
  nodes
    .map((node) => {
      switch (node.kind) {
        case 'text':
          return escapeWiki(node.text)
        case 'code':
          return `{{${escapeWiki(node.text)}}}`
        case 'break':
          return '\n'
        case 'strong':
          return `*${wikiInline(node.content)}*`
        case 'em':
          return `_${wikiInline(node.content)}_`
        case 'strike':
          return `-${wikiInline(node.content)}-`
        case 'link': {
          const label = wikiInline(node.content).replace(/\|/g, '\\|')
          return label === escapeWiki(node.href) ? `[${node.href}]` : `[${label}|${node.href}]`
        }
      }
    })
    .join('')

const wikiList = (list: Extract<Block, { kind: 'list' }>, prefix: string): string =>
  list.items
    .map((item) => {
      const marker = `${prefix}${list.ordered ? '#' : '*'}`
      const blocks = nested(item)
      const [first, ...rest] = blocks
      const head = first?.kind === 'paragraph' ? wikiInline(first.content) : ''
      const after = first?.kind === 'paragraph' ? rest : blocks
      return [`${marker} ${head}`, ...after.map((block) => (block.kind === 'list' ? wikiList(block, marker) : wikiBlock(block)))].join('\n')
    })
    .join('\n')

const wikiBlock = (block: Block): string => {
  switch (block.kind) {
    case 'paragraph':
      return wikiInline(block.content)
    case 'heading':
      return `h${block.level}. ${wikiInline(block.content)}`
    case 'code': {
      const language = CODE_LANGUAGES.get(block.language.toLowerCase())
      return language === undefined ? `{noformat}\n${block.text}\n{noformat}` : `{code:${language}}\n${block.text}\n{code}`
    }
    case 'quote':
      // Wiki markup's quotes don't nest: a quote within one is its text.
      return `{quote}\n${block.blocks
        .flatMap((inner) => (inner.kind === 'quote' ? nested(inner.blocks) : [inner]))
        .map(wikiBlock)
        .join('\n\n')}\n{quote}`
    case 'list':
      return wikiList(block, '')
    case 'rule':
      return '----'
  }
}

/** Markdown as wiki markup, for Jira Data Center. */
export const wikiOf = (markdown: string): string => parseMarkdown(markdown).map(wikiBlock).join('\n\n')
