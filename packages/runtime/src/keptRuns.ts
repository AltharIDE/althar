import { posix } from 'node:path'

/*
 * What a run a task kept needs of its repository (docs/decisions/workspaces-and-runs.md, "What a project runs"): the
 * files its command names, as the repository holds them, from where it runs. A run a task's lead kept goes once that
 * task's worktrees are cleaned up, unless every file it names is on the default branch, as when its config merged: then
 * it still runs as kept there.
 */

/** A word that names a file: with a folder in it, or a file's extension; never an option, a variable, an address, a package or an install's own tool. */
const fileLike = (word: string) =>
  word !== '' &&
  !word.startsWith('-') &&
  !word.includes('$') &&
  !word.includes('://') &&
  !word.includes('*') &&
  !posix.isAbsolute(word) &&
  !word.startsWith('~') &&
  !word.startsWith('@') &&
  !word.split('/').includes('node_modules') &&
  (word.includes('/') || /\.[a-z][a-z0-9]*$/i.test(word))

const unquoted = (word: string) => word.replace(/^(['"])(.*)\1$/, '$2')

/**
 * The files a command names, as paths from the repository's root, from `within` (the folder in it the project is
 * about), following each `cd` before them; those outside the repository, or named after a `cd` it can't follow, aren't
 * counted. Sorted, each once.
 */
export const filesNamed = (command: string, within: string | null = null): ReadonlyArray<string> => {
  let folder: string | null = posix.normalize(within ?? '.')
  const named = new Set<string>()
  for (const part of command.split(/&&|\|\||;|\|/)) {
    const words = part.trim().split(/\s+/).map(unquoted)
    // Settings before the command (`PATH="…" vp dev`) name nothing of the repository's.
    while (words[0] !== undefined && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift()
    if (words[0] === 'cd') {
      const to = words[1] ?? ''
      folder = folder !== null && to !== '' && !posix.isAbsolute(to) && !to.includes('$') ? posix.join(folder, to) : null
      continue
    }
    if (folder === null) continue
    for (const [at, word] of words.entries()) {
      // Where it writes (`> run.log`, `2>&1`) isn't what it needs.
      if (/^\d*[<>]/.test(word) || /^\d*[<>]+&?$/.test(words[at - 1] ?? '')) continue
      // `--config=lab/x.ts` names what follows the `=`.
      const value = word.includes('=') && word.startsWith('-') ? unquoted(word.slice(word.indexOf('=') + 1)) : word
      if (!fileLike(value)) continue
      const path = posix.join(folder, value)
      if (path === '..' || path.startsWith('../')) continue
      named.add(path)
    }
  }
  return [...named].sort()
}
