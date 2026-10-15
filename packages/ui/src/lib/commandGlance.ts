/*
 * A command as a card shows it at a glance: its first command or two, and a
 * line saying what is left out. The command itself is never changed; the
 * thread's permission card keeps every line, to read before allowing.
 */

export interface CommandGlance {
  /** The commands to show, one per line, each cut short where it is long. */
  lines: readonly string[]
  /** What the lines leave out, where they leave anything: "and 2 more · 41 lines in all". */
  summary: string | null
}

export interface GlanceWords {
  more: (n: number) => string
  lines: (n: number) => string
  characters: (n: number) => string
}

export const glanceWords: GlanceWords = {
  more: (n) => `and ${n} more`,
  lines: (n) => `${n} lines in all`,
  characters: (n) => `${n} characters in all`,
}

const SHOWN = 2
const WIDTH = 96

interface Statement {
  text: string
  /** Lines of a heredoc's body, left out. */
  body: number
}

const HEREDOC = /<<-?\s*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_][\w]*))/

/** The statements of a script: a line each, a heredoc's body folded into the line that opens it, and `&&`, `||` and `;` outside quotes ending one. */
export const statementsOf = (script: string): Statement[] => {
  const out: Statement[] = []
  const rows = script.replaceAll('\r\n', '\n').split('\n')
  for (let row = 0; row < rows.length; row += 1) {
    const line = rows[row] ?? ''
    const found = HEREDOC.exec(line)
    let body = 0
    if (found !== null) {
      const end = found[1] ?? found[2] ?? found[3] ?? ''
      let next = row + 1
      while (next < rows.length && (rows[next] ?? '').trim() !== end) next += 1
      body = next - row - 1
      row = Math.min(next, rows.length - 1)
    }
    const parts = splitLine(line)
    parts.forEach((text, index) => {
      if (text !== '') out.push({ text, body: index === parts.length - 1 ? body : 0 })
    })
  }
  return out
}

/** One line cut at `&&`, `||` and `;` that are not quoted. */
const splitLine = (line: string): string[] => {
  const parts: string[] = []
  let quote = ''
  let start = 0
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i] ?? ''
    if (quote !== '') {
      if (c === '\\' && quote === '"') i += 1
      else if (c === quote) quote = ''
    } else if (c === '\\') i += 1
    else if (c === "'" || c === '"') quote = c
    else if (c === ';' || ((c === '&' || c === '|') && line[i + 1] === c)) {
      parts.push(line.slice(start, i).trim())
      i += c === ';' ? 0 : 1
      start = i + 1
    }
  }
  parts.push(line.slice(start).trim())
  return parts.filter((part) => part !== '')
}

/** A leading `cd dir &&` is left out, as it only says where; any `cd` joined with `||`, or after another command, stays. */
const dropLeadingCd = (all: Statement[], whole: string): Statement[] => {
  const first = all[0]
  if (first === undefined || all.length < 2 || !/^(cd|pushd)\s/.test(first.text)) return all
  const after = whole.slice(whole.indexOf(first.text) + first.text.length).trimStart()
  return after.startsWith('||') ? all : all.slice(1)
}

const cut = (text: string) => (text.length > WIDTH ? `${text.slice(0, WIDTH - 1).trimEnd()}…` : text)

/** A command as a card shows it at a glance; `command` is the shortened form (`label`) where the runtime gave one. */
export function commandGlance(command: string, words: Partial<GlanceWords> = {}): CommandGlance {
  const w = { ...glanceWords, ...words }
  const whole = command.trim()
  const statements = dropLeadingCd(statementsOf(whole), whole)
  if (statements.length === 0) return { lines: [cut(whole)], summary: null }
  const shown = statements.slice(0, SHOWN)
  const lines = shown.map((one) => cut(one.body > 0 ? `${one.text} …` : one.text))
  const clipped = shown.some((one) => one.text.length > WIDTH)
  const rest = statements.length - shown.length
  const rows = whole.split('\n').length
  const parts = [...(rest > 0 ? [w.more(rest)] : []), ...(rows > 3 ? [w.lines(rows)] : clipped ? [w.characters(whole.length)] : [])]
  return { lines, summary: parts.length === 0 ? null : parts.join(' · ') }
}
