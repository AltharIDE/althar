import { existsSync } from 'node:fs'

import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { baseOf, changedBetween, type ChangedFile, changedFiles, newFile } from './diffs'
import { commitOf, currentBranch, git, gitExactly, untouched } from './git'
import { Instance } from './Instance'

/*
 * What a lead (or a reviewer) sees of the project's other tasks' work: each
 * one's change against where its branch started, read from git when asked
 * and never kept, as the Changes view reads it (diffs.ts). Read-only, and
 * read by the runtime on the lead's behalf, so the lead's sandbox needn't
 * reach another task's folder. Its worktree, or for a Local task the
 * person's checkout while the task holds it, is read as it stands, what
 * isn't committed included, without touching it (`untouched`): on a copy of
 * its index, with git's optional locks off, so the lead working there sees
 * no index written and no lock taken. A task whose folder is gone, or a
 * Local one whose checkout is on another branch now, is read from its
 * branch's commits alone.
 */

/** A task's place in one of its repositories here. */
interface Place {
  readonly slug: string
  readonly name: string
  readonly path: string
  readonly branch: string
  readonly baseRef: string | null
  readonly baseCommit: string | null
  readonly branched: number
  /** `checkout` for a Local task, in the person's own checkout; null for a worktree of its own. */
  readonly kind: string | null
  readonly state: string
  readonly returnedAt: string | null
  /** The repository's own checkout here, where its branches are. */
  readonly root: string | null
}

/** How a task's change in a repository was read: its folder as it stands, or its branch's commits alone, and why; or nothing yet. */
export type ReadFrom =
  | { readonly kind: 'folder'; readonly local: boolean }
  | { readonly kind: 'branch'; readonly why: 'gone' | 'away' }
  | { readonly kind: 'nothing'; readonly why: 'unbranched' | 'unstarted' }

/** What a task changed in one of its repositories, as another task's lead reads it. */
export interface RepositoryChange {
  readonly slug: string
  readonly name: string
  readonly path: string
  readonly branch: string
  readonly from: ReadFrom
  /** The folder git read it in: its own, or the repository's where its own is gone; null where nothing was read. */
  readonly readIn: string | null
  readonly base: string | null
  /** The branch's commit read, where its commits alone were. */
  readonly head: string | null
  readonly files: ReadonlyArray<ChangedFile>
}

/** A task's change across its repositories here, each file's path as the lead names it: under its repository's slug, in a task of several. */
export interface TaskChange {
  readonly repositories: ReadonlyArray<RepositoryChange>
  readonly several: boolean
}

const placesOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    return yield* sql<Place>`
      SELECT b.slug, b.display_name AS name, w.path, w.branch, w.base_ref, w.base_commit, w.branched_at IS NOT NULL AS branched,
        w.kind, w.state, w.returned_at, l.path AS root
      FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
      LEFT JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
      WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' ORDER BY b.created_at, b.rowid`
  })

/** What a task changed in one repository: from its folder as it stands where it is there and its own, else from its branch. */
const changeIn = (place: Place): Effect.Effect<RepositoryChange, unknown> =>
  Effect.gen(function* () {
    const about = { slug: place.slug, name: place.name, path: place.path, branch: place.branch }
    const nothing = (why: 'unbranched' | 'unstarted'): RepositoryChange => ({
      ...about,
      from: { kind: 'nothing', why },
      readIn: null,
      base: null,
      head: null,
      files: [],
    })
    if (place.baseCommit === null) return nothing('unstarted')
    const local = place.kind === 'checkout'
    // A Local task's checkout is its only while it holds it (local.ts), and on its branch: the person may have switched it since.
    const here = existsSync(place.path) && place.state !== 'cleaned'
    const held = !local || (place.state === 'ready' && place.returnedAt === null)
    if (here && held && (!local || (yield* currentBranch(place.path)) === place.branch)) {
      const started = place.baseCommit
      return yield* untouched(
        place.path,
        Effect.gen(function* () {
          const base = yield* baseOf(place.path, place.baseRef, started)
          const files = yield* changedFiles(place.path, base)
          return { ...about, from: { kind: 'folder', local } as const, readIn: place.path, base, head: null, files }
        }),
      )
    }
    if (place.branched === 0) return nothing('unbranched')
    // Worktrees share their repository, so the branch is there whichever folder git reads it from.
    const repository = here ? place.path : place.root
    if (repository === null || !existsSync(repository)) return nothing(local ? 'unstarted' : 'unbranched')
    const why = here ? 'away' : 'gone'
    return yield* untouched(
      repository,
      Effect.gen(function* () {
        const head = yield* commitOf(repository, `refs/heads/${place.branch}`).pipe(Effect.orElseSucceed(() => null))
        if (head === null) return nothing('unbranched')
        const met =
          place.baseRef === null ? null : yield* git(repository, 'merge-base', place.baseRef, head).pipe(Effect.orElseSucceed(() => null))
        const base = met ?? (place.baseCommit as string)
        const files = yield* changedBetween(repository, base, head)
        return { ...about, from: { kind: 'branch', why } as const, readIn: repository, base, head, files }
      }),
    )
  })

