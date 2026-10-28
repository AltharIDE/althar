import { Lexer, type MarkedToken, type Token } from 'marked'
import { createContext, useContext, useMemo, type ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { safeHref } from '../../lib/safeHref'
import { Code } from '../../primitives/Code/Code'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { type FoundCode, mayBeCode, PLAIN_PATH } from '../Code/code'
import { CodeRef } from '../Code/CodeRef'
import { type CodeShell, useThreadShell } from '../Shell/Shell'
import { Table, type TableText } from '../Table/Table'
import s from './Markdown.module.css'

/*
 * Markdown as agents write it: GitHub-flavoured, parsed by marked's lexer
 * and drawn as our own elements. Nothing is inserted as HTML: raw HTML in
 * the source shows as text, and a link is a link only when it is http or
 * https. The reading voice of the thread, a size down. Where the thread's
 * host finds code (ThreadShell's code), the names in it that name code (a
 * path in backticks, a name in code, a path written into the words) are
 * the files they name, to peek at and open.
 */

const KNOWN: ReadonlySet<string> = new Set<MarkedToken['type']>([
  'blockquote',
  'br',
  'checkbox',
  'code',
  'codespan',
  'def',
  'del',
  'em',
  'escape',
  'heading',
  'hr',
  'html',
  'image',
  'link',
  'list',
  'list_item',
  'paragraph',
  'space',
  'strong',
  'table',
  'text',
])
/* marked's own extension point types tokens loosely; ours are the ones it documents */
const known = (t: Token): t is MarkedToken => KNOWN.has(t.type)

const LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5, 6]

/** The blocks of a source, without the blank space between them. */
export function markdownBlocks(source: string): number {
  return Lexer.lex(source).filter((t) => t.type !== 'space' && t.type !== 'def').length
}

export interface MarkdownText {
  /** Read after a link, since it opens outside. */
  newTab: string
  /** A task list item's box, for a screen reader. */
  done: string
  notDone: string
  /** A table's own copy, such as its name for a screen reader. */
  table?: Partial<TableText>
  /** A code block's copy button. */
  copy?: Partial<CopyButtonText>
}

export const markdownText: MarkdownText = { newTab: '(opens in a new tab)', done: 'done', notDone: 'not done' }

export type MarkdownProps = RootProps<
  'div',
  {
    /** The markdown. */
    source: string
    /** Only these top-level blocks, counted from 0 without blank space: a preview, or the rest after one. */
    from?: number
    to?: number
    size?: 'thread' | 'panel'
    /** The rank a `#` heading takes in the page's outline; `##` is one below. */
    headingLevel?: HeadingLevel
    text?: Partial<MarkdownText>
  }
>

/** What the names in a text name, as the host found them: none until it has, and none inside a link, which a name can't open inside. */
const Found = createContext<{ readonly found: ReadonlyMap<string, FoundCode> | null; readonly inLink: boolean }>({
  found: null,
  inLink: false,
})

const plainPaths = (text: string) => [...text.matchAll(PLAIN_PATH)].map((match) => match[0])

/** The names a text's blocks may name code by, in order: what is in backticks, and paths written into its words; none in a link. */
export const codeNamesIn = (tokens: readonly Token[]): string[] => {
  const names: string[] = []
  const walk = (all: readonly Token[]) => {
    for (const token of all) {
      if (!known(token)) continue
      if (token.type === 'link' || token.type === 'code' || token.type === 'html') continue
      if (token.type === 'codespan') {
        const raw = decode(token.text)
        if (mayBeCode(raw)) names.push(raw)
        continue
      }
      if (token.type === 'text' && token.tokens === undefined) names.push(...plainPaths(decode(token.text)))
      if (token.type === 'list') for (const item of token.items) walk(item.tokens)
      if (token.type === 'table') for (const row of [token.header, ...token.rows]) for (const cell of row) walk(cell.tokens)
      if ('tokens' in token && token.tokens !== undefined) walk(token.tokens)
    }
  }
  walk(tokens)
  return [...new Set(names)]
}

export function Markdown({ source, from = 0, to, size = 'thread', headingLevel = 3, text, className, ...rest }: MarkdownProps) {
  const t = { ...markdownText, ...text }
  const blocks = useMemo(() => Lexer.lex(source).filter((b) => b.type !== 'space' && b.type !== 'def'), [source])
  const code = useThreadShell().code
  const finds = code !== undefined
  const names = useMemo(() => (finds ? codeNamesIn(blocks.slice(from, to)) : []), [finds, blocks, from, to])
  const drawn = blocks.slice(from, to).map((b, i) => <Block key={i} token={b} base={headingLevel} t={t} />)
  return (
    <div className={cx(s.md, size === 'panel' && s.panel, className)} {...rest}>
      {code !== undefined && names.length > 0 ? (
        <WithCode code={code} names={names}>
          {drawn}
        </WithCode>
      ) : (
        drawn
      )}
    </div>
  )
}

/** The text's blocks, with what the host found its names name. */
function WithCode({ code, names, children }: { code: CodeShell; names: readonly string[]; children: ReactNode }) {
  const found = code.useFound(names) ?? null
  const value = useMemo(() => ({ found, inLink: false }), [found])
  return <Found.Provider value={value}>{children}</Found.Provider>
}

