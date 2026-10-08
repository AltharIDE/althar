import { branchNameOk, fillPattern, type NameKind, patternProblem } from '@althar/contracts'
import { Effect } from 'effect'

import { commitOf, git, gitExactly } from './git'

/*
 * A team's conventions for pull requests, as its repository writes them down
 * (DEV-42): how branches and titles are named, in its contributing guide,
 * its agents' instructions or its readme, and the template a pull request's
 * description is written in. Read from git each time they're needed, so a
 * change to them holds from the next task on. Patterns are only what a doc
 * spells out plainly, an example or one with placeholders; a doc that offers
 * several, `feature/` for one kind and `fix/` for another, is a judgement
 * Althar leaves to the person's own rule.
 */

/** The docs a repository's naming is read from, the first that names something first. */
export const DOCS = ['CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'docs/CONTRIBUTING.md', 'AGENTS.md', 'CLAUDE.md', 'README.md']

/** Where GitHub, GitLab (its default) and Bitbucket Cloud look for a pull request's template, in that order. */
export const TEMPLATES = [
  '.github/pull_request_template.md',
  'pull_request_template.md',
  'docs/pull_request_template.md',
  '.gitlab/merge_request_templates/Default.md',
  '.bitbucket/pull_request_template.md',
]

/** A pattern a doc spells out, and the doc. */
export interface Found {
  readonly pattern: string
  readonly from: string
}

/** What a repository says of its pull requests. */
export interface Conventions {
  readonly branch: Found | null
  readonly title: Found | null
  readonly template: { readonly path: string; readonly text: string } | null
}

export const NO_CONVENTIONS: Conventions = { branch: null, title: null, template: null }

/** How much of a doc is read: a readme can be long, and what it says of branches is rarely far in. */
const READ = 200_000

/* ---- Reading them from docs ---- */

/** A placeholder's name, as what Althar fills it with: the issue's key, or the task's name. */
const placeOf = (name: string, words: 'slug' | 'title'): string | null => {
  if (/key|ticket|issue|jira|linear|\bid\b|number|\bno\b|card|story/i.test(name)) return '{key}'
  if (/desc|slug|name|title|summary|subject|topic|short|feature|change|what/i.test(name)) return `{${words}}`
  return null
}

/** Placeholders as a doc writes them: `<ticket>`, `{description}`, `[issue-id]`. */
const PLACEHOLDER = /<([^<>]+)>|\{([^{}]+)\}|\[([^[\]]+)\]/g

/** Swaps a candidate's placeholders for Althar's; null where it names one Althar can't fill, such as `<type>`. */
const withPlaces = (candidate: string, words: 'slug' | 'title') => {
  let unknown = false
  const swapped = candidate.replace(PLACEHOLDER, (whole, a?: string, b?: string, c?: string) => {
    const name = a ?? b ?? c ?? ''
    if (name === 'key' || name === words) return `{${name}}`
    // An example key in brackets, `[PROJ-123]`, is the key in its brackets.
    if (c !== undefined && KEY.test(c)) return '[{key}]'
    const place = placeOf(name, words)
    if (place === null) unknown = true
    return place ?? whole
  })
  // A placeholder twice, `users/<name>/<topic>`, is something Althar can't fill twice over.
  const places = swapped.match(/\{(key|slug|title)\}/g) ?? []
  return unknown || new Set(places).size !== places.length ? null : swapped
}

/** An issue's key, as an example writes one: `PROJ-123`, `#123`. */
const KEY = /^(?:[A-Z][A-Z0-9]*-\d+|#\d+)$/

/** What a candidate leaves for a branch: the names a repository's own branches go by aren't a pattern. */
const PLAIN_BRANCHES = /^(origin|upstream)\//

/** A doc's example or pattern of a branch name, as Althar's pattern, or null. */
export const branchPatternOf = (candidate: string): string | null => {
  const command = /\bgit\s+(?:checkout\s+-b|switch\s+-c|branch)\s+(\S+)/.exec(candidate)
  const token = (command?.[1] ?? candidate).trim()
  if (/\s|\.|:/.test(token) || PLAIN_BRANCHES.test(token)) return null
  let pattern = withPlaces(token, 'slug')
  if (pattern === null) return null
  if (!pattern.includes('{key}')) pattern = pattern.replace(/(?<=^|[/_-])(?:[A-Z][A-Z0-9]*-\d+|\d+)(?=$|[/_-])/, '{key}')
  // An example's description: words joined by hyphens after the last separator. A single word is a branch's name, `main`.
  if (!pattern.includes('{slug}')) {
    const example = /([/_-])([a-z][a-z0-9]*(?:-[a-z0-9]+)+)$/.exec(pattern)
    const afterKey = /(\{key\}[/_-])([a-z][a-z0-9]*)$/.exec(pattern)
    const tail = example ?? afterKey
    if (tail === null) return null
    pattern = `${pattern.slice(0, tail.index)}${tail[1]}{slug}`
  }
  if (pattern === '{slug}' || patternProblem('branch', pattern) !== null) return null
  return pattern
}

/** A doc's example or pattern of a pull request's title, as Althar's pattern, or null. Only the issue's key and the title: no other words. */
export const titlePatternOf = (candidate: string): string | null => {
  let pattern = withPlaces(candidate.trim(), 'title')
  if (pattern === null) return null
  if (!pattern.includes('{key}')) pattern = pattern.replace(/(?<=^|[[(\s])(?:[A-Z][A-Z0-9]*-\d+|#\d+)(?=$|[\])\s:|-])/, '{key}')
  if (!pattern.includes('{title}')) pattern = pattern.replace(/(\{key\}[\])]?(?:\s*[:|-]\s*|\s+))\S.*$/, '$1{title}')
  if (!pattern.includes('{key}') || patternProblem('title', pattern) !== null) return null
  if (/[A-Za-z0-9]/.test(pattern.replace(/\{(key|title)\}/g, ''))) return null
  return pattern
}

/** Code a doc quotes near what it says: inline spans, and the lines of a fenced block. */
const quotedIn = (lines: ReadonlyArray<string>) =>
  lines.flatMap((line) => {
    const spans = [...line.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? '')
    return spans.length > 0 ? spans : /^\s*(?:\$\s*)?git\s/.test(line) ? [line] : []
  })

/** The one pattern a doc's candidates agree on; none where they say several things, or nothing. */
const distinct = (patterns: ReadonlyArray<string | null>) => [...new Set(patterns.filter((pattern) => pattern !== null))]

/** The patterns a doc offers for branch names: the code quoted on a line that speaks of branches, or the few after it. */
export const branchIn = (text: string) => {
  const lines = text.split('\n')
  const candidates = lines.flatMap((line, at) => (/\bbranch/i.test(line) ? quotedIn(lines.slice(at, at + 4)) : []))
  return distinct(candidates.map(branchPatternOf))
}

/** The patterns a doc offers for pull requests' titles: the code quoted where a line speaks of a title, under a pull request heading or beside one. */
export const titleIn = (text: string) => {
  const lines = text.split('\n')
  let heading = ''
  const candidates = lines.flatMap((line, at) => {
    if (/^\s{0,3}#/.test(line)) heading = line
    const aboutChanges = /pull request|merge request|\bPRs?\b|\bMRs?\b/i
    return /\btitle/i.test(line) && (aboutChanges.test(line) || aboutChanges.test(heading)) ? quotedIn(lines.slice(at, at + 4)) : []
  })
  return distinct(candidates.map(titlePatternOf))
}

/**
 * What a repository's docs say of naming: the first doc, in `DOCS`'s order,
 * that offers a pattern decides. One that offers several leaves it to the
 * person, rather than to an older doc further down.
 */
export const namingIn = (docs: ReadonlyArray<{ readonly path: string; readonly text: string }>) => {
  const first = (read: (text: string) => ReadonlyArray<string>): Found | null => {
    for (const doc of docs) {
      const [pattern, ...others] = read(doc.text)
      if (pattern !== undefined) return others.length === 0 ? { pattern, from: doc.path } : null
    }
    return null
  }
  return { branch: first(branchIn), title: first(titleIn) }
}

/* ---- Reading them from git ---- */

/** A path among a tree's, by how it's spelt here: hosts and filesystems often don't mind case. */
const pathIn = (paths: ReadonlyArray<string>, wanted: string) => paths.find((path) => path.toLowerCase() === wanted.toLowerCase())

/**
 * What a repository says of its pull requests, at a commit: the default
 * branch as a task starts from it, or a task's worktree as it ends. Nothing,
 * where git can't read it.
 */
export const conventionsAt = (repository: string, ref: string): Effect.Effect<Conventions> =>
  Effect.gen(function* () {
    const directories = ['.github/', 'docs/', '.gitlab/merge_request_templates/', '.bitbucket/']
    const listed = `${yield* git(repository, 'ls-tree', '--name-only', ref)}\n${yield* git(repository, 'ls-tree', '--name-only', ref, '--', ...directories)}`
    const paths = listed.split('\n').filter((path) => path !== '')
    const show = (path: string) => Effect.map(gitExactly(repository, 'show', `${ref}:${path}`), (text) => text.slice(0, READ))
    const docs = yield* Effect.forEach(
      DOCS.flatMap((wanted) => pathIn(paths, wanted) ?? []),
      (path) => Effect.map(show(path), (text) => ({ path, text })),
    )
    const templatePath = TEMPLATES.flatMap((wanted) => pathIn(paths, wanted) ?? [])[0]
    const template = templatePath === undefined ? null : { path: templatePath, text: yield* show(templatePath) }
    return { ...namingIn(docs), template: template === null || template.text.trim() === '' ? null : template }
  }).pipe(Effect.orElseSucceed(() => NO_CONVENTIONS))

/** What a repository says as a task starts from it: its default branch as its remote has it, else as it is here. */
export const conventionsOnBase = (repository: string, base: string, remote = 'origin') =>
  Effect.gen(function* () {
    const ref = yield* commitOf(repository, `${remote}/${base}`).pipe(
      Effect.as(`${remote}/${base}`),
      Effect.catch(() => commitOf(repository, base).pipe(Effect.as(base))),
      Effect.orElseSucceed(() => 'HEAD'),
    )
    return yield* conventionsAt(repository, ref)
  })

/* ---- A pull request's description in its template ---- */

/** A line outside fenced code that is a heading: `## Summary`, or a line all in bold. */
const headingOf = (line: string) =>
  (/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line) ?? /^\s*\*\*([^*]+)\*\*:?\s*$/.exec(line))?.[1]?.trim().toLowerCase()

/** What's outside fenced code, line by line. */
const outsideFences = (markdown: string) => {
  let fenced = false
  return markdown.split('\n').filter((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      return false
    }
    return !fenced
  })
}

const headingsOf = (markdown: string) => outsideFences(markdown).flatMap((line) => headingOf(line) ?? [])

const CHECKBOX = /^(\s*[-*+]\s+)\[[ xX]\]\s+(.*\S)\s*$/

const checklistOf = (markdown: string) =>
  outsideFences(markdown).flatMap((line) => {
    const item = CHECKBOX.exec(line)?.[2]
    return item === undefined ? [] : [item.toLowerCase()]
  })

/** Every box unticked: what Althar can't vouch for, a person does. */
export const untick = (markdown: string) => markdown.replace(/^(\s*[-*+]\s+)\[[xX]\]/gm, '$1[ ]')

/** Whether a description keeps its template: every heading, in order, and every item of its checklists. */
export const keepsTemplate = (template: string, written: string) => {
  const theirs = headingsOf(written)
  let at = 0
  for (const heading of headingsOf(template)) {
    at = theirs.indexOf(heading, at)
    if (at === -1) return false
    at += 1
  }
  // Each item as often as the template has it: two sections may each end in `- [ ] Done`.
  const items = checklistOf(written)
  return checklistOf(template).every((item) => {
    const index = items.indexOf(item)
    if (index !== -1) items.splice(index, 1)
    return index !== -1
  })
}

/** Headings where a summary of the change goes, the likeliest first: `What type of change` is a checklist, not one. */
const SUMMARY = [/\b(summary|description)\b/, /\b(overview|changes|context|about|motivation)\b/, /^what\b(?!.*\btype\b)/]

/**
 * A template with a summary in its own place for one: under its first
 * heading that asks what changed, after what it says there to whoever fills
 * it in, a comment most often. Null where it has no such place.
 */
export const placeSummary = (template: string, summary: string): string | null => {
  const lines = template.split('\n')
  const headings = lines.map(headingOf)
  const at = SUMMARY.map((wanted) => headings.findIndex((heading) => heading !== undefined && wanted.test(heading))).find(
    (index) => index !== -1,
  )
  if (at === undefined) return null
  let after = at + 1
  let comment = false
  while (after < lines.length) {
    const line = lines[after] ?? ''
    if (comment || /^\s*<!--/.test(line)) comment = !/-->\s*$/.test(line)
    else if (line.trim() !== '') break
    after += 1
  }
  return [...lines.slice(0, after), '', summary, '', ...lines.slice(after)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}

/* ---- Names ---- */

/** The person's own pattern, where it's one Althar can follow; one it can't is as good as none. */
export const ruleOf = (kind: NameKind, pattern: string | undefined) =>
  pattern === undefined || patternProblem(kind, pattern) !== null ? null : pattern

/** A key as Althar's own branch has it: MER-231 is mer-231, GitHub's #12 is issue-12. */
export const branchKey = (key: string) => (key.startsWith('#') ? `issue-${key.slice(1)}` : key.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))

/**
 * A task's branch: by the pattern the project's rule or the repository's
 * docs give, else Althar's own, `althar/` and the issue's key, lowercased as
 * trackers' Git integrations read it, before the task's name.
 */
export const branchFor = (pattern: string | null, task: { readonly key: string | null; readonly slug: string }): string => {
  if (pattern === null) return task.key === null ? `althar/${task.slug}` : `althar/${branchKey(task.key)}-${task.slug}`
  // The key as the tracker writes it, `PROJ-123`, with GitHub's `#` gone and nothing git refuses.
  const key = task.key === null ? null : task.key.replace(/^#/, '').replace(/[^A-Za-z0-9_-]+/g, '-')
  const name = fillPattern(pattern, { key, slug: task.slug })
  // A name git would refuse all the same leaves the task on Althar's own, rather than without a worktree.
  return branchNameOk(name) ? name : branchFor(null, task)
}

/**
 * A pull request's title: by the pattern the project's rule or the
 * repository's docs give, else the task's own, with the issue's key in front
 * where the issue lives somewhere else and the host wouldn't link it.
 */
export const titleFor = (
  pattern: string | null,
  task: { readonly title: string; readonly issue: { readonly key: string; readonly sameHost: boolean } | null },
) => {
  if (pattern === null) return task.issue === null || task.issue.sameHost ? task.title : `${task.issue.key}: ${task.title}`
  return fillPattern(pattern, { key: task.issue?.key ?? null, title: task.title })
}
