import type { System } from './ruleContext'

// ---- Reading commands ------------------------------------------------------

export interface Parsed {
  /** Each command, as its words, in the order the shell would run them. */
  readonly commands: ReadonlyArray<ReadonlyArray<string>>
  /** The text has parts the shell works out only when it runs: `$(…)`, backticks, `eval`. */
  readonly opaque: boolean
  /** For each command, the subshells it starts before it and ends after it, where a `cd` holds only inside. */
  readonly scopes?: ReadonlyArray<Scope>
}

/**
 * How a command runs: the subshells it starts and ends (`(cd x`, `ls)`, a
 * script handed to a shell, a side of a pipe), and whether it runs at all.
 * One that `keeps` may keep its `cd` or not: zsh runs a pipe's last side in
 * the shell itself, bash in a subshell.
 */
interface Scope {
  readonly opens: number
  readonly closes: number
  readonly keeps?: boolean
  /** It runs only where the one before succeeded (`&&`) or failed (`||`). */
  readonly joined?: '&&' | '||'
  /** It's inside an `if`, a loop, a `case` or a function: it may never run. */
  readonly maybe?: boolean
  /** It's inside a loop or a function: it may run many times. */
  readonly repeats?: boolean
  /** It's inside a function, which may run whenever it's called, later in the line. */
  readonly called?: boolean
}

export const NO_SCOPE: Scope = { opens: 0, closes: 0 }

/** The subshells a command as written starts and ends with its parentheses: `( cd x`, `then (rm`, `ls )`, `(ls)`. */
const scopeOf = (words: ReadonlyArray<string>): Scope => {
  let opens = 0
  for (const word of words) {
    if (SHELL_KEYWORDS.includes(word)) continue
    const leading = /^\(*/.exec(word)?.[0].length ?? 0
    opens += leading
    if (leading === 0 || leading < word.length) break
  }
  let closes = 0
  for (const word of [...words].reverse()) {
    const trailing = /\)*$/.exec(word)?.[0].length ?? 0
    // `"$(pwd))"`: a parenthesis the word opens itself takes one of its own.
    const own =
      word
        .slice(0, word.length - trailing)
        .replace(/^\(+/, '')
        .split('(').length - 1
    closes += Math.max(0, trailing - own)
    if (trailing === 0 || trailing < word.length) break
  }
  return { opens, closes }
}

/** Scopes for commands run inside one more of them, with a command's own around them all: what runs them runs only as it does. */
const wrapped = (scopes: ReadonlyArray<Scope>, own: Scope, extra: number): Array<Scope> =>
  scopes.map((scope, index) => ({
    ...scope,
    opens: scope.opens + (index === 0 ? own.opens + extra : 0),
    closes: scope.closes + (index === scopes.length - 1 ? own.closes + extra : 0),
    ...(scope.keeps === true || (index === scopes.length - 1 && own.keeps === true) ? { keeps: true } : {}),
    ...(index === 0 && own.joined !== undefined ? { joined: own.joined } : {}),
    ...(own.maybe === true ? { maybe: true } : {}),
    ...(own.repeats === true ? { repeats: true } : {}),
    ...(own.called === true ? { called: true } : {}),
  }))

/** What opens and closes a compound command, which may run what's in it never, once or many times. */
const OPENS = ['if', 'while', 'until', 'for', 'select', 'case']

const CLOSES = ['fi', 'done', 'esac', '}']

const LOOPS = ['while', 'until', 'for', 'select', 'function']

/** Where a command stands among the compound commands of its line. */
interface Block {
  /** Where what it runs starts, past a function's name or a `case`'s pattern, which aren't commands: `f() { rm …`, `a) rm …`. */
  readonly start: number
  readonly maybe: boolean
  readonly repeats: boolean
  readonly called: boolean
  /** It's a part of a `case`'s pattern, `a|b)`, whose `|` is no pipe. */
  readonly pattern: boolean
}

/** Each command's place among the `if`s, loops, `case`s, groups and functions of its line, by the words that open and close them. */
const blocksOf = (commands: ReadonlyArray<ReadonlyArray<string>>, ends: ReadonlyArray<string>): Array<Block> => {
  const open: Array<string> = []
  // A `case`'s pattern comes after its `in`, after `;;`, and after a `|` in a pattern.
  let patternNext = false
  return commands.map((words, at) => {
    let index = 0
    let start = 0
    let pattern = false
    let atPattern = patternNext || [';;', ';;&'].includes(ends[at - 1] ?? '')
    patternNext = false
    // After a function's name, its `{` is its body's.
    let named = false
    while (index < words.length) {
      const word = (words[index] ?? '').replace(/^\(+/, '')
      if (atPattern && open.at(-1) === 'case' && word.replace(/\)+$/, '') !== 'esac') {
        atPattern = false
        const taken = word.endsWith(')') ? 1 : words[index + 1] === ')' ? 2 : 0
        if (taken > 0) {
          index += taken
          start = index
          continue
        }
        if (ends[at] === '|') {
          pattern = true
          patternNext = true
          break
        }
      }
      if (CLOSES.includes(word.replace(/\)+$/, ''))) {
        open.pop()
        index += 1
        continue
      }
      if (OPENS.includes(word)) {
        open.push(word)
        index += 1
        if (word === 'case') {
          // `case x in`, then a pattern.
          index += 2
          start = index
          atPattern = true
          continue
        }
        if (word === 'for' || word === 'select') break
        continue
      }
      const head =
        word === 'function' ? 2 + (words[index + 2] === '()' ? 1 : 0) : /^[\w.:-]+\(\)$/.test(word) ? 1 : words[index + 1] === '()' ? 2 : 0
      if (head > 0) {
        open.push('function')
        index += head
        start = index
        named = true
        continue
      }
      if (word === '{') {
        if (!named) open.push('{')
        named = false
        index += 1
        continue
      }
      if (SHELL_KEYWORDS.includes(word)) {
        index += 1
        continue
      }
      break
    }
    // `case x in` at the end of a line: the pattern is on the next.
    if (atPattern) patternNext = true
    return {
      start,
      maybe: open.some((each) => each !== '{'),
      repeats: open.some((each) => LOOPS.includes(each)),
      called: open.includes('function'),
      pattern,
    }
  })
}

const SEPARATORS = [';;&', ';;', '&&', '||', ';', '|', '&', '\n']

export const REDIRECTS = ['>>', '&>', '2>', '>', '<']

/**
 * Splits a command line into commands and words, as a POSIX shell would for plain words, quotes and escapes. Each
 * command's redirects come after its other words (`redirectsLast`), so its first word is what it runs.
 */
