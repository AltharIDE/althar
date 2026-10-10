import { Lexer, type MarkedToken, type Token } from 'marked'
import { useMemo, type ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { safeHref } from '../../lib/safeHref'
import { Code } from '../../primitives/Code/Code'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { Table, type TableText } from '../Table/Table'
import s from './Markdown.module.css'

/*
 * Markdown as agents write it: GitHub-flavoured, parsed by marked's lexer
 * and drawn as our own elements. Nothing is inserted as HTML: raw HTML in
 * the source shows as text, and a link is a link only when it is http or
 * https. The reading voice of the thread, a size down.
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

/** How long a cell's text may be before a table's cells wrap rather than keep to one line. */
const LONG_CELL = 48

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

export function Markdown({ source, from = 0, to, size = 'thread', headingLevel = 3, text, className, ...rest }: MarkdownProps) {
  const t = { ...markdownText, ...text }
  const blocks = useMemo(() => Lexer.lex(source).filter((b) => b.type !== 'space' && b.type !== 'def'), [source])
  return (
    <div className={cx(s.md, size === 'panel' && s.panel, className)} {...rest}>
      {blocks.slice(from, to).map((b, i) => (
        <Block key={i} token={b} base={headingLevel} t={t} />
      ))}
    </div>
  )
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
      return (
        <pre>
          <code>{token.text}</code>
        </pre>
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
      /* the kit's table: it scrolls sideways, and sentences in its cells wrap */
      const long = [token.header, ...token.rows].some((row) => row.some((cell) => cell.text.length > LONG_CELL))
      return (
        <Table
          head={token.header.map((cell) => inline(cell.tokens, t))}
          rows={token.rows.map((row) => row.map((cell) => inline(cell.tokens, t)))}
          align={token.align}
          rowHeaders={false}
          wrap={long}
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

function Inline({ token, t }: { token: Token; t: MarkdownText }): ReactNode {
  if (!known(token)) return token.raw
  switch (token.type) {
    case 'text':
      return token.tokens ? inline(token.tokens, t) : decode(token.text)
    case 'escape':
      return decode(token.text)
    case 'strong':
      return <strong>{inline(token.tokens, t)}</strong>
    case 'em':
      return <em>{inline(token.tokens, t)}</em>
    case 'del':
      return <del>{inline(token.tokens, t)}</del>
    case 'codespan':
      return <Code>{decode(token.text)}</Code>
    case 'br':
      return <br />
    case 'link': {
      const href = safeHref(token.href)
      if (!href) return inline(token.tokens, t)
      return (
        <a href={href} target="_blank" rel="noreferrer" title={token.title ?? undefined}>
          {inline(token.tokens, t)}
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
