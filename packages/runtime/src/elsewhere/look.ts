import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

import type { OtherTool } from '@althar/domain'
import { Effect } from 'effect'

import { git, untouched } from '../git'
import { type Agent, claudeSessions, codexThreads, type Conversation } from './conversations'
import { madeBy, type Places, within } from './places'
import { type FoundSetup, setupsIn } from './setups'
import { type Recorded, readStores } from './stores'

/*
 * What other tools left for a project's repositories on this computer
 * (docs/decisions/workspaces-and-runs.md, "Bringing in other tools' work"):
 * every worktree git knows for each repository that isn't its checkout or
 * Althar's own, with what it holds; the setups other tools keep in it; and
 * the conversations Claude Code and Codex had in it or its worktrees.
 *
 * Worktrees are found through git, not through the tools: `git worktree
 * list` names every one, whoever made it, and each tool's records only say
 * whose it is and what it's called. So a worktree a tool Althar doesn't know
 * made, or one a person made by hand, is found too. Reading changes nothing:
 * git reads a worktree's state on a copy of its index with its optional
 * locks off, as it does for another task's folder, so the tool that has the
 * folder open never sees its index rewritten.
 */

export interface Repository {
  readonly bindingId: string
  readonly name: string
  /** Its checkout on this computer. */
  readonly path: string
  readonly defaultBranch: string | null
}

export interface FoundWorktree {
  readonly key: string
  readonly tool: OtherTool
  readonly bindingId: string
  readonly repository: string
  readonly path: string
  /** Its branch; null where it is detached, as Codex makes them. */
  readonly branch: string | null
  readonly head: string
  /** What its tool calls it, else its folder's name. */
  readonly name: string
  readonly asked: string | null
  /** Files changed and not committed, new ones too. */
  readonly uncommitted: number
  /** Commits no remote has; null where git couldn't say. */
  readonly unpushed: number | null
  /** Commits its default branch doesn't have; null where git couldn't say. */
  readonly ahead: number | null
  readonly pullRequest: { readonly number: number; readonly url: string } | null
  /** Its tool archived it, though its folder stays. */
  readonly archived: boolean
  readonly locked: boolean
  readonly lastAt: string | null
}

export interface FoundSetupItem extends FoundSetup {
  readonly key: string
  readonly bindingId: string
  readonly repository: string
}

export interface FoundConversation extends Conversation {
  readonly key: string
  /** The worktree it ran in, by its key; null where it ran in the repository's checkout or a folder inside it. */
  readonly worktree: string | null
}

export interface Found {
  readonly worktrees: ReadonlyArray<FoundWorktree>
  readonly setups: ReadonlyArray<FoundSetupItem>
  readonly conversations: ReadonlyArray<FoundConversation>
}

export const worktreeKey = (path: string) => `worktree:${path}`
/** A setup's key, by its tool and its repository's checkout: the same before its project is made and after. */
export const setupKey = (tool: OtherTool, repository: string) => `setup:${tool}:${repository}`
export const conversationKey = (agent: Agent, id: string) => `${agent}:${id}`

const real = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

interface Listed {
  readonly path: string
  readonly head: string
  readonly branch: string | null
  readonly locked: boolean
}

/** `git worktree list --porcelain -z`, its first, the checkout itself, left out, and those whose folder is gone or bare. */
export const listWorktrees = (repository: string) =>
  Effect.map(git(repository, 'worktree', 'list', '--porcelain', '-z'), (out): ReadonlyArray<Listed> => {
    const records: Array<Array<string>> = [[]]
    for (const field of out.split('\0')) {
      if (field === '') records.push([])
      else records.at(-1)?.push(field)
    }
    const listed = records
      .filter((fields) => fields.length > 0)
      .map((fields) => {
        const value = (key: string) => fields.find((field) => field === key || field.startsWith(`${key} `))
        const path = value('worktree')?.slice('worktree '.length) ?? ''
        const branch = value('branch')?.slice('branch '.length) ?? null
        return {
          path,
          head: value('HEAD')?.slice('HEAD '.length) ?? '',
          branch: branch?.startsWith('refs/heads/') === true ? branch.slice('refs/heads/'.length) : branch,
          locked: value('locked') !== undefined,
          gone: value('prunable') !== undefined || value('bare') !== undefined,
        }
      })
    return listed.slice(1).filter((one) => !one.gone && one.path !== '' && existsSync(one.path))
  })

/** The git folder of a worktree's own, from its `.git` file. */
const gitDirOf = (path: string) => {
  try {
    const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(join(path, '.git'), 'utf8'))?.[1]?.trim()
    return pointer === undefined ? null : isAbsolute(pointer) ? pointer : resolve(path, pointer)
  } catch {
    return null
  }
}

const count = (out: string) => {
  if (out.trim() === '') return null
  const n = Number(out.trim())
  return Number.isInteger(n) ? n : null
}

/** How many entries `git status --porcelain -z` lists: a rename's or copy's second path is its own. */
export const statusCount = (out: string) => {
  const fields = out.split('\0').filter((field) => field !== '')
  let n = 0
  for (let at = 0; at < fields.length; at++) {
    n++
    if (/^[RC]/.test(fields[at] ?? '')) at++
  }
  return n
}