export const parseCommandLine = (text: string): Parsed => {
  const { commands: written, operators: operating, opaque, ends } = splitCommandLine(text)
  const blocks = blocksOf(written, ends)
  // Without a function's name or a `case`'s pattern, keeping the parentheses before them: `(case x in a) rm …`.
  const commands = written.map((words, index) => {
    const start = blocks[index]?.start ?? 0
    if (start === 0 || start >= words.length) return { words, operators: operating[index] ?? new Set<number>() }
    const parens = scopeOf(words.slice(0, start)).opens
    const shift = (parens > 0 ? 1 : 0) - start
    return {
      words: [...(parens > 0 ? ['('.repeat(parens)] : []), ...words.slice(start)],
      operators: new Set([...(operating[index] ?? [])].filter((at) => at >= start).map((at) => at + shift)),
    }
  })
  const scopes = commands.map(({ words }, index): Scope => {
    const block = blocks[index]
    const before = ends[index - 1]
    const how: Scope = {
      // A line of only a `case`'s head or a pattern (`b)`) closes no subshell.
      ...(words === written[index] && (block?.start ?? 0) > 0 ? { opens: scopeOf(words).opens, closes: 0 } : scopeOf(words)),
      ...(before === '&&' || before === '||' ? { joined: before } : {}),
      ...(block?.maybe === true ? { maybe: true } : {}),
      ...(block?.repeats === true ? { repeats: true } : {}),
      ...(block?.called === true ? { called: true } : {}),
    }
    // Every side of a pipe but the last, and what runs in the background, runs in a subshell; zsh runs a pipe's last side in its own shell.
    if ((ends[index] === '|' && block?.pattern !== true) || ends[index] === '&')
      return { ...how, opens: how.opens + 1, closes: how.closes + 1 }
    if (before === '|' && blocks[index - 1]?.pattern !== true) return { ...how, opens: how.opens + 1, closes: how.closes + 1, keeps: true }
    return how
  })
  return expandShells(
    commands.map(({ words, operators }) => redirectsLast(words, operators).words),
    opaque,
    scopes,
  )
}

/**
 * A command's words with its redirects after the rest, as the shell reads them wherever they stand: `> /dev/null git
 * push` and `git > /dev/null push` both run `git push`, so every rule that reads what a command runs from its first
 * words reads it there. Only what the shell takes for a redirect moves, with the file or stream it names (`2>&1`), not
 * a quoted `'>'`. `at` says where each word went.
 */
export const redirectsLast = (words: ReadonlyArray<string>, operators: ReadonlySet<number>) => {
  const rest: Array<number> = []
  const moved: Array<number> = []
  for (let index = 0; index < words.length; index += 1) {
    if (!operators.has(index) || !REDIRECTS.includes(words[index] ?? '')) {
      rest.push(index)
      continue
    }
    moved.push(index)
    // What it reads or writes: a stream it names (`&1`), else the next word, unless that is a redirect of its own (`<<`).
    const next = index + 1
    if (next < words.length && (!operators.has(next) || (words[next] ?? '').startsWith('&'))) {
      moved.push(next)
      index = next
    }
  }
  const order = [...rest, ...moved]
  return { words: order.map((from) => words[from] ?? ''), at: new Map(order.map((from, to) => [from, to])) }
}

/**
 * Whether the expansion at a `$` can set a variable or work out arithmetic,
 * which can: `$[…]`, `${…}` beyond a plain name (`${X:=.}`, `${a[X=1]}`,
 * zsh's `${(e)X}`), or zsh's subscript `$a[…]`. `$X`, `${X}`, and `${X:-word}`
 * or `${X:+word}` with a word of no expansion of its own, only read.
 */
