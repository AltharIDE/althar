import { posix } from 'node:path'

/*
 * What a run a task kept needs of its repository (docs/decisions/workspaces-and-runs.md, "What a project runs"): the
 * files its command names, as the repository holds them, from where it runs. A run a task's lead kept goes once that
 * task's worktrees are cleaned up, unless every file it names is on the default branch, as when its config merged: then
 * it still runs as kept there. A command whose files can't be told for sure stays.
 */

/** A shell word, its quotes taken off; `dynamic` where it holds what the shell works out (`$x`, `` `x` ``, `*`). */
interface Word {
  readonly kind: 'word'
  readonly text: string
  readonly dynamic: boolean
}
/** Between commands (`&&`, `;`, `|`), or a redirection (`>`, `2>&1`), `target` where the next word is where it goes. */
type Token = Word | { readonly kind: 'between' } | { readonly kind: 'redirect'; readonly target: boolean }

/** A command's words and operators as a POSIX shell reads them, quotes and backslashes respected; null where it can't be read (a quote never closed). */
export const shellWords = (command: string): ReadonlyArray<Token> | null => {
  const tokens: Array<Token> = []
  let text = ''
  let started = false
  let dynamic = false
  const end = () => {
    if (started) tokens.push({ kind: 'word', text, dynamic })
    text = ''
    started = false
    dynamic = false
  }
  let at = 0
  while (at < command.length) {
    const char = command[at]!
    if (char === "'") {
      const close = command.indexOf("'", at + 1)
      if (close < 0) return null
      text += command.slice(at + 1, close)
      started = true
      at = close + 1
    } else if (char === '"') {
      started = true
      at += 1
      for (;;) {
        if (at >= command.length) return null
        const inner = command[at]!
        if (inner === '"') break
        if (inner === '\\' && at + 1 < command.length && '$`"\\\n'.includes(command[at + 1]!)) {
          text += command[at + 1]
          at += 2
          continue
        }
        if (inner === '$' || inner === '`') dynamic = true
        text += inner
        at += 1
      }
      at += 1
    } else if (char === '\\') {
      if (at + 1 < command.length) text += command[at + 1]
      started = true
      at += 2
    } else if (/\s/.test(char)) {
      end()
      at += 1
    } else if ('&|;'.includes(char)) {
      end()
      at += command[at + 1] === char && char !== ';' ? 2 : 1
      tokens.push({ kind: 'between' })
    } else if (char === '<' || char === '>') {
      // A word of digits just before it is the stream it redirects (`2>`).
      if (started && !/^\d+$/.test(text)) end()
      text = ''
      started = false
      dynamic = false
      let op = char
      at += 1
      if (command[at] === char) {
        op += char
        at += 1
      }
      if (command[at] === '&') {
        at += 1
        while (at < command.length && /[\d-]/.test(command[at]!)) at += 1
        tokens.push({ kind: 'redirect', target: false })
      } else tokens.push({ kind: 'redirect', target: true })
    } else {
      if ('$`*?['.includes(char)) dynamic = true
      text += char
      started = true
      at += 1
    }
  }
  end()
  return tokens
}

/** A word that names a file: with a folder in it, or a file's extension; never an option, an address, a package or an install's own tool. */
const fileLike = (word: string) =>
  word !== '' &&
  !word.startsWith('-') &&
  !word.includes('://') &&
  !word.startsWith('~') &&
  !word.startsWith('@') &&
  !word.split('/').includes('node_modules') &&
  (word.includes('/') || /\.[a-z][a-z0-9]*$/i.test(word))

/** What a command needs of where it runs: the files it names in its repository, and the folders outside it it changes to. */
export interface Named {
  readonly files: ReadonlyArray<string>
  readonly outside: ReadonlyArray<string>
}

/**
 * The files a command names, as paths from the repository's root, from `within` (the folder in it the project is
 * about), following each `cd` before them, sorted, each once; and the folders outside the repository it changes to.
 * Null where they can't be told for sure: what the shell works out, a quote never closed, or a `cd` that leaves the
 * repository by a relative path.
 */
export const filesNamed = (command: string, within: string | null = null): Named | null => {
  const tokens = shellWords(command)
  if (tokens === null) return null
  let folder = posix.normalize(within ?? '.')
  let outsideAt: string | null = null
  const files = new Set<string>()
  const outside = new Set<string>()
  const commands: Array<Array<Word>> = [[]]
  let target = false
  for (const token of tokens) {
    if (token.kind === 'between') commands.push([])
    else if (token.kind === 'redirect') target = token.target
    // Where it writes (`> run.log`) isn't what it needs.
    else if (target) target = false
    else commands.at(-1)!.push(token)
  }
  for (const words of commands) {
    // Settings before the command (`PATH="…" vp dev`) name nothing of the repository's.
    while (words[0] !== undefined && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0].text)) words.shift()
    const [first, ...rest] = words
    if (first === undefined) continue
    if (first.text === 'cd') {
      const to = rest[0]
      if (to === undefined || to.dynamic) return null
      if (posix.isAbsolute(to.text)) {
        outsideAt = posix.normalize(to.text)
        outside.add(outsideAt)
        continue
      }
      if (outsideAt !== null) {
        outsideAt = posix.join(outsideAt, to.text)
        continue
      }
      folder = posix.join(folder, to.text)
      if (folder === '..' || folder.startsWith('../')) return null
      continue
    }
    // In a folder outside the repository, what it names there is that folder's.
    if (outsideAt !== null) continue
    for (const word of words) {
      // What the shell works out (`"$CONFIG"`, `lab/*.ts`) may be any file, whatever it looks like unexpanded.
      if (word.dynamic) return null
      // `--config=lab/x.ts` names what follows the `=`.
      const value = word.text.startsWith('-') && word.text.includes('=') ? word.text.slice(word.text.indexOf('=') + 1) : word.text
      if (!fileLike(value) || posix.isAbsolute(value)) continue
      const path = posix.join(folder, value)
      if (path === '..' || path.startsWith('../')) continue
      files.add(path)
    }
  }
  return { files: [...files].sort(), outside: [...outside].sort() }
}
