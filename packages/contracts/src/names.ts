/*
 * How a task's branch and its pull request's title are named, by a pattern:
 * the project's rule, or what a repository's own docs say. `{key}` is the
 * issue's key, `{slug}` the task's name as a branch has it, and `{title}`
 * the task's title. The runtime names with them; the rules screen checks
 * what the person types and shows what it makes.
 */

/** What a pattern names. */
export type NameKind = 'branch' | 'title'

const PLACES: Record<NameKind, ReadonlyArray<string>> = { branch: ['key', 'slug'], title: ['key', 'title'] }
const NEEDED: Record<NameKind, string> = { branch: 'slug', title: 'title' }

/** What separates a placeholder from what's next to it, and goes with it when it's left out. */
const SEPARATORS = String.raw`[\s:/_.#-]*`

/**
 * A pattern with its placeholders filled. One without a value, a task with
 * no issue's `{key}`, goes with what holds it to its neighbours: the
 * separators after it, or before it at the end, and brackets round it.
 */
export const fillPattern = (pattern: string, values: Readonly<Record<string, string | null>>) => {
  let filled = pattern
  for (const [name, value] of Object.entries(values)) {
    if (value !== null) continue
    const place = String.raw`[[(]?\{${name}\}[\])]?`
    filled = filled.replace(new RegExp(`${place}${SEPARATORS}(?=\\S)`, 'g'), '').replace(new RegExp(`${SEPARATORS}${place}`, 'g'), '')
  }
  return filled.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole).trim()
}

/** A character git refuses in a branch name, or a run of them it refuses together. */
const REFUSED = /[\s~^:?*[\\\p{Cc}]|\.\.|@\{|\/\/|^[/.-]|[/.]$|\.lock$|\/[.-]/u

/** Whether git takes a name as a branch's. */
export const branchNameOk = (name: string) => name !== '' && name !== '@' && !REFUSED.test(name)

/** What is wrong with a pattern, in words, or null where nothing is. */
export const patternProblem = (kind: NameKind, pattern: string): string | null => {
  const places = PLACES[kind].map((name) => `{${name}}`).join(' and ')
  const unknown = [...pattern.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1] ?? '').find((name) => !PLACES[kind].includes(name))
  if (unknown !== undefined) return `{${unknown}} isn't something Althar can fill. Use ${places}.`
  // What's left of a brace once the placeholders are out, `{{slug}}`, would be in every name.
  if (/[{}]/.test(pattern.replace(/\{(\w+)\}/g, ''))) return `Braces go round a placeholder only: ${places}.`
  if (!pattern.includes(`{${NEEDED[kind]}}`)) return `It needs {${NEEDED[kind]}}, so each task's is its own.`
  if (kind === 'branch' && !branchNameOk(fillPattern(pattern, { key: 'KEY-1', slug: 'slug' })))
    return 'Git doesn’t allow that in a branch name: no spaces, and none of ~ ^ : ? * [ \\ or “..”.'
  return null
}
