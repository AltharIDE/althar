/*
 * The command a run of the project runs, read for a person: the folder it
 * runs in (its leading `cd`), what it sets first (NAME=value), the program by
 * its own name (no ../../node_modules/.bin/ in front), what it is asked to do
 * (its words before the first option), and each option with its value. Only
 * how it reads: Copy still copies the command as it ran.
 */

export interface CommandOption {
  readonly flag: string
  readonly value?: string
  /** Written --flag=value, not --flag value. */
  readonly joined?: boolean
}

export interface ReadCommand {
  readonly dir?: string
  readonly env: ReadonlyArray<readonly [string, string]>
  readonly program: string
  /** Its words before the first option: dev, run dev. */
  readonly words: readonly string[]
  readonly options: readonly CommandOption[]
}

/** Its words: split on whitespace outside quotes and $( ). */
const wordsOf = (text: string): string[] => {
  const out: string[] = []
  let word = ''
  let quote: string | null = null
  let depth = 0
  for (const ch of text) {
    if (quote !== null) {
      word += ch
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
      word += ch
    } else if (ch === '(' || ch === ')') {
      depth += ch === '(' ? 1 : -1
      word += ch
    } else if (/\s/.test(ch) && depth <= 0) {
      if (word !== '') out.push(word)
      word = ''
    } else word += ch
  }
  if (word !== '') out.push(word)
  return out
}

/** Its quotes off, where they hold the whole of it. */
const unquoted = (value: string) => (/^"[^"]*"$|^'[^']*'$/.test(value) ? value.slice(1, -1) : value)

const CD = /^cd\s+("[^"]*"|'[^']*'|\S+)\s*&&\s*/
const SETS = /^[A-Za-z_][A-Za-z0-9_]*=/
const BIN = /^(?:\.{1,2}\/)*(?:[\w.@-]+\/)*node_modules\/\.bin\//

export function readCommand(command: string): ReadCommand {
  let rest = command.trim()
  let dir: string | undefined
  const cd = CD.exec(rest)
  if (cd !== null) {
    dir = unquoted(cd[1] ?? '')
    rest = rest.slice(cd[0].length)
  }
  const words = wordsOf(rest)
  const env: Array<readonly [string, string]> = []
  while (words[0] !== undefined && SETS.test(words[0])) {
    const word = words.shift() ?? ''
    const at = word.indexOf('=')
    env.push([word.slice(0, at), unquoted(word.slice(at + 1))])
  }
  const program = (words.shift() ?? '').replace(BIN, '')
  const lead: string[] = []
  while (words[0] !== undefined && !words[0].startsWith('-')) lead.push(words.shift() ?? '')
  const options: CommandOption[] = []
  while (words.length > 0) {
    const word = words.shift() ?? ''
    const at = word.startsWith('--') ? word.indexOf('=') : -1
    if (at > 0) options.push({ flag: word.slice(0, at), value: word.slice(at + 1), joined: true })
    else if (words[0] !== undefined && !words[0].startsWith('-')) options.push({ flag: word, value: words.shift() ?? '' })
    else options.push({ flag: word })
  }
  return { ...(dir === undefined ? {} : { dir }), env, program, words: lead, options }
}

/** What it runs, at a glance, for a run with no name: vp dev, bun run dev. */
export const commandAtGlance = (command: string) => {
  const read = readCommand(command)
  return [read.program, ...read.words].join(' ') || command.trim()
}