/** A task's change here, in each of its repositories, uncommitted work included where its folder is read. */
export const changeOf = (taskId: string): Effect.Effect<TaskChange, unknown, SqlClient.SqlClient | Instance> =>
  Effect.gen(function* () {
    const places = yield* placesOf(taskId)
    const repositories = yield* Effect.forEach(places, changeIn, { concurrency: 4 })
    return { repositories, several: places.length > 1 }
  })

/** A file's path as the lead names it: under its repository's slug, in a task of several. */
export const shownPath = (change: TaskChange, repository: RepositoryChange, path: string) =>
  change.several ? `${repository.slug}/${path}` : path

/** The paths two changes both touch, in the same repositories, as the first names them. */
export const sharedPaths = (mine: TaskChange, theirs: TaskChange): ReadonlyArray<string> => {
  const key = (slug: string, path: string) => `${slug}\u0000${path}`
  const touched = new Set(
    theirs.repositories.flatMap((repository) =>
      repository.files.flatMap((file) => [file.path, ...(file.from === null ? [] : [file.from])].map((path) => key(repository.slug, path))),
    ),
  )
  const shared = mine.repositories.flatMap((repository) =>
    repository.files
      .filter(
        (file) => touched.has(key(repository.slug, file.path)) || (file.from !== null && touched.has(key(repository.slug, file.from))),
      )
      .map((file) => shownPath(mine, repository, file.path)),
  )
  return [...new Set(shared)].toSorted()
}

/** The files a change touches, in a few words: the first few by name, and how many more. */
export const touchedWords = (change: TaskChange, shown = 6) => {
  const files = change.repositories.flatMap((repository) =>
    repository.files.map((file) => ({ path: shownPath(change, repository, file.path), uncommitted: file.uncommitted })),
  )
  if (files.length === 0) return 'no files changed yet'
  const named = files.slice(0, shown).map((file) => file.path)
  const more = files.length - named.length
  const uncommitted = files.filter((file) => file.uncommitted).length
  return `changes ${named.join(', ')}${more > 0 ? ` and ${more} more` : ''}${uncommitted === 0 ? '' : ` (${uncommitted} with work not committed yet)`}`
}

/** How many lines of a diff a page holds: a few thousand words, what an agent reads in one go. */
export const PAGE_LINES = 600
/** How many files the list names before it says how many more. */
const FILES_LISTED = 200

const fileLine = (shown: string, file: ChangedFile, from: string | null) =>
  `- ${shown}: ${file.status}${from === null ? '' : ` from ${from}`}${file.binary ? ', binary' : `, +${file.add} −${file.del}`}${file.uncommitted ? ', not committed yet' : ''}`

/** Where a repository's change was read from, in words, for the head of a diff. */
const fromWords = (repository: RepositoryChange) => {
  const base = repository.base === null ? '' : ` against ${repository.base.slice(0, 12)}, where its branch started from its default branch`
  switch (repository.from.kind) {
    case 'folder':
      return repository.from.local
        ? `the person's own checkout it works in, ${repository.path}, on ${repository.branch}, as it stands now${base}: what isn't committed included, and the person's own edits there with it`
        : `its worktree, ${repository.path}, on ${repository.branch}, as it stands now${base}: what isn't committed included`
    case 'branch':
      return `its branch ${repository.branch} as committed${base}: ${repository.from.why === 'gone' ? 'its folder was removed' : "it works Local, and the person's checkout isn't on its branch now"}, so nothing uncommitted is read`
    case 'nothing':
      return repository.from.why === 'unbranched'
        ? 'no branch yet: it has changed nothing in the repository'
        : 'it hasn’t started there yet'
  }
}

