import { Schema } from 'effect'

/*
 * Jira's text, to Markdown and back. Jira Cloud writes descriptions and
 * comments in the Atlassian Document Format (ADF), a tree of JSON nodes;
 * Jira Data Center in wiki markup. The model's text is Markdown, so an issue
 * is read into it from either, and a comment is written in whichever the
 * edition takes. Each covers what issues and Althar's comments hold:
 * paragraphs, headings, emphasis, code, links, lists, quotes, rules, tables
 * and mentions. Anything else keeps its text.
 *
 * Descriptions come from other people and run in the runtime's own process,
 * so every converter takes time in proportion to its text, however odd the
 * text: no search starts again from each of many openers, no pattern
 * backtracks over a run of spaces, and nesting stops at DEEPEST levels.
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

/** How deep quotes, lists and emphasis nest before what is deeper is read as text. */
const DEEPEST = 16

/** The longest run of a character in text. */
const longestRun = (text: string, char: string) => {
  let longest = 0
  let run = 0
  for (const each of text) {
    run = each === char ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  return longest
}

/** Text without the line breaks at its end. */
const withoutTrailingBreaks = (text: string) => {
  let end = text.length
  while (end > 0 && text[end - 1] === '\n') end -= 1
  return text.slice(0, end)
}

// ---- Markdown, as written here --------------------------------------------

/** A code span, fenced by more backticks than the code holds in a row. */
const codeSpan = (code: string) => {
  const longest = longestRun(code, '`')
  const fence = '`'.repeat(longest + 1)
  return longest === 0 ? `${fence}${code}${fence}` : `${fence} ${code} ${fence}`
}

/** A fenced code block, with its language when it has one. */
const codeBlock = (code: string, language: string) => {
  const fence = '`'.repeat(Math.max(2, longestRun(code, '`')) + 1)
  return `${fence}${language}\n${withoutTrailingBreaks(code.replace(/\r\n?/g, '\n'))}\n${fence}`
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

/** A table cell's text on one line. */
const oneLine = (cell: string) =>
  cell
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' ')
    .replace(/\|/g, '\\|')

/** A table, its first row the header, as Markdown has to have one. */
const table = (rows: ReadonlyArray<ReadonlyArray<string>>) => {
  if (rows.length === 0) return ''
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0)
  const line = (cells: ReadonlyArray<string>) =>
    `| ${Array.from({ length: width }, (_, index) => oneLine(cells[index] ?? '')).join(' | ')} |`
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

/** A node's own words: its text, its label, its link. */
const ownText = (node: AdfNode) => node.text ?? attr(node, 'text') ?? attr(node, 'shortName') ?? attr(node, 'url') ?? attr(node, 'alt')

/** The words under nodes, however deep they go, walked without recursion. */
const flatText = (nodes: ReadonlyArray<AdfNode>) => {
  let out = ''
  const left = nodes.toReversed()
  for (let node = left.pop(); node !== undefined; node = left.pop()) {
    const own = ownText(node)
    if (own !== undefined) out += own
    else for (const child of (node.content ?? []).toReversed()) left.push(child)
  }
  return out
}

/** What a node Althar doesn't know has to say: its own words, or its children's. */
const textOf = (node: AdfNode): string => ownText(node) ?? flatText(node.content ?? [])

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
const itemOf = (content: ReadonlyArray<AdfNode>, depth: number) =>
  content.every((node) => INLINE.has(node.type))
    ? inlineOf(content)
    : content.reduce((text, node) => {
        const block = blockOf(node, depth)
        return block === '' ? text : text === '' ? block : `${text}${isList(node) ? '\n' : '\n\n'}${block}`
      }, '')

const listOf = (items: ReadonlyArray<AdfNode>, depth: number, marker: (index: number, item: AdfNode) => string) =>
  items
    .map((item, index) =>
      isList(item) ? under('  ', blockOf(item, depth)) : under(marker(index, item), itemOf(item.content ?? [], depth)),
    )
    .join('\n')

const blocksOf = (nodes: ReadonlyArray<AdfNode>, depth: number): string =>
  nodes
    .map((node) => blockOf(node, depth))
    .filter((block) => block !== '')
    .join('\n\n')

/** A block as Markdown; one nested deeper than anything written by hand is its words alone. */
const blockOf = (node: AdfNode, depth: number): string => {
  const content = node.content ?? []
  const deeper = depth + 1
  if (depth >= DEEPEST) return flatText([node])
  switch (node.type) {
    case 'paragraph':
      return inlineOf(content)
    case 'heading':
      return `${'#'.repeat(Math.min(Math.max(Number(attr(node, 'level')) || 1, 1), 6))} ${inlineOf(content)}`
    case 'codeBlock':
      return codeBlock(content.map((child) => child.text ?? '').join(''), attr(node, 'language') ?? '')
    case 'blockquote':
      return quoted(blocksOf(content, deeper))
    case 'bulletList':
      return listOf(content, deeper, () => '- ')
    case 'orderedList': {
      const start = Number(attr(node, 'order')) || 1
      return listOf(content, deeper, (index) => `${start + index}. `)
    }
    case 'taskList':
    case 'decisionList':
      return listOf(content, deeper, (_, item) =>
        attr(item, 'state') === 'DONE' || attr(item, 'state') === 'DECIDED' ? '- [x] ' : '- [ ] ',
      )
    case 'rule':
      return '---'
    case 'table':
      return table(content.map((row) => (row.content ?? []).map((cell) => blocksOf(cell.content ?? [], deeper))))
    default: {
      if (content.every((child) => INLINE.has(child.type))) return textOf(node)
      // A panel, an expand, a layout: its blocks, under its title when it has one.
      const title = attr(node, 'title')
      return [title === undefined || title === '' ? '' : `**${title}**`, blocksOf(content, deeper)]
        .filter((part) => part !== '')
        .join('\n\n')
    }
  }
}

/** An ADF document as Markdown. */
export const markdownOfAdf = (doc: AdfNode): string => blockOf(doc, 0)

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

/**
 * Wiki markup's bold and strikethrough, as Markdown has them; its italic is
 * Markdown's already. Each try stops at the next mark or line's end, so a
 * line full of marks costs no more than its length.
 */
const emphasis = (text: string) => text.replace(BOLD, '$1**$2**').replace(STRUCK, '$1~~$2~~')

const WEB = /^(?:https?|mailto|ftp):/i

/**
 * Each `open … close` in a line, made into something else; the first that
 * nothing closes ends the search, since nothing closes any after it either.
 */
const eachPair = (line: string, open: string, close: string, made: (inner: string) => string) => {
  let out = ''
  let from = 0
  for (let start = line.indexOf(open); start !== -1; start = line.indexOf(open, from)) {
    const end = line.indexOf(close, start + open.length + 1)
    if (end === -1) break
    out += `${line.slice(from, start)}${made(line.slice(start + open.length, end))}`
    from = end + close.length
  }
  return out + line.slice(from)
}

/** A line of wiki markup as Markdown. */
const wikiLine = (line: string, { keep }: Stash) =>
  emphasis(
    eachPair(
      // The editor's empty braces and braced marks: {{{}Login{}}} is {{Login}}, {*}x{*} is *x*.
      line.replace(/\{\}/g, '').replace(/\{([*_\-+^~?])\}/g, '$1'),
      '{{',
      '}}',
      (code) => keep(codeSpan(code)),
    )
      .replace(/\\([^\s\w])/g, (_, char: string) => keep(/[*_`~\\[\]]/.test(char) ? `\\${char}` : char))
      // A macro left in a line (a colour, a panel's edges) says nothing itself; a title it has is kept.
      // Neither its parameters nor a link's parts run past the next brace or bracket, so no try runs to the line's end.
      .replace(/\{\w+(?::([^{}]*))?\}/g, (_, params: string | undefined) => {
        const title = /(?:^|\|)title=([^|]*)/.exec(params ?? '')?.[1]?.trim()
        return title === undefined || title === '' ? '' : keep(`**${title}**`)
      })
      .replace(/\[~([^[\]\s]+)\]/g, (_, user: string) => keep(`@${user}`))
      .replace(/\[([^[\]|\n]*)\|([^[\]\n]+)\]/g, (_, label: string, target: string) =>
        WEB.test(target.trim()) ? keep(`[${label.trim() === '' ? target.trim() : emphasis(label)}](${target.trim()})`) : label,
      )
      .replace(/\[((?:https?|mailto|ftp):[^[\]\s|]+)\]/gi, (_, url: string) => keep(`<${url}>`))
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
  /** A table's rows, made into one when all are in. */
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
      return `${gap}${chunk.rows === undefined ? chunk.text : table(chunk.rows)}`
    })
    .join('')
}

/** Code and noformat macros set aside as code blocks, each up to its own closing tag; one nothing closes stays as it is. */
const withoutCode = (text: string, { keep }: Stash) => {
  let out = ''
  let from = 0
  const unclosed = new Set<string>()
  for (const open of text.matchAll(/\{(code|noformat)(?::([^{}]*))?\}/g)) {
    const macro = open[1] ?? 'code'
    if (open.index < from || unclosed.has(macro)) continue
    const start = open.index + open[0].length
    const end = text.indexOf(`{${macro}}`, start)
    if (end === -1) unclosed.add(macro)
    else {
      const code = text.slice(start, end).replace(/^\n/, '').replace(/\n$/, '')
      out += `${text.slice(from, open.index)}\n${keep(codeBlock(code, languageOf(open[2])))}\n`
      from = end + macro.length + 2
    }
  }
  return out + text.slice(from)
}

/** Wiki markup, Jira Data Center's text, as Markdown. */
export const markdownOfWiki = (wiki: string): string => {
  const stash = makeStash()
  return stash.restore(wikiBlocks(withoutCode(wiki.replace(/\r\n?/g, '\n'), stash), stash))
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
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]|$)/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE = /^ {0,3}> ?(.*)$/
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/
/** Links, read where they start: `<https://…>`, or a bare one. Neither runs past the next `<`, so no try runs to the end. */
const AUTOLINK = /<((?:https?|mailto):[^\s<>]+)>/y
const BARE_LINK = /https?:\/\/[^\s<]*[^\s<.,;:!?'")\]]/y

const startsBlock = (line: string) => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line)
const indentOf = (line: string) => /^ */.exec(line)?.[0].length ?? 0
const isLetter = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char)
const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char)

/** A heading's text: what follows its marks, without a closing run of them. */
const headingText = (line: string, marks: number) => {
  const text = line.trim().slice(marks).trim()
  let end = text.length
  while (end > 0 && text[end - 1] === '#') end -= 1
  return end === 0 || text[end - 1] === ' ' || text[end - 1] === '\t' ? text.slice(0, end).trimEnd() : text
}

/** Each bracket that opens and the one that closes it, in one pass, as a stack pairs them. */
const pairsOf = (text: string, left: string, right: string) => {
  const pairs = new Map<number, number>()
  const open: Array<number> = []
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === '\\') at += 1
    else if (text[at] === left) open.push(at)
    else if (text[at] === right) {
      const start = open.pop()
      if (start !== undefined) pairs.set(start, at)
    }
  }
  return pairs
}

/** The run of a character starting at `at`, as long as it goes. */
const runAt = (text: string, at: number) => {
  let end = at
  while (text[end] === text[at]) end += 1
  return end - at
}

/** Where each run of backticks starts, by its length, in order. */
const runsOf = (text: string) => {
  const runs = new Map<number, Array<number>>()
  for (let at = text.indexOf('`'); at !== -1; at = text.indexOf('`', at + runAt(text, at))) {
    const length = runAt(text, at)
    const starts = runs.get(length)
    if (starts === undefined) runs.set(length, [at])
    else starts.push(at)
  }
  return runs
}

/**
 * A paragraph's text, read in time in proportion to its length. What closes
 * an opener is found without searching again from each of many: brackets are
 * paired in one pass, code spans close at the next backtick run of their
 * length, looked up, and each stretch of text read remembers which emphasis
 * has nothing to close it, since a later opener of that kind would find
 * nothing either.
 */
const makeReader = (text: string) => {
  let runs: ReadonlyMap<number, ReadonlyArray<number>> | undefined
  let brackets: ReadonlyMap<number, number> | undefined
  let parens: ReadonlyMap<number, number> | undefined

  /** Where a code span of `length` backticks, opened before `from`, closes: the next run of just as many, or -1. */
  const spanEnd = (from: number, length: number) => {
    runs ??= runsOf(text)
    const starts = runs.get(length) ?? []
    let low = 0
    let high = starts.length
    while (low < high) {
      const middle = (low + high) >> 1
      if ((starts[middle] ?? 0) < from) low = middle + 1
      else high = middle
    }
    return starts[low] ?? -1
  }

  /** Emphasis opened at `at`, if something closes it before `to`: `*`, `_`, `**`, `__` or `~~`. */
  const emphasisAt = (at: number, to: number, failed: Set<string>) => {
    // What lies past the stretch being read isn't there for it.
    const charAt = (index: number) => (index < to ? text[index] : undefined)
    const mark = text[at] ?? ''
    const double = charAt(at + 1) === mark
    if (mark === '~' && !double) return null
    const delimiter = double ? mark + mark : mark
    if (failed.has(delimiter) || isSpace(charAt(at + delimiter.length)) || (mark === '_' && isLetter(text[at - 1]))) return null
    for (let close = at + delimiter.length + 1; close < to; close += 1) {
      // Code spans are passed over whole; a lone mark passes over a double one, which is emphasis within.
      if (text[close] === '`') {
        const length = runAt(text, close)
        const end = spanEnd(close + length, length)
        close = (end === -1 || end + length > to ? close : end) + length - 1
      } else if (text.startsWith(delimiter, close) && !(!double && charAt(close + 1) === mark) && !isSpace(text[close - 1])) {
        if (mark === '_' && isLetter(charAt(close + delimiter.length))) continue
        let end = close
        while (double && charAt(end + delimiter.length) === mark) end += 1
        if (end + delimiter.length > to) break
        const kind = mark === '~' ? 'strike' : double ? 'strong' : 'em'
        return { kind, from: at + delimiter.length, to: end, next: end + delimiter.length } as const
      } else if (!double && text[close] === mark && charAt(close + 1) === mark) close += 1
    }
    failed.add(delimiter)
    return null
  }

  /** A link starting at `at`: `[text](href)`, `<https://…>`, or a bare one. */
  const linkAt = (at: number, to: number, depth: number): { readonly link: Inline; readonly next: number } | undefined => {
    const char = text[at]
    if (char === '[') {
      brackets ??= pairsOf(text, '[', ']')
      const close = brackets.get(at) ?? -1
      if (close === -1 || text[close + 1] !== '(') return undefined
      parens ??= pairsOf(text, '(', ')')
      const end = parens.get(close + 1) ?? -1
      if (end === -1 || end >= to) return undefined
      const target = text.slice(close + 2, end).trim()
      const href = /^<([^>]*)>/.exec(target)?.[1] ?? target.split(/\s+/)[0] ?? ''
      return { link: { kind: 'link', href, content: read(at + 1, close, true, depth + 1) }, next: end + 1 }
    }
    const pattern = char === '<' ? AUTOLINK : char === 'h' && !isLetter(text[at - 1]) ? BARE_LINK : undefined
    if (pattern === undefined) return undefined
    pattern.lastIndex = at
    const match = pattern.exec(text)
    if (match === null || at + match[0].length > to) return undefined
    const href = match[1] ?? match[0]
    return { link: { kind: 'link', href, content: [{ kind: 'text', text: href }] }, next: at + match[0].length }
  }

  /** The text from `from` to `to`; within a link's text (`linked`), nothing is a link again. */
  const read = (from: number, to: number, linked: boolean, depth: number): ReadonlyArray<Inline> => {
    const out: Array<Inline> = []
    const failed = new Set<string>()
    let plain = ''
    const flush = () => {
      if (plain !== '') out.push({ kind: 'text', text: plain })
      plain = ''
    }
    let at = from
    while (at < to) {
      const char = text[at] ?? ''
      const link = linked || (char !== '[' && char !== '<' && char !== 'h') ? undefined : linkAt(at, to, depth)
      const found = depth < DEEPEST && (char === '*' || char === '_' || char === '~') ? emphasisAt(at, to, failed) : null
      if (char === '\\' && at + 1 < to && /^[!-/:-@[-`{-~]$/.test(text[at + 1] ?? '')) {
        plain += text[at + 1]
        at += 2
      } else if (char === '\n') {
        // Every line of a paragraph keeps its own line: Jira shows them so, as GitHub does.
        plain = plain.endsWith('\\') ? plain.slice(0, -1) : plain.trimEnd()
        flush()
        out.push({ kind: 'break' })
        at += 1
      } else if (char === '`') {
        const length = runAt(text, at)
        const end = spanEnd(at + length, length)
        if (end === -1 || end + length > to) {
          plain += '`'.repeat(length)
          at += length
        } else {
          const code = text.slice(at + length, end).replace(/\n/g, ' ')
          flush()
          out.push({
            kind: 'code',
            text: code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '' ? code.slice(1, -1) : code,
          })
          at = end + length
        }
      } else if (link !== undefined) {
        flush()
        out.push(link.link)
        at = link.next
      } else if (found !== null) {
        flush()
        out.push({ kind: found.kind, content: read(found.from, found.to, linked, depth + 1) })
        at = found.next
      } else {
        plain += char
        at += 1
      }
    }
    flush()
    return out
  }

  return read
}

const parseInline = (text: string): ReadonlyArray<Inline> => makeReader(text)(0, text.length, false, 0)

/** A list from its first item on: its items' lines, without their markers and indents. */
const parseList = (lines: ReadonlyArray<string>, from: number, depth: number) => {
  const first = ITEM.exec(lines[from] ?? '')
  const indent = first?.[1]?.length ?? 0
  const ordered = /\d/.test(first?.[2] ?? '')
  const items: Array<Array<string>> = []
  let offset = 0
  let at = from
  while (at < lines.length) {
    const line = lines[at] ?? ''
    const item = ITEM.exec(line)
    if (item !== null && (item[1]?.length ?? 0) <= indent && !RULE.test(line)) {
      // A marker of the other kind starts another list.
      if (/\d/.test(item[2] ?? '') !== ordered) break
      offset = indent + (item[2]?.length ?? 1) + Math.min(item[3]?.length ?? 1, 4)
      items.push([item[4] ?? ''])
      at += 1
    } else if (line.trim() === '') {
      // Blank lines carry on the list only when what follows them belongs to it.
      let next = at
      while (next < lines.length && (lines[next] ?? '').trim() === '') next += 1
      const after = lines[next]
      if (after === undefined || (indentOf(after) <= indent && !ITEM.test(after))) break
      for (; at < next; at += 1) items.at(-1)?.push('')
    } else if (indentOf(line) > indent) {
      items.at(-1)?.push(line.slice(Math.min(indentOf(line), offset)))
      at += 1
    } else if (!startsBlock(line) && (lines[at - 1] ?? '').trim() !== '') {
      // A line that carries on the item's paragraph without its indent.
      items.at(-1)?.push(line.trim())
      at += 1
    } else break
  }
  const start = Number.parseInt(first?.[2] ?? '1', 10)
  return {
    block: {
      kind: 'list',
      ordered,
      start: Number.isNaN(start) ? 1 : start,
      items: items.map((lines) => parseBlocks(lines, depth + 1)),
    } as const,
    next: at,
  }
}

const parseBlocks = (lines: ReadonlyArray<string>, depth = 0): ReadonlyArray<Block> => {
  // Deeper than anything written by hand: the rest is text.
  if (depth >= DEEPEST) {
    const rest = lines.join('\n').trim()
    return rest === '' ? [] : [{ kind: 'paragraph', content: parseInline(rest) }]
  }
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
      let end = at + 1
      while (end < lines.length && !closes(lines[end] ?? '')) end += 1
      blocks.push({ kind: 'code', language: fence[2] ?? '', text: withoutTrailingBreaks(lines.slice(at + 1, end).join('\n')) })
      at = end + 1
    } else if (heading !== null) {
      const marks = heading[1]?.length ?? 1
      blocks.push({ kind: 'heading', level: marks, content: parseInline(headingText(line, marks)) })
      at += 1
    } else if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      at += 1
    } else if (QUOTE.test(line)) {
      const quoted: Array<string> = []
      for (; at < lines.length && QUOTE.test(lines[at] ?? ''); at += 1) quoted.push(QUOTE.exec(lines[at] ?? '')?.[1] ?? '')
      blocks.push({ kind: 'quote', blocks: parseBlocks(quoted, depth + 1) })
    } else if (ITEM.test(line)) {
      const list = parseList(lines, at, depth)
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
