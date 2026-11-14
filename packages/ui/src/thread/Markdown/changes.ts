import { DiffLineKind } from '../../foundations/vocabulary'
import type { DiffLine } from '../Diff/Diff'
import { lexAll } from './lexed'

/*
 * A markdown file's change, for drawing it rendered: what the file is now,
 * with the blocks that are new marked and the text taken out put back where
 * it was, drawn as what it was. Read from a file's whole-file diff, which holds
 * every line of it, so nothing more is asked for.
 */

/** What a rendered file marks of its change, by top-level block (as Markdown's `from` and `to` count them). */
export interface MarkdownMarks {
  /** Blocks with a line the change added. */
  readonly added: ReadonlySet<number>
  /** What the change took out, as markdown, drawn before the block at that index; the index past the last is the end. */
  readonly removed: ReadonlyMap<number, readonly string[]>
}

/** A file as it is now, and what its change marks in it. */
export interface MarkedMarkdown {
  readonly source: string
  readonly marks: MarkdownMarks
}

const NOTHING: MarkdownMarks = { added: new Set(), removed: new Map() }

/** Where a diff holds its file whole: every line, from the first, so a block can be told from where it stands. */
const whole = (lines: readonly DiffLine[]): boolean => {
  let old = 0
  let now = 0
  for (const line of lines) {
    if (line.kind === DiffLineKind.Hunk) continue
    if (line.kind !== DiffLineKind.Added) {
      if (line.old !== old + 1) return false
      old = line.old
    }
    if (line.kind !== DiffLineKind.Removed) {
      if (line.new !== now + 1) return false
      now = line.new
    }
  }
  return true
}

const unCarriage = (text: string) => text.replace(/\r$/, '')

/** A reference definition's line: `[label]: target`, the label as a link names it. */
const DEFINITION = /^ {0,3}\[((?:[^\]\\]|\\.)+)\]:\s*\S/
const labelOf = (label: string) => label.replace(/\s+/g, ' ').trim().toLowerCase()
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether a block's text names a definition's label as a link: `[words][label]`, `[label][]` or `[label]`. */
const refersTo = (block: string, label: string): boolean => {
  const flat = block.replace(/\s+/g, ' ').toLowerCase()
  const name = escaped(label)
  return new RegExp(`\\]\\s?\\[${name}\\]|\\[${name}\\](?!\\()`).test(flat)
}

/** A removed run as markdown that can be read: a definition is no block of its own, so each is shown as the line it was. */
const showingDefinitions = (lines: readonly string[]): string => {
  // What is inside a fenced block is code, whatever it looks like; only a definition outside any is shown as the line it was.
  let fence: { readonly mark: string; readonly size: number } | null = null
  return lines
    .map((line) => {
      const edge = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
      if (fence !== null) {
        if (edge !== undefined && edge[0] === fence.mark && edge.length >= fence.size && line.trim() === edge) fence = null
        return line
      }
      if (edge !== undefined) {
        fence = { mark: edge[0] ?? '`', size: edge.length }
        return line
      }
      if (!DEFINITION.test(line)) return line
      const ticks = line.includes('`')
      return `${ticks ? '`` ' : '`'}${line.trim()}${ticks ? ' ``' : '`'}`
    })
    .join('\n')
}

/** The file as it is now, from a diff of the whole of it: its context and added lines. */
export const newTextOf = (lines: readonly DiffLine[]): string =>
  lines
    .flatMap((line) => (line.kind === DiffLineKind.Context || line.kind === DiffLineKind.Added ? [unCarriage(line.text)] : []))
    .join('\n')

/**
 * A whole-file diff as the file now and its marks (none for a file that is new, which is all added): the blocks with an added line, and each run of removed lines at
 * the block it stood before. Null for a diff cut into hunks, whose lines don't say where a block stands.
 */