const evaluates = (text: string, at: number) => {
  const rest = text.slice(at + 1)
  if (rest.startsWith('[')) return true
  // A name, or one with a default or an alternative of plain words (`${X:-none}`, `${X:+set}`), only reads: `:=` sets it.
  if (rest.startsWith('{')) return !/^\{[A-Za-z_][A-Za-z0-9_]*(:?[-+][^$`{}()\\]*)?\}/.test(rest)
  return /^[#=~^+]*[A-Za-z_][A-Za-z0-9_]*\[/.test(rest)
}

/** Programs that take what they read as text, never as a script they run (and none of them runs a program of their own from it). */
const readsTextOnly = new Set(['cat', 'tee', 'head', 'tail', 'sort', 'uniq', 'wc', 'tr', 'cut', 'grep', 'jq', 'diff', 'base64'])

/**
 * Programs with subcommands, and the built-in ones that take text: a configured alias (`git -calias.run='!sh' run`) can
 * run anything but can never shadow a built-in, so only these are text. Anything else, or an option before the
 * subcommand, is not known to be.
 */
const textSubcommands: Readonly<Record<string, ReadonlySet<string>>> = {
  git: new Set(['commit', 'tag', 'notes', 'merge', 'stash', 'am', 'apply', 'commit-tree', 'hash-object', 'mktag']),
  gh: new Set(['pr', 'issue', 'release', 'gist', 'api', 'discussion']),
  glab: new Set(['mr', 'issue', 'release', 'api']),
}

/** Variables that change which program, or which configuration, a later command runs with. */
const changesWhatRuns = /^(?:PATH|IFS|ENV|BASH_ENV|BASH_FUNC_.*|SHELL|LD_.*|DYLD_.*|GIT_.*|GH_.*|GLAB_.*|XDG_CONFIG_HOME|HOME)$/

/** Builtins that redefine, or may redefine, what a name runs for the commands after them. */
const redefinesNames = new Set([
  'alias',
  'function',
  'export',
  'declare',
  'typeset',
  'readonly',
  'unalias',
  'hash',
  'set',
  'shopt',
  'enable',
  'source',
  '.',
  'eval',
  'exec',
])

export const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\+?=/

/** Whether a command (as words) changes what a name runs afterwards, or what it runs with: a variable such as PATH, or a builtin that defines names. */
const changesNames = (words: ReadonlyArray<string>): boolean => {
  const at = words.findIndex((word) => !assignment.test(word))
  return (
    words.slice(0, at === -1 ? words.length : at).some((word) => changesWhatRuns.test(assignment.exec(word)?.[1] ?? '')) ||
    (at !== -1 && redefinesNames.has(words[at] ?? ''))
  )
}

/** Whether a command's input is text to it: nothing to run, or a bare name from the list, or a built-in subcommand that takes text. */
const takesText = (words: ReadonlyArray<string>): boolean => {
  if (changesNames(words)) return false
  const at = words.findIndex((word) => !assignment.test(word))
  if (at === -1) return true
  const name = words[at] ?? ''
  const subcommands = textSubcommands[name]
  return subcommands === undefined ? readsTextOnly.has(name) : subcommands.has(words[at + 1] ?? '')
}

/**
 * A command line without the bodies of its quoted heredocs (`<<'EOF'`,
 * `<<"EOF"`, `<<-'EOF'`, `<<\EOF`): the shell takes that text literally, so it
 * runs nothing, whatever backticks or words like `push` it holds. A body stays
 * wherever it could be more than text: an unquoted heredoc's (the shell expands
 * `$(…)` and backticks in it), one that is never closed, and one read by any
 * command not known to take only text, anywhere in its pipeline (`sh <<'EOF'`,
 * `cat <<'EOF' | sh`, a function or script, a continued line): there the rules
 * judge it as they would have, as a command. The operator and the line it is on
 * stay; the body and its closing line go. Comments are skipped, as `# <<'EOF'`
 * opens nothing. `reads` says which commands leave a body unread as commands:
 * those that take only text, unless the caller says more.
 */
export const withoutQuotedHeredocs = (text: string, reads: (words: ReadonlyArray<string>) => boolean = takesText): string => {
  if (!text.includes('<<')) return text
  /** The commands of a pipeline, and of what is grouped with it in parentheses: the readers a heredoc's body can reach. */
  interface Group {
    readonly commands: Array<Array<string>>
  }
  interface Heredoc {
    readonly end: string
    readonly tabs: boolean
    readonly quoted: boolean
    readonly group: Group
    /** An earlier command defined a function or alias or changed PATH or the like, so a bare name may not be the program it seems. */
    readonly shadowed: boolean
  }
  /** A body and its closing line, dropped at the end if its heredoc is quoted and only text readers are in its group. */
  interface Held {
    readonly text: string
    readonly heredoc: Heredoc
    readonly closed: boolean
  }
  const chunks: Array<string | Held> = []
  let out = ''
  let pending: Array<Heredoc> = []
  let group: Group = { commands: [] }
  let command: Array<string> = []
  let word = ''
  let inWord = false
  /** Parentheses open outside quotes: what is in them is grouped with whatever they are redirected to. */
  let depth = 0
  /** A `|` ended the last command, so a newline goes on with the same pipeline. */
  let piped = false
  /** Some command so far may have changed what a name runs. */
  let shadowed = false
  const endWord = () => {
    if (inWord) {
      command.push(word)
      piped = false
    }
    word = ''
    inWord = false
  }
  const endCommand = () => {
    endWord()
    group.commands.push(command)
    if (changesNames(command)) shadowed = true
    command = []
  }
  const endGroup = () => {
    endCommand()
    if (depth === 0) group = { commands: [] }
  }
  let quote = ''
  let index = 0
  while (index < text.length) {
    const char = text[index] ?? ''
    const before = text[index - 1] ?? ''
    if (quote !== '') {
      out += char
      if (char === '\\' && quote === '"' && index + 1 < text.length) {
        out += text[++index]
        word += text[index]
      } else if (char === quote) quote = ''
      else word += char
      index++
      continue
    }
    if (char === '\\') {
      out += char + (text[index + 1] ?? '')
      // A backslash before a newline joins the lines: the word goes on, and so does the command.
      if (text[index + 1] !== '\n') {
        word += text[index + 1] ?? ''
        inWord = true
      }
      index += 2
      continue
    }
    if (char === '#' && (index === 0 || /[\s;&|(]/.test(before))) {
      const stop = text.indexOf('\n', index)
      const end = stop === -1 ? text.length : stop
      out += text.slice(index, end)
      index = end
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      inWord = true
      out += char
      index++
      continue
    }
    if (text.startsWith('<<<', index)) {
      endWord()
      out += '<<<'
      index += 3
      continue
    }
    if (char === '<' && text.startsWith('<<', index) && text[index + 2] !== '(') {
      const opener = /^<<(-?)[ \t]*((?:[^\s;&|<>()'"\\]|'[^']*'|"[^"]*"|\\.)+)/.exec(text.slice(index))
      if (opener !== null) {
        endWord()
        const written = opener[2] ?? ''
        pending.push({
          end: written.replace(/'([^']*)'|"([^"]*)"|\\(.)/g, '$1$2$3'),
          tabs: opener[1] === '-',
          quoted: /['"\\]/.test(written),
          group,
          shadowed,
        })
        out += opener[0]
        index += opener[0].length
        continue
      }
    }
    out += char
    index++
    if (char === ' ' || char === '\t') endWord()
    else if (char === ';') endGroup()
    else if (char === '&') {
      // `2>&1`, `>&2` and `&>` are redirects; `&&` and a lone `&` end a command list.
      if (before === '>' || before === '<' || text[index] === '>') endWord()
      else {
        if (text[index] === '&') out += text[index++]
        endGroup()
      }
    } else if (char === '|') {
      if (before === '>') endWord()
      else if (text[index] === '|') {
        out += text[index++]
        endGroup()
      } else {
        if (text[index] === '&') out += text[index++]
        endCommand()
        piped = true
      }
    } else if (char === '(') {
      // A word right before `(` that is not `$(` or `<(` is a function being defined (`cat() { sh; }`).
      if (inWord && !word.endsWith('$') && command.length === 0) shadowed = true
      if (!inWord && command.length === 1 && text.slice(index).trimStart().startsWith(')')) shadowed = true
      endCommand()
      depth++
    } else if (char === ')') {
      endCommand()
      depth = Math.max(0, depth - 1)
    } else if (char === '<' || char === '>') endWord()
    else if (char === '\n') {
      if (piped) endCommand()
      else endGroup()
    } else {
      word += char
      inWord = true
    }
    if (char === '\n' && pending.length > 0) {
      for (const heredoc of pending) {
        // Up to and including the line that closes it, or the end of the text where nothing does.
        const from = index
        let body = ''
        let closing = ''
        let closed = false
        while (index < text.length) {
          const stop = text.indexOf('\n', index)
          const line = text.slice(index, stop === -1 ? text.length : stop)
          index = stop === -1 ? text.length : stop + 1
          if ((heredoc.tabs ? line.replace(/^\t+/, '') : line) === heredoc.end) {
            closing = `${line}\n`
            closed = true
            break
          }
          body += `${line}\n`
        }
        chunks.push(out)
        out = ''
        chunks.push({ text: closed ? `${body}${closing}` : text.slice(from), heredoc, closed })
      }
      pending = []
    }
  }
  endCommand()
  chunks.push(out)
  return chunks
    .map((chunk) =>
      typeof chunk === 'string' ||
      !chunk.closed ||
      !chunk.heredoc.quoted ||
      chunk.heredoc.shadowed ||
      !chunk.heredoc.group.commands.every(reads)
        ? typeof chunk === 'string'
          ? chunk
          : chunk.text
        : '',
    )
    .join('')
}

/** Interpreters that read a script in their own language, not the shell's: `python3 - <<'EOF'`. */
const SCRIPT_LANGUAGES = /^(python[\d.]*|node|ruby|perl|php|bun|deno)$/

/**
 * Whether a command takes a heredoc's body as text or as a script in a
 * language other than the shell's, whose words aren't commands: `python3 -`,
 * `node`. What such a script does the rules can't read either way.
 */
export const takesScript = (words: ReadonlyArray<string>): boolean => {
  if (takesText(words)) return true
  if (changesNames(words)) return false
  const program = words.find((word) => !assignment.test(word)) ?? ''
  return SCRIPT_LANGUAGES.test(program.slice(program.lastIndexOf('/') + 1))
}

/** A command line's commands as written, with the separator that ends each ('' for the last). */
export const splitCommandLine = (source: string) => {
  const text = withoutQuotedHeredocs(source)
  const commands: Array<Array<string>> = []
  const ends: Array<string> = []
  /** For each command, which of its words are redirect operators, not arguments that look like them (`echo '>'`). */
  const operators: Array<ReadonlySet<number>> = []
  /** For each command, which of its words the shell expands, outside quotes: a glob, braces, a variable (`*.ts`, `$X`). */
  const expanded: Array<ReadonlySet<number>> = []
  /** For each command, where it starts in the text: just past the separator before it. */
  const starts: Array<number> = []
  let begun = 0
  let words: Array<string> = []
  let operating = new Set<number>()
  let expanding = new Set<number>()
  let word = ''
  let inWord = false
  /** The word in progress has a quoted or escaped part. */
  let literal = false
  /** The word in progress has a part the shell expands: a glob or a variable, or braces it may (`{a,b}`, not `stash@{0}`). */
  let expands = false
  let braces = false
  let opaque = false
  /** Parentheses outside quotes: a subshell, a function's definition (`cat () (…)`), zsh's qualifier on a pattern. */
  let grouped = false
  /** An expansion that can set a variable or work out arithmetic (`evaluates`). */
  let evaluated = false
  /** A process substitution outside quotes, `<(…)` or `>(…)`: inside quotes it is text (`git grep -E "<(a|b)"`). */
  let substituted = false
  const endWord = () => {
    if (inWord) {
      if (expands || (braces && /\{[^{}]*(,|\.\.)[^{}]*\}/.test(word))) expanding.add(words.length)
      words.push(word)
    }
    word = ''
    inWord = false
    literal = false
    expands = false
    braces = false
  }
  const endCommand = (separator = '') => {
    endWord()
    if (words.length > 0) {
      commands.push(words)
      starts.push(begun)
      ends.push(separator)
      operators.push(operating)
      expanded.push(expanding)
    }
    words = []
    operating = new Set()
    expanding = new Set()
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    const rest = text.slice(index)
    if (char === "'") {
      const close = text.indexOf("'", index + 1)
      const end = close === -1 ? text.length : close
      word += text.slice(index + 1, end)
      inWord = true
      literal = true
      index = end
      continue
    }
    if (char === '"') {
      inWord = true
      literal = true
      for (index += 1; index < text.length && text[index] !== '"'; index += 1) {
        const inner = text[index] ?? ''
        if (inner === '\\' && index + 1 < text.length && '"\\$`'.includes(text[index + 1] ?? '')) {
          word += text[index + 1]
          index += 1
        } else {
          if (inner === '`' || (inner === '$' && text[index + 1] === '(')) opaque = true
          if (inner === '$' && evaluates(text, index)) evaluated = true
          word += inner
        }
      }
      continue
    }
    if (char === '\\') {
      word += text[index + 1] ?? ''
      inWord = true
      literal = true
      index += 1
      continue
    }
    // `$'…'`, quoted as C is, where `\'` doesn't end it: kept as written, and expanded, as the shell decodes it into other words.
    if (char === '$' && text[index + 1] === "'") {
      let end = index + 2
      while (end < text.length && text[end] !== "'") end += text[end] === '\\' ? 2 : 1
      word += `$${text.slice(index + 2, Math.min(end, text.length))}`
      inWord = true
      literal = true
      expands = true
      index = end
      continue
    }
    // A comment, from a word's start to the line's end: nothing in it runs, and what follows the line does.
    if (char === '#' && !inWord) {
      const end = text.indexOf('\n', index)
      index = (end === -1 ? text.length : end) - 1
      continue
    }
    if (char === '`' || (char === '$' && text[index + 1] === '(')) opaque = true
    if (char === '$' && evaluates(text, index)) evaluated = true
    if ((char === '<' || char === '>') && text[index + 1] === '(') substituted = true
    if (char === '(' || char === ')') grouped = true
    const separator = SEPARATORS.find((candidate) => rest.startsWith(candidate))
    if (separator !== undefined && !(separator === '&' && rest.startsWith('&>'))) {
      endCommand(separator)
      index += separator.length - 1
      begun = index + 1
      continue
    }
    const redirect = REDIRECTS.find((candidate) => rest.startsWith(candidate))
    if (redirect !== undefined) {
      // `1>file`: the descriptor belongs to the redirect, not to the arguments.
      if (inWord && !literal && /^\d+$/.test(word) && ['>', '>>', '2>'].includes(redirect)) {
        word = ''
        inWord = false
      }
      endWord()
      operating.add(words.length)
      words.push(redirect)
      index += redirect.length - 1
      // `2>&1`, `>&2`: a redirect to another stream, not to a file.
      const stream = /^&[0-9-]+/.exec(text.slice(index + 1))
      if (stream !== null) {
        operating.add(words.length)
        words.push(stream[0])
        index += stream[0].length
      }
      continue
    }
    if (char === ' ' || char === '\t') {
      endWord()
      continue
    }
    if ('*?[$'.includes(char)) expands = true
    if (char === '{') braces = true
    word += char
    inWord = true
  }
  endCommand()
  return { commands, ends, operators, expanded, opaque, grouped, evaluated, substituted, starts }
}

/** Commands as the shell runs them: a script handed to a shell is read as commands of its own. */
const expandShells = (
  commands: ReadonlyArray<ReadonlyArray<string>>,
  opaqueBefore: boolean,
  scopesOf: ReadonlyArray<Scope> = [],
): Parsed => {
  let opaque = opaqueBefore
  const scopes: Array<Scope> = []
  const expanded = commands.flatMap((command, at): Array<ReadonlyArray<string>> => {
    const own = scopesOf[at] ?? NO_SCOPE
    const inner = unwrap(command)
    const [program, ...args] = inner
    const flag = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg))
    const windows = windowsScript(inner)
    if (windows === null) opaque = true
    const posixScript =
      program !== undefined && /^(ba|z|da|k)?sh$/.test(program.split('/').at(-1) ?? '') && flag !== -1 ? args[flag + 1] : undefined
    if (posixScript !== undefined || typeof windows === 'string') {
      // cmd's and PowerShell's backslashes separate folders: read as POSIX, they would escape the next letter.
      const script = parseCommandLine(posixScript ?? (windows ?? '').replaceAll('\\', '/'))
      if (script.opaque) opaque = true
      // Where the shell's own output goes stays a command of its own, made of its redirects alone: `sh -c '…' > ~/.zshrc`.
      const redirected = inner.flatMap((word, index) =>
        REDIRECTS.includes(word) ? [word, ...(inner[index + 1] === undefined ? [] : [inner[index + 1] ?? ''])] : [],
      )
      const ran = [...script.commands, ...(redirected.length === 0 ? [] : [redirected])]
      // The script runs in a shell of its own: a `cd` in it doesn't hold after.
      const inside = wrapped(script.scopes ?? script.commands.map(() => NO_SCOPE), NO_SCOPE, 1)
      scopes.push(...wrapped([...inside, ...(redirected.length === 0 ? [] : [NO_SCOPE])], own, 0))
      return ran
    }
    if (program === 'eval' || program === 'xargs' || program === 'source' || program === '.') opaque = true
    // What `eval` runs, as commands of their own, so git and the rest read them as they would written out: `eval git stash drop`.
    // It runs in the shell itself, so its `cd` holds.
    if (program === 'eval') {
      const ran = parseCommandLine(args.join(' '))
      scopes.push(...wrapped([NO_SCOPE, ...(ran.scopes ?? ran.commands.map(() => NO_SCOPE))], own, 0))
      return [inner, ...ran.commands]
    }
    scopes.push(own)
    return [inner]
  })
  return { commands: expanded, opaque, scopes }
}

/** The words a shell reads before a command it runs: `then rm …`. */
export const SHELL_KEYWORDS = ['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{']

/** A command without the words that only run it: shell keywords, a subshell's parentheses, variable assignments, `sudo`, `env`, `command`, `time`… */
export const unwrap = (written: ReadonlyArray<string>): ReadonlyArray<string> => {
  // A subshell's or a group's command, and one a shell keyword starts: `(rm …)`, `{ rm …; }`, `do rm …`, `then rm …`, `! rm …`.
  let command = written
  // A parenthesis may stand as a word of its own: `( rm … )`, `( ( rm … ) )`.
  while (SHELL_KEYWORDS.includes(command[0] ?? '') || /^\(+$/.test(command[0] ?? '') || /^\(+[^(]/.test(command[0] ?? '')) {
    const [first = '', ...rest] = command
    command = SHELL_KEYWORDS.includes(first) || /^\(+$/.test(first) ? rest : [first.replace(/^\(+/, ''), ...rest]
  }
  while (command.length > 1 && /^\)+$/.test(command.at(-1) ?? '')) command = command.slice(0, -1)
  if (/[^)]\)+$/.test(command.at(-1) ?? '') && written[0]?.startsWith('(') === true)
    command = [...command.slice(0, -1), (command.at(-1) ?? '').replace(/\)+$/, '')]
  let index = 0
  while (index < command.length) {
    const word = command[index] ?? ''
    // The Flatpak bridge is an ordinary wrapper; the visible command still meets the irreversible rules.
    if (word.split('/').at(-1) === 'flatpak-spawn') {
      index += 1
      while ((command[index] ?? '').startsWith('-')) {
        if (command[index] === '--') {
          index += 1
          break
        }
        index += ['--env', '--unset-env', '--directory', '--sandbox-expose', '--sandbox-expose-ro'].includes(command[index] ?? '') ? 2 : 1
      }
      continue
    }
    // `timeout [options] 60 cmd`: its options, then how long, then the command.
    if (word === 'timeout') {
      index += 1
      while ((command[index] ?? '').startsWith('-'))
        index += ['-s', '-k', '--signal', '--kill-after'].includes(command[index] ?? '') ? 2 : 1
      index += 1
      continue
    }
    if (
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(word) ||
      ['sudo', 'command', 'builtin', 'exec', 'env', 'nice', 'time', 'nohup', 'caffeinate'].includes(word)
    ) {
      index += 1
      // `sudo -u x`, `env -i`, `nice -n 5`: their options too.
      while ((command[index] ?? '').startsWith('-')) index += ['-u', '-n', '-g'].includes(command[index] ?? '') ? 2 : 1
      continue
    }
    break
  }
  return command.slice(index)
}

/**
 * What a command line runs, by name: its first program and, when the next
 * word reads as one, its subcommand (`vercel deploy`). Never its arguments,
 * which may hold a secret, so it can be said where the command can't.
 */
export const programOf = (text: string): string | undefined => {
  for (const words of parseCommandLine(text).commands) {
    const [program, next] = unwrap(words)
    if (program === undefined || program === 'cd' || REDIRECTS.includes(program)) continue
    const name = program.slice(program.lastIndexOf('/') + 1)
    return next !== undefined && /^[a-z][a-z-]{0,22}[a-z0-9]?$/.test(next) ? `${name} ${next}` : name
  }
  return undefined
}

const OUTPUT_REDIRECTS = ['>>', '&>', '2>', '>']

/** Programs that only trim or filter what a command printed, when it pipes into them. */
const PLUMBING = ['tail', 'head', 'grep']

const KEPT_BETWEEN: Readonly<Record<string, string>> = { '&&': ' && ', '||': ' || ', ';': '; ', '\n': '; ', '|': ' | ', '&': ' & ' }

const sayWord = (word: string) => (word === '' ? "''" : /^[^\s'"\\;&|<>()`]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`)

/** A command's words without where its output goes: `2>&1`, `> out.log`. */
const withoutRedirects = (words: ReadonlyArray<string>, operators: ReadonlySet<number>): ReadonlyArray<string> =>
  words.flatMap((word, index) => {
    if (operators.has(index) && (OUTPUT_REDIRECTS.includes(word) || word.startsWith('&'))) return []
    // The word a redirect writes to.
    return operators.has(index - 1) && OUTPUT_REDIRECTS.includes(words[index - 1] ?? '') ? [] : [word]
  })

/** Flags whose value is a place, such as a config file, that a reader has no use for at a glance: `--config ../../a/vite.config.ts`. */
const PLACE_FLAGS = /^--?(config|config-?file|cwd|root|project|tsconfig|env-?file|prefix|dir|workspace)$/i

/** A runner's own words before the program it runs: `npx -y`, `bunx`, `pnpm dlx`, `yarn dlx`, `bun x`. */
const FETCHERS = [['npx'], ['bunx'], ['pnpx'], ['pnpm', 'dlx'], ['yarn', 'dlx'], ['bun', 'x']]

const FETCHER_FLAGS = ['-y', '--yes', '-q', '--quiet', '--no-install', '--no', '--bun']

const BIN_FOLDER = /(?:^|[/\\])node_modules[/\\]\.bin[/\\]([^/\\]+)$/

const looksLikePlace = (value: string) => /[/\\]/.test(value) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)

/**
 * A command's last meaningful part (ADR-044): its program without the folder
 * a package manager keeps it in or the runner that fetches it, and without
 * the flags that only say where a file is: `node_modules/.bin/vp dev
 * --config ../../a/vite.config.ts` reads `vp dev`.
 */
const plainer = (words: ReadonlyArray<string>): ReadonlyArray<string> => {
  let rest = words
  const runner = FETCHERS.find((one) => one.every((word, at) => rest[at] === word))
  if (runner !== undefined && rest.length > runner.length) {
    rest = rest.slice(runner.length)
    while (FETCHER_FLAGS.includes(rest[0] ?? '') && rest.length > 1) rest = rest.slice(1)
  }
  const bin = BIN_FOLDER.exec(rest[0] ?? '')?.[1]
  if (bin !== undefined) rest = [bin, ...rest.slice(1)]
  const kept: Array<string> = []
  for (let at = 0; at < rest.length; at += 1) {
    const word = rest[at] ?? ''
    if (at > 0 && word.startsWith('-')) {
      const [flag = '', ...joined] = word.split('=')
      if (PLACE_FLAGS.test(flag)) {
        if (joined.length > 0 && looksLikePlace(joined.join('='))) continue
        if (joined.length === 0 && looksLikePlace(rest[at + 1] ?? '')) {
          at += 1
          continue
        }
      }
    }
    kept.push(word)
  }
  return kept
}

/**
 * A command line as the person reads it at a glance: what it runs, without
 * the `cd <dir> &&` an agent puts first, variable assignments, `timeout N`
 * and the like, or the plumbing after it (`2>&1`, `| tail -20`); a program
 * without its `node_modules/.bin/` or the `npx` that fetches it, and without
 * flags that only name a file (`plainer`). The line
 * itself is never changed; this is only what to show of it. A line that only
 * changes folder, or that has parts the shell works out when it runs, is
 * shown as written.
 */
export const shortCommand = (text: string): string => {
  const whole = text.trim()
  const { commands, ends, operators, opaque } = splitCommandLine(whole)
  if (opaque || whole.includes('<<')) return whole
  const parts = commands.map((words, index) => ({ words, end: ends[index] ?? '', operators: operators[index] ?? new Set<number>() }))
  // Leading `cd dir &&`, however many.
  let first = 0
  while (first < parts.length - 1) {
    const part = parts[first]
    if (part === undefined || !['cd', 'pushd'].includes(part.words[0] ?? '') || !['&&', ';', '\n'].includes(part.end)) break
    first += 1
  }
  let kept = parts.slice(first)
  // Trailing `| tail -20`, `| grep x`, only where something comes before the pipe.
  while (kept.length > 1 && kept.at(-2)?.end === '|' && PLUMBING.includes(unwrap(kept.at(-1)?.words ?? [])[0] ?? ''))
    kept = kept.slice(0, -1)
  const said = kept
    .map(({ words, end, operators }, index) => {
      // Words dropped from the front by unwrap shift where the operators are.
      const unwrapped = unwrap(words)
      const dropped = words.length - unwrapped.length
      const shown = plainer(withoutRedirects(unwrapped, new Set([...operators].map((at) => at - dropped))))
      return shown.length === 0 ? '' : `${shown.map(sayWord).join(' ')}${index === kept.length - 1 ? '' : (KEPT_BETWEEN[end] ?? '; ')}`
    })
    .join('')
    .trim()
  // A line that is only a `cd`, or only plumbing, has nothing to shorten to.
  return said === '' ? whole : said
}

// ---- Windows ---------------------------------------------------------------

/*
 * On Windows an agent's command may be cmd's or PowerShell's rather than a
 * POSIX shell's: `rd /s /q C:\code\app`, `Remove-Item -Recurse -Force
 * $env:USERPROFILE\code`, `git.exe push --force`. The rules read each command
 * also as the POSIX command that does the same (`rm -rf …`), so every rule
 * below holds for it; a line handed to cmd or PowerShell (`cmd /c …`,
 * `powershell -Command …`) as the commands it runs; and, on Windows, a line
 * also with its backslashes as the folder separators they are there. A second
 * reading only ever adds what a command is, never takes away.
 */

/** A program's name as Windows finds it: without its folder or `.exe`, in any case. */
const windowsName = (word: string) => (word.split(/[/\\]/).at(-1) ?? '').replace(/\.(exe|cmd|bat|com)$/i, '').toLowerCase()

/** One of cmd's switches: `/s`, `/Q`, `/a:h`, `/-y`. */
const CMD_SWITCH = /^\/-?[A-Za-z?](:\S*)?$/

/** Whether a word names a PowerShell parameter by the start of its name, as PowerShell takes it: `-fo` for `-Force`. */
const isParameter = (word: string, name: string, shortest = 1) => {
  const given = /^-([A-Za-z]+)(?::|$)/.exec(word)?.[1]?.toLowerCase()
  return given !== undefined && given.length >= shortest && name.startsWith(given)
}

/**
 * A PowerShell command's arguments: the values of the parameters among
 * `valued` (`-Path x`, `-Path:x`, `-LiteralPath x,y`), and the rest by
 * position. Other parameters are switches; cmd's switches are left out.
 */
const powershellArgs = (args: ReadonlyArray<string>, valued: ReadonlyArray<string>) => {
  const named = new Map<string, Array<string>>()
  const positional: Array<string> = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    if (REDIRECTS.includes(arg)) {
      index += 1
      continue
    }
    if (CMD_SWITCH.test(arg)) continue
    const parameter = /^-([A-Za-z]+)(?::(.*))?$/.exec(arg)
    if (parameter === null) {
      positional.push(...arg.split(','))
      continue
    }
    const name = valued.find((each) => each.startsWith((parameter[1] ?? '').toLowerCase()))
    if (name === undefined) continue
    const value = parameter[2] ?? args[(index += 1)]
    if (value !== undefined) named.set(name, [...(named.get(name) ?? []), ...value.split(',')])
  }
  const of = (...names: ReadonlyArray<string>) => names.flatMap((name) => named.get(name) ?? [])
  return { of, positional }
}

const ITEM_PATHS = ['path', 'literalpath', 'pspath', 'filter', 'include', 'exclude', 'credential', 'stream']

const COPY_PATHS = [...ITEM_PATHS, 'destination', 'tosession', 'fromsession']

const WRITE_PATHS = [
  'path',
  'literalpath',
  'filepath',
  'value',
  'encoding',
  'itemtype',
  'type',
  'name',
  'credential',
  'stream',
  'inputobject',
]

/** Where a copy or move goes and what it takes, PowerShell's way or cmd's: `-Path` and `-Destination`, or by position. */
const fromTo = (args: ReadonlyArray<string>): { readonly sources: ReadonlyArray<string>; readonly target: string | undefined } => {
  const { of, positional } = powershellArgs(args, COPY_PATHS)
  const rest = [...positional]
  const sources = of('path', 'literalpath', 'pspath')
  if (sources.length === 0) sources.push(...rest.splice(0, Math.max(1, rest.length - (of('destination').length > 0 ? 0 : 1))))
  return { sources, target: of('destination')[0] ?? rest.at(-1) }
}

/** The POSIX command that does what a cmd or PowerShell command does, as far as the rules read it; none where it's the same. */
const fromWindows = (words: ReadonlyArray<string>): ReadonlyArray<string> | undefined => {
  const [first = '', ...args] = words
  const name = windowsName(first)
  const has = (cmd: ReadonlyArray<string>, parameter: string, shortest = 1) =>
    args.some((arg) => cmd.includes(arg.toLowerCase()) || isParameter(arg, parameter, shortest))
  switch (name) {
    case 'remove-item':
    case 'ri':
    case 'del':
    case 'erase':
    case 'rd':
    case 'rmdir':
    case 'rm': {
      const { of, positional } = powershellArgs(args, ITEM_PATHS)
      const flags = `${has(['/s', '-r'], 'recurse') ? 'r' : ''}${has(['/q', '/f', '-f'], 'force', 2) ? 'f' : ''}`
      return ['rm', ...(flags === '' ? [] : [`-${flags}`]), ...of('path', 'literalpath', 'pspath'), ...positional]
    }
    case 'move-item':
    case 'mi':
    case 'move':
    case 'mv': {
      const { sources, target } = fromTo(args)
      return ['mv', ...sources, target ?? '.']
    }
    case 'rename-item':
    case 'rni':
    case 'ren':
    case 'rename': {
      const { of, positional } = powershellArgs(args, ['path', 'literalpath', 'newname', 'credential'])
      return ['mv', ...[...of('path', 'literalpath'), ...positional].slice(0, 1), of('newname')[0] ?? positional.at(-1) ?? '.']
    }
    case 'copy-item':
    case 'cpi':
    case 'copy':
    case 'xcopy':
    case 'cp': {
      const { sources, target } = fromTo(args)
      return ['cp', ...sources, target ?? '.']
    }
    case 'robocopy': {
      // `robocopy <from> <to> [files] [/options]`: /MIR and /PURGE delete in where it copies to, /MOV and /MOVE from where it copies from.
      const [from = '.', to = '.'] = args.filter((arg) => !arg.startsWith('/'))
      const options = args.map((arg) => arg.toLowerCase())
      return [
        'rsync',
        ...(options.includes('/mir') || options.includes('/purge') ? ['--delete'] : []),
        ...(options.includes('/mov') || options.includes('/move') ? ['--remove-source-files'] : []),
        from,
        to,
      ]
    }
    case 'set-content':
    case 'sc':
    case 'add-content':
    case 'ac':
    case 'clear-content':
    case 'clc':
    case 'out-file':
    case 'new-item':
    case 'ni':
    case 'md':
    case 'mkdir':
    case 'tee-object': {
      const { of, positional } = powershellArgs(args, WRITE_PATHS)
      const named = of('path', 'literalpath', 'filepath')
      // What replaces a file's content, as `truncate` does; adding to it or making it keeps what's there.
      const replaces =
        ['set-content', 'sc', 'clear-content', 'clc'].includes(name) ||
        (['out-file', 'tee-object'].includes(name) && !has([], 'append')) ||
        (['new-item', 'ni'].includes(name) && has([], 'force'))
      return [replaces ? 'truncate' : 'touch', ...(named.length > 0 ? named : positional.slice(0, 1))]
    }
    case 'set-location':
    case 'sl':
    case 'chdir':
    case 'pushd':
    case 'cd': {
      const { of, positional } = powershellArgs(args, ['path', 'literalpath', 'stackname'])
      return ['cd', ...[...of('path', 'literalpath'), ...positional].slice(0, 1)]
    }
    default:
      return name === first ? undefined : [name, ...args]
  }
}

/** A command as written, and as the POSIX command that does what it does on Windows, where that differs. */
export const readings = (words: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> => {
  const read = fromWindows(words)
  return read === undefined || read.join('\0') === words.join('\0') ? [words] : [words, read]
}

/** A line as a POSIX shell reads it and, on Windows, with its backslashes as folders' separators, first, so a reason names the path as written. */
export const lineReadings = (text: string, system: System): ReadonlyArray<Parsed> =>
  system.windows && text.includes('\\') ? [parseCommandLine(text.replaceAll('\\', '/')), parseCommandLine(text)] : [parseCommandLine(text)]

/** The PowerShell options that take a value, so what follows one isn't its command. */
const POWERSHELL_VALUED =
  /^-(executionpolicy|ep|ex|windowstyle|w|version|v|outputformat|o|of|inputformat|if|configurationname|psconsolefile|workingdirectory|wd|settingsfile|custompipename)$/i

/**
 * The script a line hands to cmd (`cmd /c …`) or PowerShell (`powershell
 * -Command …`, and Windows PowerShell's bare `powershell Remove-Item …`);
 * `null` for one Althar can't read (`-EncodedCommand`, or from its input);
 * none where it hands neither one.
 */
const windowsScript = (words: ReadonlyArray<string>): string | null | undefined => {
  const [first = '', ...args] = words
  const name = windowsName(first)
  if (name === 'cmd') {
    const at = args.findIndex((arg) => /^\/[ck]$/i.test(arg))
    return at === -1 ? undefined : args.slice(at + 1).join(' ')
  }
  if (name !== 'powershell' && name !== 'pwsh') return undefined
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    const option = arg.startsWith('-') ? arg.slice(1).toLowerCase() : undefined
    if (option !== undefined && (option === 'e' || option === 'ec' || (option.length >= 2 && 'encodedcommand'.startsWith(option))))
      return null
    if (option !== undefined && option !== '' && 'command'.startsWith(option)) {
      const script = args.slice(index + 1).join(' ')
      return script === '-' || script === '' ? null : script
    }
    if (option !== undefined && option.length >= 1 && 'file'.startsWith(option)) return undefined
    if (option !== undefined) {
      if (POWERSHELL_VALUED.test(arg)) index += 1
      continue
    }
    return args.slice(index).join(' ')
  }
  return undefined
}

/**
 * The command a package runner runs for it, as its own words: `npx vercel
 * deploy`, `pnpm exec prisma migrate reset`. None where the command isn't one.
 */
const runnerRuns = (words: ReadonlyArray<string>): ReadonlyArray<string> | undefined => {
  const [first = '', second = ''] = words
  const program = first.slice(first.lastIndexOf('/') + 1)
  const start = ['npx', 'bunx', 'pnpx', 'uvx'].includes(program)
    ? 1
    : (program === 'pnpm' && (second === 'exec' || second === 'dlx')) ||
        (program === 'yarn' && (second === 'exec' || second === 'dlx')) ||
        (program === 'npm' && second === 'exec') ||
        (program === 'bun' && second === 'x')
      ? 2
      : undefined
  if (start === undefined) return undefined
  let index = start
  while ((words[index] ?? '').startsWith('-')) index += ['-p', '--package', '-c', '--call', '--from'].includes(words[index] ?? '') ? 2 : 1
  if (words[index] === '--') index += 1
  return words.slice(index)
}

/** Shells and interpreters that run a script they're given: `bash ops/run.sh deploy`. */
export const INTERPRETERS = ['bash', 'sh', 'zsh', 'dash', 'python', 'python3', 'node', 'ruby', 'perl']

/** The script an interpreter runs, as a command of its own; none where it runs no script. */
const scriptRuns = (words: ReadonlyArray<string>): ReadonlyArray<string> | undefined => {
  const [first = '', ...rest] = words
  if (!INTERPRETERS.includes(first.slice(first.lastIndexOf('/') + 1))) return undefined
  const at = rest.findIndex((word) => !word.startsWith('-'))
  return at === -1 ? undefined : rest.slice(at)
}

/** `xargs`'s options that take the next word. */
const XARGS_VALUED = [
  '-a',
  '-d',
  '-E',
  '-e',
  '-I',
  '-L',
  '-l',
  '-n',
  '-P',
  '-s',
  '--arg-file',
  '--delimiter',
  '--max-args',
  '--max-procs',
  '--max-chars',
  '--max-lines',
  '--process-slot-var',
]

/** The command `xargs` runs, with the words its input adds left out; none where it isn't `xargs`. */
export const xargsRuns = (words: ReadonlyArray<string>): ReadonlyArray<string> | undefined => {
  if ((words[0] ?? '').split('/').at(-1) !== 'xargs') return undefined
  let index = 1
  while ((words[index] ?? '').startsWith('-') && words[index] !== '--') index += XARGS_VALUED.includes(words[index] ?? '') ? 2 : 1
  if (words[index] === '--') index += 1
  return words.slice(index)
}

/** The commands `eval` runs, read again as the shell would; none where it isn't `eval`. */
const evalRuns = (words: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> =>
  words[0] === 'eval' ? parseCommandLine(words.slice(1).join(' ')).commands : []

/** A command as itself, and as what a package runner, an interpreter, `xargs` or `eval` runs for it. */
export const commandsIn = (words: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> =>
  [words, runnerRuns(words), scriptRuns(words), xargsRuns(words), ...evalRuns(words)].filter(
    (each): each is ReadonlyArray<string> => each !== undefined && each.length > 0,
  )

/** Programs whose arguments are places they write: all of them, or the last. */
const WRITES_ALL = ['touch', 'mkdir', 'rm', 'rmdir', 'tee', 'truncate', 'chmod', 'chown', 'chgrp', 'unlink', 'shred']

export const WRITES_LAST = ['cp', 'mv', 'ln', 'install', 'rsync', 'scp']

/** Where a command's output goes, as its redirects say: files, not other streams (`2>&1`). */
export const redirects = (words: ReadonlyArray<string>): ReadonlyArray<string> =>
  words.flatMap((word, index) => {
    const target = words[index + 1]
    return REDIRECTS.slice(0, 4).includes(word) && target !== undefined && !target.startsWith('&') ? [target] : []
  })

/** A command made only of the redirects a shell wrapper carried, for where its script's output goes. */
export const onlyRedirects = (words: ReadonlyArray<string>) => REDIRECTS.includes(words[0] ?? '')

/** Programs that take the folder they copy or move into as `-t`, by the other short flags they take a value for. */
const TARGET_FOLDER: Readonly<Record<string, string>> = { cp: 'S', mv: 'S', ln: 'S', install: 'Sgmo' }

/**
 * What a copy or move takes from and where it puts it, as its words say: the
 * last operand is where, but where `-t` names the folder (`-t dir`, `-tdir`,
 * `--target-directory=dir`), every operand is something it takes.
 */
export const copied = (words: ReadonlyArray<string>): { readonly sources: ReadonlyArray<string>; readonly target: string | undefined } => {
  const values = TARGET_FOLDER[(words[0] ?? '').split('/').at(-1) ?? '']
  const operands: Array<string> = []
  let folder: string | undefined
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index] ?? ''
    if (REDIRECTS.includes(word)) index += 1
    else if (!word.startsWith('-')) operands.push(word)
    else if (values === undefined || word === '-' || word === '--') continue
    else if (word.startsWith('--')) {
      const [name = '', ...value] = word.split('=')
      if (name.length >= 3 && '--target-directory'.startsWith(name))
        folder = value.length > 0 ? value.join('=') : (words[(index += 1)] ?? '')
    } else {
      // A cluster of short flags, where the first that takes a value takes the rest of the word, or the next.
      const at = word.slice(1).search(new RegExp(`[t${values}]`)) + 1
      if (at === 0) continue
      const value = word.length > at + 1 ? word.slice(at + 1) : (words[(index += 1)] ?? '')
      if (word[at] === 't') folder = value
    }
  }
  return folder === undefined
    ? { sources: operands.slice(0, -1), target: operands.length > 1 ? operands.at(-1) : undefined }
    : { sources: operands, target: folder }
}

/** The places a command writes, as far as its words say. */
export const writes = (words: ReadonlyArray<string>): ReadonlyArray<string> => {
  const targets: Array<string> = [...redirects(words)]
  words.forEach((word) => {
    if (word.startsWith('of=')) targets.push(word.slice(3))
  })
  const program = (words[0] ?? '').split('/').at(-1) ?? ''
  const operands = operandsOf(words)
  if (WRITES_ALL.includes(program)) targets.push(...operands)
  const { target } = copied(words)
  if (WRITES_LAST.includes(program) && target !== undefined) targets.push(target)
  if (program === 'sed' && words.some((word) => word.startsWith('-i') || word === '--in-place')) targets.push(...operands.slice(1))
  return targets
}

/**
 * A command's operands: its words that aren't flags, redirects or where a
 * redirect goes. cmd's `rmdir /s /q` takes switches, not folders at the
 * root, which a POSIX `rmdir` would only remove empty.
 */
export const operandsOf = (words: ReadonlyArray<string>) =>
  words
    .slice(1)
    .filter((word, index, all) => !word.startsWith('-') && !REDIRECTS.includes(word) && !REDIRECTS.includes(all[index - 1] ?? ''))
    .filter((word) => !(/^\/[sq]$/i.test(word) && (words[0] ?? '').split('/').at(-1) === 'rmdir'))

/**
 * A plain HTTP read to stdout, with no config, upload, output file, extra
 * command, substitution or arbitrary option. Keep the network sandbox closed:
 * domain allowlists cannot distinguish these from POSTs. More elaborate calls
 * still meet the existing rules.
 */
export const readsWeb = (command: string): boolean => {
  const parsed = parseCommandLine(command)
  if (parsed.opaque || parsed.commands.length !== 1) return false
  const words = parsed.commands[0] ?? []
  const [program = '', ...args] = words
  const name = program.slice(program.lastIndexOf('/') + 1)
  if (program.includes('/') && !INSTALLED.test(program)) return false
  if (name !== 'curl' && name !== 'wget') return false
  // The person's config could otherwise select a method or upload a file.
  if (
    name === 'curl'
      ? args[0] !== '-q' && args[0] !== '--disable'
      : !['--no-config', '--no-netrc', '--no-hsts'].every((flag) => args.includes(flag))
  )
    return false
  let urls = 0
  let stdout = name === 'curl'
  for (let at = 0; at < args.length; at++) {
    const arg = args[at]!
    if (/^https?:\/\//i.test(arg)) {
      try {
        const url = new URL(arg)
        if (url.username || url.password) return false
      } catch {
        return false
      }
      urls++
    } else if (name === 'curl') {
      if (
        /^-[qfsSIL]+$/.test(arg) ||
        ['--disable', '--fail', '--silent', '--show-error', '--location', '--head', '--get', '--compressed'].includes(arg)
      )
        continue
      if (['--max-time', '--connect-timeout', '--max-redirs'].includes(arg) && /^\d+$/.test(args[at + 1] ?? '')) {
        at++
        continue
      }
      return false
    } else {
      if (arg === '-qO-' || arg === '-O-') {
        stdout = true
        continue
      }
      if (arg === '--output-document=-') {
        stdout = true
        continue
      }
      if (['--no-config', '--no-netrc', '--no-hsts', '-q', '--quiet', '--https-only'].includes(arg)) continue
      return false
    }
  }
  return stdout && urls > 0
}

/** Where a program named by its path is one installed, not a script of the task's: the system's, a package manager's. */
const INSTALLED =
  /^\/(usr\/(local\/)?s?bin|s?bin|opt\/homebrew\/s?bin|nix\/store)\/|(^|\/)node_modules\/\.bin\/|\/\.(bun|cargo|deno|local)\/bin\//
