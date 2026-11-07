/*
 * Markdown cut off mid-stream, as it can be shown without flickering.
 *
 * Shown as it is, half-written markdown changes its mind as it grows: `**`
 * shows as two stars until its word is closed, a lone `-` under a line
 * makes that line a heading for a moment, a table's first row is a
 * paragraph of pipes until the row under it arrives. So, as Codex's
 * terminal does (codex-rs/tui/src/streaming: a table's rows held until its
 * header is confirmed, a line that is only a list's marker held back, link
 * destinations held until they close), what would change its mind is held
 * back until it can't, and a mark left open is closed for now, so a word
 * shows bold as it is written. Inside a code fence left open nothing is
 * changed: marked reads it as code to the end, as it will be.
 */

const FENCE = /^ {0,3}(`{3,}|~{3,})/
/** A line that is all it takes to start something, or that could still become one: held back until the next line starts. */
const UNSURE = [
  // a list's marker, a quote's, a heading's, alone
  /^\s*([-*+]|\d+[.)]?)\s*$/,
  /^\s*>\s*$/,
  /^\s*#{1,6}\s*$/,
  // a rule or a heading's underline, which could make the line before it a heading
  /^\s*[-=*_]+\s*$/,
  // a fence's first line, its language still coming
  /^ {0,3}(`{1,}|~{1,})[^`\s]*$/,
]
const TABLE_ROW = /^\s*\|/

/** Whether the text ends inside a code fence that hasn't closed. */
export const inOpenFence = (text: string): boolean => {
  let open: string | null = null
  for (const line of text.split('\n')) {
    const fence = FENCE.exec(line)?.[1]
    if (fence === undefined) continue
    if (open === null) open = fence
    else if (fence[0] === open[0] && fence.length >= open.length && line.trim() === fence) open = null
  }
  return open !== null
}

/** The text without the lines a table is still being started with: its rows until the rule under its first one arrives. */
const withoutUnsureTable = (lines: ReadonlyArray<string>): ReadonlyArray<string> => {
  let start = lines.length
  while (start > 0 && TABLE_ROW.test(lines[start - 1] ?? '')) start -= 1
  const rows = lines.slice(start)
  if (rows.length === 0) return lines
  // A line after the rule under its header, and it is sure, a table or not: only its header and its rule still being written wait.
  return rows.length >= 3 ? lines : lines.slice(0, start)
}

/**
 * The marks left open in a paragraph's text, in the order they were opened:
 * `**`, `*` and `~~` outside code, and a code span's backtick. One opened at
 * the very end, with nothing after it yet, is dropped rather than closed.
 */
const openMarks = (text: string): { readonly marks: ReadonlyArray<string>; readonly dangling: number } => {
  const marks: Array<{ readonly mark: string; readonly at: number }> = []
  for (let at = 0; at < text.length; at++) {
    const char = text[at]
    if (char === '\\') {
      at += 1
      continue
    }
    if (char === '`') {
      let run = 1
      while (text[at + run] === '`') run += 1
      const close = text.indexOf('`'.repeat(run), at + run)
      if (close === -1) {
        marks.push({ mark: '`'.repeat(run), at })
        break
      }
      at = close + run - 1
      continue
    }
    const two = text.slice(at, at + 2)
    if (two === '**' || two === '~~') {
      const top = marks.at(-1)
      if (top?.mark === two) marks.pop()
      else marks.push({ mark: two, at })
      at += 1
      continue
    }
    if (char === '*') {
      const top = marks.at(-1)
      // A list's marker isn't emphasis, however far in; nor is a star with space after it.
      const marker = text.slice(text.lastIndexOf('\n', at - 1) + 1, at).trim() === ''
      if (top?.mark === '*') marks.pop()
      else if (!marker && /\S/.test(text[at + 1] ?? ' ')) marks.push({ mark: '*', at })
    }
  }
  const last = marks.at(-1)
  const dangling = last !== undefined && last.at + last.mark.length === text.length ? last.mark.length : 0
  return { marks: (dangling > 0 ? marks.slice(0, -1) : marks).map((one) => one.mark), dangling }
}

/**
 * The text with a link still being written at its end cut to its words: `[words`, `[words]` and `[words](address` show
 * their words, and the address waits until it closes. The first `[` on the last line that starts one is the one; read in
 * one pass, as a pattern for it would take time growing with the square of a long line of brackets.
 */
const withoutOpenLink = (text: string): string => {
  const lastParen = text.lastIndexOf(')')
  for (let at = text.indexOf('[', text.lastIndexOf('\n') + 1); at !== -1;) {
    const close = text.indexOf(']', at + 1)
    if (close === -1) return text.slice(0, at) + text.slice(at + 1)
    // Its words closed, at the very end or with an address opened after them that hasn't closed.
    if (close === text.length - 1 || (text[close + 1] === '(' && lastParen < close + 2))
      return text.slice(0, at) + text.slice(at + 1, close)
    // Every `[` before this `]` closes on it: the next to try is after it.
    at = text.indexOf('[', close + 1)
  }
  return text
}

/** Markdown cut off mid-stream, as it can be shown now: what would change its mind held back, what is open closed for now. */
export const streamable = (text: string): string => {
  if (inOpenFence(text)) {
    // Only the fence's first line, its language still coming, or a line that may be its close, half-written, waits.
    const cut = text.lastIndexOf('\n')
    const end = text.slice(cut + 1)
    if (!inOpenFence(text.slice(0, cut + 1))) return text.slice(0, Math.max(cut, 0))
    return /^ {0,3}(`{1,}|~{1,})\s*$/.test(end) ? text.slice(0, cut + 1) : text
  }
  const lines = text.split('\n')
  const end = lines.at(-1) ?? ''
  const held = UNSURE.some((pattern) => pattern.test(end)) ? lines.slice(0, -1) : lines
  const sure = withoutUnsureTable(held).join('\n')
  // The paragraph being written: marks open in it are closed for now.
  const blank = sure.lastIndexOf('\n\n')
  const start = blank === -1 ? 0 : blank + 2
  const paragraph = sure.slice(start)
  if (TABLE_ROW.test(paragraph) || /^ {4}|^\t/.test(paragraph)) return sure
  const linked = withoutOpenLink(paragraph)
  const { marks, dangling } = openMarks(linked)
  const kept = dangling > 0 ? linked.slice(0, linked.length - dangling) : linked
  return sure.slice(0, start) + kept + [...marks].reverse().join('')
}