export const markChanges = (lines: readonly DiffLine[]): MarkedMarkdown | null => {
  if (!whole(lines)) return null
  const source = newTextOf(lines)
  const added = new Set<number>()
  const runs: Array<{ after: number; text: string[] }> = []
  let latest = 0
  let run: { after: number; text: string[] } | null = null
  const addedLines = new Set<number>()
  // The labels of the definitions an edit touched: a link through one reads another page now, though its own words stand.
  const touched = new Set<string>()
  for (const line of lines) {
    if (line.kind === DiffLineKind.Hunk) continue
    if (line.kind === DiffLineKind.Removed) {
      if (run === null) {
        run = { after: latest, text: [] }
        runs.push(run)
      }
      run.text.push(unCarriage(line.text))
      const gone = DEFINITION.exec(line.text)
      if (gone?.[1] !== undefined) touched.add(labelOf(gone[1]))
      continue
    }
    run = null
    latest = line.new
    if (line.kind === DiffLineKind.Added) {
      addedLines.add(line.new)
      const now = DEFINITION.exec(line.text)
      if (now?.[1] !== undefined) touched.add(labelOf(now[1]))
    }
  }
  if (addedLines.size === 0 && runs.length === 0) return { source, marks: NOTHING }
  // A file that is new has nothing to tell its change from: the list says it is new, and the page reads as a page.
  if (runs.length === 0 && lines.every((line) => line.kind === DiffLineKind.Hunk || line.kind === DiffLineKind.Added))
    return { source, marks: NOTHING }
  // Where each block starts and ends, in lines of the file; read as marked reads it, which spells the file out.
  const tokens = lexAll(source).tokens
  if (tokens.map((token) => token.raw).join('') !== source) return { source, marks: NOTHING }
  const starts: number[] = []
  let row = 1
  const blockLines: Array<{ from: number; to: number }> = []
  for (const token of tokens) {
    const to = row + token.raw.split('\n').length - (token.raw.endsWith('\n') ? 2 : 1)
    if (token.type !== 'space' && token.type !== 'def') {
      starts.push(row)
      blockLines.push({ from: row, to })
    }
    row += token.raw.split('\n').length - 1
  }
  blockLines.forEach(({ from, to }, index) => {
    for (let n = from; n <= to; n++) {
      if (addedLines.has(n)) {
        added.add(index)
        break
      }
    }
  })
  // A block that links through a definition the edit touched is marked, so the change reaches the page where the link is.
  if (touched.size > 0) {
    let block = 0
    for (const token of tokens) {
      if (token.type === 'space' || token.type === 'def') continue
      if (!added.has(block) && [...touched].some((label) => refersTo(token.raw, label))) added.add(block)
      block += 1
    }
  }
  const removed = new Map<number, string[]>()
  for (const { after, text } of runs) {
    // Before the first block that starts past the line it follows; after the block it is in the middle of.
    const found = starts.findIndex((start) => start > after)
    const index = found === -1 ? starts.length : found
    removed.set(index, [...(removed.get(index) ?? []), showingDefinitions(text)])
  }
  return { source, marks: { added, removed } }
}

/* ——— Paths a file names ——— */

/** Whether a link or an image names a path beside the file: not an address, not the page's own anchor, nor from the root. */
export const isRelative = (href: string): boolean =>
  href !== '' && !href.startsWith('#') && !href.startsWith('/') && !href.startsWith('\\') && !/^[a-z][a-z0-9+.-]*:/i.test(href)

/**
 * The path a link or an image in a file names, from the top of its repository: the file's folder and the link's own
 * path, its `./` and `../` followed, its query and anchor cut off. Null where it climbs above the top, or names none.
 */
export const resolvePath = (folder: string, href: string): string | null => {
  if (!isRelative(href)) return null
  const bare = href.replace(/[?#].*$/, '')
  let decoded = bare
  try {
    decoded = decodeURIComponent(bare)
  } catch {
    // Left as written: a stray % is part of the name.
  }
  const parts = folder === '' ? [] : folder.split('/')
  for (const part of decoded.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else parts.push(part)
  }
  return parts.length === 0 ? null : parts.join('/')
}

/** The folder a file is in, from the top of its repository: empty at the top. */
export const folderOfPath = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')))

/** Whether a path is a markdown file, as the window opens it rendered. */
export const isMarkdownPath = (path: string): boolean => /\.(md|markdown)$/i.test(path)
