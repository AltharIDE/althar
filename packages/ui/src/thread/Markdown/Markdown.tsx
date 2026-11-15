import { Lexer, type MarkedToken, type Token } from 'marked'
import { createContext, Fragment, memo, useContext, useMemo, useState, type ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { usePacedText } from '../../lib/pace'
import type { RootProps } from '../../lib/props'
import { safeHref } from '../../lib/safeHref'
import { Code } from '../../primitives/Code/Code'
import type { CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { type FoundCode, mayBeCode, PLAIN_PATH } from '../Code/code'
import { CodeRef } from '../Code/CodeRef'
import { type CodeShell, useThreadShell } from '../Shell/Shell'
import { Table, type TableText } from '../Table/Table'
import { closedFence, isDiagram } from './drawing'
import { Fresh, FreshWhole, useFreshly, useFreshness } from './fresh'
import { isRelative, type MarkdownMarks, resolvePath } from './changes'
import { CodeBlock, Diagram, type DiagramText } from './Diagram'
import { blocksOf, type Lexed, lexAll, lexOn } from './lexed'
import s from './Markdown.module.css'
import { streamable } from './streaming'

/*
 * Markdown as agents write it: GitHub-flavoured, parsed by marked's lexer
 * and drawn as our own elements. Nothing is inserted as HTML: raw HTML in
 * the source shows as text, and a link is a link only when it is http or
 * https. The reading voice of the thread, a size down. Where the thread's
 * host finds code (ThreadShell's code), the names in it that name code (a
 * path in backticks, a name in code, a path written into the words) are
 * the files they name, to peek at and open. A ```mermaid block is drawn
 * (Diagram), mermaid fetched the first time one shows.
 *
 * A file's markdown (`file`) knows where it is: a relative image is drawn
 * by the host, and a relative link opens the file it names, both from the
 * file's folder. With `marks`, what a change added is tinted, and what it
 * took out is drawn where it stood, as it was (changes.ts).
 *
 * Still being written (`streaming`), it is shown at an even pace
 * (lib/pace), its newest words fading in (fresh.tsx), and without what
 * would change its mind as it grows (streaming.ts); a block read and drawn
 * already isn't read or drawn again for the next words, only the one they
 * are in (lexed.ts).
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
  /** A ```mermaid block's, drawn. */
  diagram?: Partial<DiagramText>
  /** What a change marks, for a screen reader: blocks it added, and text it took out. */
  added: string
  removed: string
}

export const markdownText: MarkdownText = {
  newTab: '(opens in a new tab)',
  done: 'done',
  notDone: 'not done',
  added: 'Added',
  removed: 'Removed',
}

/** Where a file's markdown is, so what it names beside it can be found: the host draws its images and opens its links. */
export interface MarkdownFile {
  /** The file's folder, from the top of its repository: empty at the top. */
  readonly folder: string
  /** Draws an image the file names, by its path from the top of its repository; without it, an image's words stand in. */
  readonly image?: (image: { readonly path: string; readonly alt: string; readonly title?: string }) => ReactNode
  /** Opens a file the file links to, by its path from the top of its repository; without it, such a link is only its words. */
  readonly open?: (path: string) => void
}

const FileContext = createContext<MarkdownFile | null>(null)

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
    /** Still being written: shown at an even pace as it grows, and whole at once when it stops being. */
    streaming?: boolean
    /** The markdown is a file, beside what it names. */
    file?: MarkdownFile
    /** What a change marks in it, by block. */
    marks?: MarkdownMarks
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

export function Markdown({
  source,
  from = 0,
  to,
  size = 'thread',
  headingLevel = 3,
  streaming = false,
  file,
  marks,
  text,
  className,
  ...rest
}: MarkdownProps) {
  const t = useMemo(() => ({ ...markdownText, ...text }), [text])
  const paced = usePacedText(source, streaming)
  const shown = streaming ? streamable(paced) : source
  const fresh = useFreshness(shown, streaming ? paced : source, streaming)
  // Streaming, read on from where it was settled; else whole.
  const [lexed, setLexed] = useState<Lexed | null>(null)
  const read = !streaming ? null : lexed !== null && lexed.text === shown ? lexed : lexOn(shown, lexed)
  if (read !== null && read !== lexed) setLexed(read)
  const whole = useMemo(() => (streaming ? null : lexAll(shown)), [streaming, shown])
  const doc = read ?? whole ?? lexAll(shown)
  fresh?.place(doc.tokens)
  const blocks = useMemo(() => blocksOf(doc.tokens), [doc])
  const code = useThreadShell().code
  const finds = code !== undefined
  // The names in what is still being written are looked for once its words are whole, as each block is: a path half-written
  // names nothing. So they are read again only as a block settles.
  const named = read === null ? blocks : read.settled
  const names = useMemo(() => (finds ? codeNamesIn(blocksOf(named).slice(from, to)) : []), [finds, named, from, to])
  const drawn =
    marks === undefined ? (
      blocks.slice(from, to).map((b, i) => <Block key={i} token={b} defs={doc.defs} base={headingLevel} t={t} />)
    ) : (
      <Marked blocks={blocks} from={from} to={to} marks={marks} defs={doc.defs} base={headingLevel} t={t} />
    )
  return (
    <div data-thread-preview="" className={cx(s.md, size === 'panel' && s.panel, className)} aria-busy={streaming || undefined} {...rest}>
      <Fresh.Provider value={fresh}>
        <FileContext.Provider value={file ?? null}>
          {code !== undefined && names.length > 0 ? (
            <WithCode code={code} names={names}>
              {drawn}
            </WithCode>
          ) : (
            drawn
          )}
        </FileContext.Provider>
      </Fresh.Provider>
    </div>
  )
}

interface MarkedProps {
  readonly blocks: readonly Token[]
  readonly from: number
  readonly to: number | undefined
  readonly marks: MarkdownMarks
  readonly defs: string
  readonly base: HeadingLevel
  readonly t: MarkdownText
}

/**
 * Blocks with what a change marks: runs of added blocks in one tint, and what was taken out, drawn before the block it
 * stood at, as it was. Each run is a group with its name for a screen reader; the sign in its margin is for those who
 * don't tell the tints apart.
 */
function Marked({ blocks, from, to, marks, defs, base, t }: MarkedProps) {
  const end = to === undefined ? blocks.length : Math.min(to, blocks.length)
  const out: ReactNode[] = []
  let run: ReactNode[] = []
  let runKey = 0
  const flush = () => {
    if (run.length === 0) return
    out.push(
      <div key={`+${runKey}`} className={s.added} data-change="added" role="group" aria-label={t.added}>
        {run}
      </div>,
    )
    run = []
  }
  for (let at = from; at <= end; at++) {
    const taken = marks.removed.get(at)
    // Past the last block shown, only what was taken out at its end.
    if (taken !== undefined && (at < end || end === blocks.length)) {
      flush()
      taken.forEach((text, i) => out.push(<Removed key={`-${at}.${i}`} text={text} base={base} t={t} />))
    }
    const block = blocks[at]
    if (at === end || block === undefined) break
    const element = <Block key={at} token={block} defs={defs} base={base} t={t} />
    if (marks.added.has(at)) {
      if (run.length === 0) runKey = at
      run.push(element)
    } else {
      flush()
      out.push(element)
    }
  }
  flush()
  return <>{out}</>
}

/** Text a change took out, as it was. */
function Removed({ text, base, t }: { text: string; base: HeadingLevel; t: MarkdownText }) {
  const doc = useMemo(() => lexAll(text), [text])
  return (
    <div className={s.removed} data-change="removed" role="group" aria-label={t.removed}>
      {blocksOf(doc.tokens).map((token, i) => (
        <Block key={i} token={token} defs={doc.defs} base={base} t={t} />
      ))}
    </div>
  )
}

/** The text's blocks, with what the host found its names name. */
function WithCode({ code, names, children }: { code: CodeShell; names: readonly string[]; children: ReactNode }) {
  const found = code.useFound(names) ?? null
  const value = useMemo(() => ({ found, inLink: false }), [found])
  return <Found.Provider value={value}>{children}</Found.Provider>
}

interface BlockProps {
  readonly token: Token
  /** The definitions the text's links were read with (lexed.ts): where they change, a link may now go somewhere. */
  readonly defs: string
  readonly base: HeadingLevel
  readonly t: MarkdownText
}

/**
 * A block, drawn again only when what it is read from changed: the words still streaming in redraw the block they are in. The
 * same source of the same kind, read with the same definitions, reads the same.
 */
const Block = memo(
  function Block(props: BlockProps): ReactNode {
    return <BlockOf {...props} />
  },
  (before, after) =>
    before.defs === after.defs &&
    before.base === after.base &&
    before.t === after.t &&
    (before.token === after.token || (before.token.type === after.token.type && before.token.raw === after.token.raw)),
)

function BlockOf({ token, defs, base, t }: BlockProps): ReactNode {
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
            c.type === 'text' ? (
              <span key={j}>{inline(c.tokens ?? [c], t)}</span>
            ) : (
              <Block key={j} token={c} defs={defs} base={base} t={t} />
            ),
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
      return isDiagram(token.lang) ? (
        <Diagram source={token.text} done={closedFence(token.raw)} text={t.diagram} copy={t.copy} />
      ) : (
        <CodeBlock text={token.text} copy={t.copy} />
      )
    case 'blockquote':
      return (
        <blockquote>
          {token.tokens.map((c, j) => (
            <Block key={j} token={c} defs={defs} base={base} t={t} />
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

/** Words, with the paths written into them that name code as the files they name; those that came in lately fading in. */
function Words({ text, token }: { text: string; token: Token }): ReactNode {
  const { found, inLink } = useContext(Found)
  const freshly = useFreshly(token)
  if (found === null || inLink) return freshly(text)
  const parts: ReactNode[] = []
  let at = 0
  for (const match of text.matchAll(PLAIN_PATH)) {
    const named = found.get(match[0])
    if (named === undefined) continue
    const start = match.index
    if (start > at) parts.push(<Fragment key={`w${at}`}>{freshly(text.slice(at, start), at)}</Fragment>)
    parts.push(<CodeRef key={start} found={named} plain />)
    at = start + match[0].length
  }
  if (parts.length === 0) return freshly(text)
  parts.push(<Fragment key={`w${at}`}>{freshly(text.slice(at), at)}</Fragment>)
  return parts
}

/** What is in backticks: the file it names, where it names one; otherwise code text. */
function Codespan({ text }: { text: string }) {
  const { found, inLink } = useContext(Found)
  const named = inLink ? undefined : found?.get(text)
  return named === undefined ? <Code>{text}</Code> : <CodeRef found={named} />
}

/** A link's words, where no name opens a file: a button can't be inside a link. */
/**
 * A link in a message: where the thread's host takes links, a plain press
 * opens it as the host chooses (beside the conversation, or in the person's
 * browser); with a modifier, or any other button, it opens in a new tab.
 */
function Link({ href, title, newTab, children }: { href: string; title: string | undefined; newTab: string; children: ReactNode }) {
  const { openLink, linkNote } = useThreadShell()
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      onClick={(event) => {
        if (openLink === undefined || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        openLink(href)
      }}
    >
      <InLink>{children}</InLink>
      <VisuallyHidden> {openLink === undefined ? newTab : (linkNote ?? newTab)}</VisuallyHidden>
    </a>
  )
}

/** A link to a file beside this one, where the host opens files; otherwise only its words. */
function FileLink({ href, title, children }: { href: string; title: string | undefined; children: ReactNode }) {
  const file = useContext(FileContext)
  const path = file?.open === undefined || !isRelative(href) ? null : resolvePath(file.folder, href)
  const open = file?.open
  if (path === null || open === undefined) return children
  return (
    <button type="button" className={s.fileLink} title={title ?? path} onClick={() => open(path)}>
      <InLink>{children}</InLink>
    </button>
  )
}

/** An image the file names beside it, as the host draws it; otherwise its words. */
function Picture({ href, alt, title }: { href: string; alt: string; title: string | undefined }) {
  const file = useContext(FileContext)
  const path = file?.image === undefined || !isRelative(href) ? null : resolvePath(file.folder, href)
  if (path === null || file?.image === undefined) return alt
  return <>{file.image({ path, alt, ...(title === undefined ? {} : { title }) })}</>
}

function InLink({ children }: { children: ReactNode }) {
  const found = useContext(Found)
  const value = useMemo(() => ({ ...found, inLink: true }), [found])
  return <Found.Provider value={value}>{children}</Found.Provider>
}

function Inline({ token, t }: { token: Token; t: MarkdownText }): ReactNode {
  if (!known(token)) return token.raw
  switch (token.type) {
    case 'text':
      return token.tokens ? inline(token.tokens, t) : <Words text={decode(token.text)} token={token} />
    case 'escape':
      return <FreshWhole token={token}>{decode(token.text)}</FreshWhole>
    case 'strong':
      return <strong>{inline(token.tokens, t)}</strong>
    case 'em':
      return <em>{inline(token.tokens, t)}</em>
    case 'del':
      return <del>{inline(token.tokens, t)}</del>
    case 'codespan':
      return (
        <FreshWhole token={token}>
          <Codespan text={decode(token.text)} />
        </FreshWhole>
      )
    case 'br':
      return <br />
    case 'link': {
      const href = safeHref(token.href)
      if (!href)
        return (
          <FileLink href={token.href} title={token.title ?? undefined}>
            {inline(token.tokens, t)}
          </FileLink>
        )
      return (
        <Link href={href} title={token.title ?? undefined} newTab={t.newTab}>
          {inline(token.tokens, t)}
        </Link>
      )
    }
    case 'image':
      /* images are not fetched; their words stand in, unless the host draws one the file names beside it */
      return <Picture href={token.href} alt={token.text} title={token.title ?? undefined} />
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