/** What a worktree holds, read without touching its index: changes not committed, commits no remote has, commits past its default branch. */
const stateOf = (listed: Listed, defaultBranch: string | null) =>
  Effect.gen(function* () {
    const uncommitted = yield* untouched(listed.path, git(listed.path, 'status', '--porcelain=v1', '-z', '--untracked-files=normal')).pipe(
      Effect.map(statusCount),
      Effect.orElseSucceed(() => 0),
    )
    // Past its upstream; else on no remote at all; with no remote to push to, nothing is said.
    const unpushed = yield* git(listed.path, 'rev-list', '--count', '@{upstream}..HEAD').pipe(
      Effect.catch(() =>
        Effect.flatMap(git(listed.path, 'remote'), (remotes) =>
          remotes === '' ? Effect.succeed('') : git(listed.path, 'rev-list', '--count', 'HEAD', '--not', '--remotes'),
        ),
      ),
      Effect.map(count),
      Effect.orElseSucceed(() => null),
    )
    const base = defaultBranch === null ? null : `origin/${defaultBranch}`
    const ahead =
      base === null
        ? null
        : yield* git(listed.path, 'rev-list', '--count', `${base}..HEAD`).pipe(
            Effect.catch(() => git(listed.path, 'rev-list', '--count', `${defaultBranch ?? 'main'}..HEAD`)),
            Effect.map(count),
            Effect.orElseSucceed(() => null),
          )
    const lastAt = yield* git(listed.path, 'log', '-1', '--format=%cI', 'HEAD').pipe(
      Effect.map((out) => (out === '' ? null : new Date(out).toISOString())),
      Effect.orElseSucceed(() => null),
    )
    return { uncommitted, unpushed, ahead, lastAt }
  })

export interface LookOptions {
  /** A folder that is Althar's own: a task's worktree, a review's copy. */
  readonly ours: (path: string) => boolean
  /** The agent sessions Althar itself started, by the agent's own id: its leads' and coordinator's, never brought in. */
  readonly sessions: ReadonlySet<string>
}

/** What other tools left for these repositories. Each source is read on its own: one that fails finds nothing, and the rest are read. */
export const lookAt = (repositories: ReadonlyArray<Repository>, given: Places, options: LookOptions) =>
  Effect.gen(function* () {
    // Every folder as the file system has it, as git names worktrees: a home reached through a link (macOS's /var is
    // /private/var) is the same home.
    const places: Places = {
      ...given,
      home: real(given.home),
      claude: real(given.claude),
      codex: real(given.codex),
      t3: real(given.t3),
      paradev: given.paradev.map(real),
      orca: given.orca.map(real),
      conductor: real(given.conductor),
      cursor: real(given.cursor),
    }
    const read = yield* Effect.promise(() => readStores(places).catch(() => ({ worktrees: [], roots: { orca: [], t3: [], paradev: [] } })))
    const stores = {
      ...read,
      roots: { orca: read.roots.orca.map(real), t3: read.roots.t3.map(real), paradev: read.roots.paradev.map(real) },
    }
    const recorded = new Map<string, Recorded>(stores.worktrees.map((one) => [real(one.path), one]))
    const worktrees: Array<FoundWorktree> = []
    const setups: Array<FoundSetupItem> = []
    for (const repository of repositories) {
      const root = real(repository.path)
      const listed = yield* listWorktrees(root).pipe(Effect.orElseSucceed((): ReadonlyArray<Listed> => []))
      const theirs = listed
        .map((one) => ({ ...one, path: real(one.path) }))
        .filter((one) => one.path !== root && !options.ours(one.path) && one.branch !== repository.defaultBranch)
      const read = yield* Effect.forEach(theirs, (one) => Effect.map(stateOf(one, repository.defaultBranch), (state) => ({ one, state })), {
        concurrency: 8,
      })
      for (const { one, state } of read) {
        const record = recorded.get(one.path)
        const gitDir = gitDirOf(one.path)
        const codexMarked = gitDir !== null && existsSync(join(gitDir, 'codex-thread.json'))
        const tool = record?.tool ?? madeBy({ path: one.path, repository: root, codexMarked }, places, stores.roots)
        worktrees.push({
          key: worktreeKey(one.path),
          tool,
          bindingId: repository.bindingId,
          repository: repository.name,
          path: one.path,
          branch: one.branch,
          head: one.head,
          // Codex names its worktree folders after the repository, in a folder of its own named by an id: its parent says which.
          name: record?.name ?? (tool === 'codex' ? basename(dirname(one.path)) : basename(one.path)),
          asked: record?.asked ?? null,
          ...state,
          pullRequest: record?.pullRequest ?? null,
          archived: record?.archived ?? false,
          locked: one.locked,
          lastAt: state.lastAt ?? record?.createdAt ?? null,
        })
      }
      const kept = yield* Effect.promise(() => setupsIn(root, repository.defaultBranch ?? 'main').catch(() => []))
      for (const setup of kept)
        setups.push({
          ...setup,
          key: setupKey(setup.tool, root),
          bindingId: repository.bindingId,
          repository: repository.name,
        })
    }
    // Where conversations are looked for: each checkout, and each worktree found, longest first so one inside another is its own.
    const folders = [...repositories.map((one) => real(one.path)), ...worktrees.map((one) => one.path)]
    const said = yield* Effect.promise(async () => {
      const [claude, codex] = await Promise.all([
        claudeSessions(places, folders).catch(() => []),
        codexThreads(places, folders).catch(() => []),
      ])
      return [...claude, ...codex]
    })
    const byLength = worktrees.toSorted((a, b) => b.path.length - a.path.length)
    const conversations = said
      .filter((one) => !options.sessions.has(one.id) && !options.ours(real(one.cwd)))
      .map((one): FoundConversation => {
        const cwd = real(one.cwd)
        return {
          ...one,
          cwd,
          key: conversationKey(one.agent, one.id),
          worktree: byLength.find((worktree) => within(cwd, worktree.path))?.key ?? null,
        }
      })
      .toSorted((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
    return { worktrees, setups, conversations } satisfies Found
  })