/** A new file nobody has added to git yet, as a diff that adds it. */
const newFileDiff = (folder: string, path: string, prefix: string) =>
  Effect.map(newFile(folder, path, true), (content) => {
    const head = `diff --git a/${prefix}${path} b/${prefix}${path}\nnew file, not added to git yet\n`
    if (content.kind === 'binary') return `${head}Binary file, not shown.`
    if (content.kind === 'other') return `${head}Not a file git adds.`
    const text = content.kind === 'link' ? content.target : content.text
    const lines = text === '' ? [] : (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n')
    return `${head}--- /dev/null\n+++ b/${prefix}${path}\n@@ -0,0 +1,${lines.length} @@${content.kind === 'link' ? ' (a link, to)' : ''}\n${lines.map((line) => `+${line}`).join('\n')}`
  })

/**
 * The diff of some of a repository's changed files, as git writes it: tracked files in one go, then each new file nobody has
 * added. Each path under `prefix`, its repository's slug in a task of several, as the list names it.
 */
const diffText = (repository: RepositoryChange, files: ReadonlyArray<ChangedFile>, prefix: string) =>
  Effect.gen(function* () {
    const { base, readIn: read } = repository
    if (files.length === 0 || base === null || read === null) return ''
    const folder = repository.from.kind === 'folder' ? read : null
    return yield* untouched(
      read,
      Effect.gen(function* () {
        // Nobody has added these yet, so git has no diff of them: read as git would add them.
        const untracked =
          folder === null
            ? new Set<string>()
            : new Set(
                (yield* git(folder, '--literal-pathspecs', 'ls-files', '--others', '--exclude-standard', '-z')).split('\0').filter(Boolean),
              )
        const tracked = files.filter((file) => !untracked.has(file.path))
        const paths = tracked.flatMap((file) => (file.from === null ? [file.path] : [file.from, file.path]))
        const text =
          paths.length === 0
            ? ''
            : yield* gitExactly(
                read,
                '--literal-pathspecs',
                'diff',
                '--no-color',
                '--no-ext-diff',
                '--no-textconv',
                '-M',
                '-U3',
                `--src-prefix=a/${prefix}`,
                `--dst-prefix=b/${prefix}`,
                base,
                ...(repository.head === null ? [] : [repository.head]),
                '--',
                ...paths,
              )
        const added =
          folder === null
            ? []
            : yield* Effect.forEach(
                files.filter((file) => untracked.has(file.path)),
                (file) => newFileDiff(folder, file.path, prefix),
                { concurrency: 8 },
              )
        return [text.trimEnd(), ...added].filter((part) => part !== '').join('\n')
      }),
    )
  })

/**
 * Another task's change as read_task_diff says it: where it was read from,
 * the files it changed, and their diff, of all of them or of the paths
 * asked for, a page at a time where it is long. A path not in its change is
 * said, never read.
 */
export const diffWords = (
  task: { readonly slug: string; readonly title: string },
  change: TaskChange,
  asked: { readonly paths?: ReadonlyArray<string> | undefined; readonly page?: number | undefined },
) =>
  Effect.gen(function* () {
    const lines: Array<string> = [`${task.slug}: ${task.title}. Read-only: nothing here changes it, or the folder it works in.`]
    if (change.repositories.length === 0) return `${lines[0]}\n\nIt has no folder on this computer yet: nothing to read.`
    const all = change.repositories.flatMap((repository) =>
      repository.files.map((file) => ({ repository, file, shown: shownPath(change, repository, file.path) })),
    )
    for (const repository of change.repositories)
      lines.push(`${change.several ? `${repository.name}: ` : 'Read from '}${fromWords(repository)}.`)
    if (all.length === 0) return [...lines, 'It has changed no files yet.'].join('\n\n')

    const wanted =
      asked.paths === undefined || asked.paths.length === 0 ? null : new Set(asked.paths.map((path) => path.replace(/^\.\//, '')))
    const picked = wanted === null ? all : all.filter((entry) => wanted.has(entry.shown))
    const missing = wanted === null ? [] : [...wanted].filter((path) => !all.some((entry) => entry.shown === path))
    const added = all.reduce((sum, entry) => sum + entry.file.add, 0)
    const removed = all.reduce((sum, entry) => sum + entry.file.del, 0)
    lines.push(
      [
        `Files it changed (${all.length}, +${added} −${removed}):`,
        ...all
          .slice(0, FILES_LISTED)
          .map((entry) =>
            fileLine(entry.shown, entry.file, entry.file.from === null ? null : shownPath(change, entry.repository, entry.file.from)),
          ),
        ...(all.length > FILES_LISTED ? [`… and ${all.length - FILES_LISTED} more.`] : []),
      ].join('\n'),
    )
    if (missing.length > 0) lines.push(`Not in its change, so not read: ${missing.join(', ')}.`)
    if (picked.length === 0) return lines.join('\n\n')

    const texts = yield* Effect.forEach(
      change.repositories,
      (repository) =>
        diffText(
          repository,
          picked.filter((entry) => entry.repository === repository).map((entry) => entry.file),
          change.several ? `${repository.slug}/` : '',
        ),
      { concurrency: 'unbounded' },
    )
    const diff = texts
      .filter((text) => text !== '')
      .join('\n')
      .split('\n')
    const pages = Math.max(1, Math.ceil(diff.length / PAGE_LINES))
    const page = Math.min(Math.max(1, Math.trunc(asked.page ?? 1)), pages)
    const from = (page - 1) * PAGE_LINES
    lines.push(diff.slice(from, from + PAGE_LINES).join('\n'))
    if (pages > 1)
      lines.push(
        `(Page ${page} of ${pages}: lines ${from + 1}–${Math.min(from + PAGE_LINES, diff.length)} of ${diff.length}.${page < pages ? ` read_task_diff with page ${page + 1} reads on;` : ''} pass paths to read only some files.)`,
      )
    return lines.join('\n\n')
  })