function Block({ token, base, t }: { token: Token; base: HeadingLevel; t: MarkdownText }): ReactNode {
  if (!known(token)) return token.raw
  switch (token.type) {
    case 'heading':
      return (
        <Heading level={LEVELS[base + token.depth - 2] ?? 6} className={token.depth === 1 ? s.title : s.heading}>
          {inline(token.tokens, t)}
        </Heading>
      )
    case 'paragraph':
      return <p>{inline(token.tokens, t)}</p>
    case 'list': {
      const items = token.items.map((item, i) => (
        <li key={i} className={item.task ? s.task : undefined}>
          {item.task && (
            <span className={s.box} data-checked={item.checked || undefined}>
              <VisuallyHidden>{item.checked ? t.done : t.notDone}: </VisuallyHidden>
            </span>
          )}
          {item.tokens.map((c, j) =>
            c.type === 'text' ? <span key={j}>{inline(c.tokens ?? [c], t)}</span> : <Block key={j} token={c} base={base} t={t} />,
          )}
        </li>
      ))
      return token.ordered ? (
        <ol start={typeof token.start === 'number' && token.start !== 1 ? token.start : undefined}>{items}</ol>
      ) : (
        <ul>{items}</ul>
      )
    }
    case 'code':
      /* the copy sits in the block's corner, over a band the code keeps clear of; beside a single line instead */
      return (
        <div className={token.text.includes('\n') ? s.block : `${s.block} ${s.oneLine}`}>
          <pre>
            <code>{token.text}</code>
          </pre>
          <span className={s.copy}>
            <CopyButton value={token.text} text={t.copy} ghost />
          </span>
        </div>
      )
    case 'blockquote':
      return (
        <blockquote>
          {token.tokens.map((c, j) => (
            <Block key={j} token={c} base={base} t={t} />
          ))}
        </blockquote>
      )
    case 'table': {
      /* the kit's table, as rows of words in what is said rather than a box: its cells wrap, so nothing is cut off at the column's edge */
      return (
        <Table
          head={token.header.map((cell) => inline(cell.tokens, t))}
          rows={token.rows.map((row) => row.map((cell) => inline(cell.tokens, t)))}
          align={token.align}
          rowHeaders={false}
          wrap
          flat
          {...(t.table === undefined ? {} : { text: t.table })}
        />
      )
    }
    case 'hr':
      return <hr />
    case 'text':
      return <p>{inline(token.tokens ?? [token], t)}</p>
    case 'html':
      /* raw HTML is shown, never run */
      return <p>{token.text}</p>
    default:
      return inline([token], t)
  }
}

function inline(tokens: readonly Token[], t: MarkdownText): ReactNode {
  return tokens.map((token, i) => <Inline key={i} token={token} t={t} />)
}

/** Words, with the paths written into them that name code as the files they name. */
function Words({ text }: { text: string }): ReactNode {
  const { found, inLink } = useContext(Found)
  if (found === null || inLink) return text
  const parts: ReactNode[] = []
  let at = 0
  for (const match of text.matchAll(PLAIN_PATH)) {
    const named = found.get(match[0])
    if (named === undefined) continue
    const start = match.index
    if (start > at) parts.push(text.slice(at, start))
    parts.push(<CodeRef key={start} found={named} plain />)
    at = start + match[0].length
  }
  if (parts.length === 0) return text
  parts.push(text.slice(at))
  return parts
}

/** What is in backticks: the file it names, where it names one; otherwise code text. */
function Codespan({ text }: { text: string }) {
  const { found, inLink } = useContext(Found)
  const named = inLink ? undefined : found?.get(text)
  return named === undefined ? <Code>{text}</Code> : <CodeRef found={named} />
}

/** A link's words, where no name opens a file: a button can't be inside a link. */
function InLink({ children }: { children: ReactNode }) {
  const found = useContext(Found)
  const value = useMemo(() => ({ ...found, inLink: true }), [found])
  return <Found.Provider value={value}>{children}</Found.Provider>
}

function Inline({ token, t }: { token: Token; t: MarkdownText }): ReactNode {
  if (!known(token)) return token.raw
  switch (token.type) {
    case 'text':
      return token.tokens ? inline(token.tokens, t) : <Words text={decode(token.text)} />
    case 'escape':
      return decode(token.text)
    case 'strong':
      return <strong>{inline(token.tokens, t)}</strong>
    case 'em':
      return <em>{inline(token.tokens, t)}</em>
    case 'del':
      return <del>{inline(token.tokens, t)}</del>
    case 'codespan':
      return <Codespan text={decode(token.text)} />
    case 'br':
      return <br />
    case 'link': {
      const href = safeHref(token.href)
      if (!href) return inline(token.tokens, t)
      return (
        <a href={href} target="_blank" rel="noreferrer" title={token.title ?? undefined}>
          <InLink>{inline(token.tokens, t)}</InLink>
          <VisuallyHidden> {t.newTab}</VisuallyHidden>
        </a>
      )
    }
    case 'image':
      /* images from a message are not fetched; their words stand in */
      return token.text
    case 'html':
      return token.text
    case 'checkbox':
      return null
    default:
      return token.raw
  }
}

/* marked escapes text for HTML; we render text, so undo that */
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m)
