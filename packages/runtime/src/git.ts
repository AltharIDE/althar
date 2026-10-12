import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { Effect } from 'effect'

import { GitFailed } from './errors'

/*
 * The git commands the runtime runs itself, outside any agent. They never
 * prompt: a command that would ask for a password fails instead. They run
 * with the repository's hooks off (docs/architecture/07): adding a worktree
 * would otherwise run its `post-checkout` hook, code from the repository, on
 * the person's machine. A picked folder's path is the document portal's FUSE
 * mount inside a Flatpak, where a process cwd makes getcwd fail — a worktree
 * couldn't be added there — so exactly there the repository is given with
 * `-C`; everywhere else the process starts in it, as it always has.
 */

/** Where a picked folder is inside a Flatpak: the document portal's FUSE mount, where a cwd makes getcwd fail. */
const PORTAL = '/run/flatpak/doc'

/**
 * How a git command runs in `cwd`: with `-C` rather than as the process's own
 * working directory for the portal's FUSE mount, and as the process's own
 * working directory everywhere else.
 */
export const gitIn = (cwd: string, args: ReadonlyArray<string>): { readonly args: ReadonlyArray<string>; readonly cwd?: string } =>
  cwd === PORTAL || cwd.startsWith(`${PORTAL}/`) ? { args: ['-C', cwd, ...args] } : { args, cwd }

export const git = (cwd: string, ...args: ReadonlyArray<string>): Effect.Effect<string, GitFailed> => gitWithin(60_000, cwd, ...args)

/** A git command that gives up after `timeout` milliseconds, for those that reach the network. */
export const gitWithin = (timeout: number, cwd: string, ...args: ReadonlyArray<string>): Effect.Effect<string, GitFailed> =>
  run(timeout, cwd, args)

/** A git command's exit code and output, for a command whose failure says something, such as `merge-tree`'s conflicts. */
export const gitOutcome = (
  cwd: string,
  ...args: ReadonlyArray<string>
): Effect.Effect<{ readonly code: number; readonly stdout: string }> =>
  Effect.callback<{ readonly code: number; readonly stdout: string }>((resume) => {
    const at = gitIn(cwd, ['-c', 'core.hooksPath=/dev/null', ...args])
    execFile(
      'git',
      [...at.args],
      {
        ...(at.cwd === undefined ? {} : { cwd: at.cwd }),
        timeout: 60_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      },
      (error, stdout) =>
        resume(Effect.succeed({ code: error === null ? 0 : typeof error.code === 'number' ? error.code : 128, stdout: stdout.trim() })),
    )
  })

/** A git command's output exactly as it wrote it, for output whose spaces and last line matter, such as a diff. */
export const gitExactly = (cwd: string, ...args: ReadonlyArray<string>): Effect.Effect<string, GitFailed> =>
  run(60_000, cwd, args, {}, false)

const run = (
  timeout: number,
  cwd: string,
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string>> = {},
  trim = true,
  /** What the command reads, for one such as `cat-file --batch-check`. */
  input?: string,
): Effect.Effect<string, GitFailed> =>
  Effect.callback<string, GitFailed>((resume) => {
    const at = gitIn(cwd, ['-c', 'core.hooksPath=/dev/null', ...args])
    const child = execFile(
      'git',
      [...at.args],
      {
        ...(at.cwd === undefined ? {} : { cwd: at.cwd }),
        timeout,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...env },
      },
      (error, stdout, stderr) =>
        resume(
          error === null
            ? Effect.succeed(trim ? stdout.trim() : stdout)
            : Effect.fail(new GitFailed({ args: [...args], cwd, stderr: stderr.trim() || error.message })),
        ),
    )
    if (input === undefined || child.stdin === null) return
    // A git that ends before it has read everything fails on its own; the pipe closing under it isn't another failure.
    child.stdin.on('error', () => undefined)
    child.stdin.end(input)
  })

/**
 * What a worktree holds, as a tree id: tracked and untracked files alike,
 * ignored ones aside, so any edit changes it. It stages into a copy of the
 * index, leaving the agent's own staging as it was.
 */
export const treeOf = (cwd: string): Effect.Effect<string, GitFailed> =>
  Effect.acquireUseRelease(
    Effect.gen(function* () {
      const index = resolve(cwd, yield* git(cwd, 'rev-parse', '--git-path', 'index'))
      return yield* Effect.try({
        try: () => {
          const copy = join(mkdtempSync(join(tmpdir(), 'althar-index-')), 'index')
          if (existsSync(index)) copyFileSync(index, copy)
          return copy
        },
        catch: (error) => new GitFailed({ args: ['add', '-A'], cwd, stderr: String(error) }),
      })
    }),
    (copy) =>
      Effect.andThen(run(60_000, cwd, ['add', '-A'], { GIT_INDEX_FILE: copy }), run(60_000, cwd, ['write-tree'], { GIT_INDEX_FILE: copy })),
    (copy) => Effect.sync(() => rmSync(dirname(copy), { recursive: true, force: true })),
  )

/** Commits a tree on top of a parent without touching any branch, as Althar: a snapshot a worktree can check out. */
export const commitTree = (cwd: string, tree: string, parent: string, message: string): Effect.Effect<string, GitFailed> =>
  run(60_000, cwd, ['commit-tree', tree, '-p', parent, '-m', message], {
    GIT_AUTHOR_NAME: 'Althar',
    GIT_AUTHOR_EMAIL: 'althar@localhost',
    GIT_COMMITTER_NAME: 'Althar',
    GIT_COMMITTER_EMAIL: 'althar@localhost',
  })

/** Who made a commit, and when, as git keeps it: `1760000000 +0200` for a date. */
export interface Signature {
  readonly name: string
  readonly email: string
  readonly date: string
}

/** A commit as git keeps it: its tree, its parents, who made it and committed it, and its message exactly. */
export interface CommitRecord {
  readonly tree: string
  readonly parents: ReadonlyArray<string>
  readonly author: Signature
  readonly committer: Signature
  readonly message: string
  /**
   * It has what making it again would lose: a message in an encoding other
   * than UTF-8, which reads here as UTF-8, or a signed tag it merged.
   */
  readonly keeps: boolean
  /** It was signed, whatever git does by default here now. */
  readonly signed: boolean
}

const signatureOf = (line: string): Signature | null => {
  const match = /^(.*) <(.*)> (\d+ [+-]\d{4})$/.exec(line)
  return match === null ? null : { name: match[1] ?? '', email: match[2] ?? '', date: match[3] ?? '' }
}

/** A commit's record, read from its object, so its message is what was written. */
export const commitRecord = (cwd: string, commit: string): Effect.Effect<CommitRecord, GitFailed> =>
  Effect.flatMap(run(60_000, cwd, ['cat-file', 'commit', commit], {}, false), (raw) => {
    const split = raw.indexOf('\n\n')
    const headers = (split === -1 ? raw : raw.slice(0, split)).split('\n')
    const field = (name: string) => headers.filter((line) => line.startsWith(`${name} `)).map((line) => line.slice(name.length + 1))
    const author = signatureOf(field('author')[0] ?? '')
    const committer = signatureOf(field('committer')[0] ?? '')
    const tree = field('tree')[0]
    if (author === null || committer === null || tree === undefined)
      return Effect.fail(new GitFailed({ args: ['cat-file', 'commit', commit], cwd, stderr: 'A commit git could not be read.' }))
    const encoding = field('encoding')[0]?.toLowerCase()
    const keeps = (encoding !== undefined && encoding !== 'utf-8' && encoding !== 'utf8') || field('mergetag').length > 0
    const signed = field('gpgsig').length > 0 || field('gpgsig-sha256').length > 0
    return Effect.succeed({
      tree,
      parents: field('parent'),
      author,
      committer,
      message: split === -1 ? '' : raw.slice(split + 2),
      keeps,
      signed,
    })
  })

/** Whether the person has git sign every commit here (`commit.gpgSign`), which `commit-tree` doesn't do by itself. */
export const signsCommits = (cwd: string) =>
  Effect.map(gitOutcome(cwd, 'config', '--type=bool', '--get', 'commit.gpgsign'), (outcome) => outcome.stdout === 'true')

/**
 * The same commit made again with another message, or other parents: its
 * tree, its author and committer and their dates kept, so only what changed
 * differs. The message goes in as written. Signed, where the person has git
 * sign their commits, with their key, as `git commit` would.
 */
export const recommit = (cwd: string, record: CommitRecord, parents: ReadonlyArray<string>, message: string, sign = false) =>
  run(
    60_000,
    cwd,
    ['commit-tree', record.tree, ...parents.flatMap((parent) => ['-p', parent]), ...(sign ? ['-S'] : []), '-F', '-'],
    {
      GIT_AUTHOR_NAME: record.author.name,
      GIT_AUTHOR_EMAIL: record.author.email,
      GIT_AUTHOR_DATE: `@${record.author.date}`,
      GIT_COMMITTER_NAME: record.committer.name,
      GIT_COMMITTER_EMAIL: record.committer.email,
      GIT_COMMITTER_DATE: `@${record.committer.date}`,
    },
    true,
    message,
  )

/** The commit a remote's branch is on, asked of the remote by URL, as a push would be: null where it has no such branch, or can't be asked. */
export const remoteTip = (cwd: string, target: { readonly url: string; readonly header: string | null }, branch: string) =>
  run(
    60_000,
    cwd,
    ['ls-remote', '--heads', target.url, `refs/heads/${branch}`],
    target.header === null ? {} : { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: target.header },
  ).pipe(
    Effect.map((listed) => /^[0-9a-f]{40,64}/.exec(listed)?.[0] ?? null),
    Effect.orElseSucceed(() => null),
  )

/** The top of the repository a path is in. */
export const topLevel = (path: string) => git(path, 'rev-parse', '--show-toplevel')

/** The commit a ref points at. */
export const commitOf = (cwd: string, ref: string) => git(cwd, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`)

/**
 * The commit each of `revisions` names, in one git process: null for one git
 * doesn't know here, or that isn't one name. They go to git as its input,
 * never as arguments, so none is read as an option.
 */
export const commitsOf = (cwd: string, revisions: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string | null>> => {
  const named = revisions.filter((revision) => /^[^\s^:]+$/.test(revision))
  if (named.length === 0) return Effect.succeed(revisions.map(() => null))
  return run(
    60_000,
    cwd,
    ['cat-file', '--batch-check=%(objectname)'],
    {},
    true,
    named.map((revision) => `${revision}^{commit}\n`).join(''),
  ).pipe(
    Effect.map((output) => {
      // A line for each name asked about: its commit, or the name and why there is none (`missing`, `ambiguous`).
      const lines = output.split('\n')
      const commits = new Map(named.map((revision, at) => [revision, lines[at]]))
      return revisions.map((revision) => {
        const commit = commits.get(revision)
        return commit !== undefined && /^[0-9a-f]{40,64}$/.test(commit) ? commit : null
      })
    }),
    Effect.orElseSucceed(() => revisions.map(() => null)),
  )
}

/**
 * A worktree's index file as the file system has it now: where it is, its
 * size and when it was written. Git writes it anew, by renaming a new file
 * over it, whenever anything is staged, so any of that changes this. Empty
 * where it can't be read. A linked worktree's `.git` is a file that names
 * its folder in the repository's, where its index is.
 */
export const indexStamp = (worktree: string): Effect.Effect<string> =>
  Effect.tryPromise(async () => {
    const dotGit = join(worktree, '.git')
    const linked = (await stat(dotGit)).isFile() ? /^gitdir: (.+)$/m.exec(await readFile(dotGit, 'utf8'))?.[1] : undefined
    const index = await stat(join(linked === undefined ? dotGit : resolve(worktree, linked.trim()), 'index'), { bigint: true })
    return `${index.ino}:${index.size}:${index.mtimeNs}`
  }).pipe(Effect.orElseSucceed(() => ''))

/** Whether a local branch exists. */
export const branchExists = (cwd: string, branch: string) =>
  git(cwd, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )

/** The branch checked out, or undefined when HEAD is detached. */
export const currentBranch = (cwd: string) =>
  git(cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD').pipe(
    Effect.map((branch): string | undefined => branch),
    Effect.orElseSucceed(() => undefined),
  )

const COMMON_DEFAULTS = ['main', 'master', 'trunk', 'develop']

/**
 * The repository's default branch: what origin says (as git last saw it, or
 * by asking it), else the first of the usual names that exists here, else
 * `main`. Never the branch the person happens to have checked out, which may
 * be a feature branch the push rules would then protect instead.
 */
export const defaultBranch = (cwd: string, remote = 'origin') =>
  git(cwd, 'symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`).pipe(
    Effect.map((ref) => ref.slice(remote.length + 1)),
    Effect.catch(() =>
      gitWithin(15_000, cwd, 'ls-remote', '--symref', remote, 'HEAD').pipe(
        Effect.flatMap((output) => {
          const branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(output)?.[1]
          return branch === undefined ? Effect.fail(new GitFailed({ args: ['ls-remote'], cwd, stderr: 'no HEAD' })) : Effect.succeed(branch)
        }),
      ),
    ),
    Effect.catch(() =>
      Effect.gen(function* () {
        for (const branch of COMMON_DEFAULTS) if (yield* branchExists(cwd, branch)) return branch
        return 'main'
      }),
    ),
  )

/** Brings a remote branch up to date locally; false when that can't be done, as offline. */
export const fetchBranch = (cwd: string, branch: string, remote = 'origin') =>
  gitWithin(60_000, cwd, 'fetch', '--quiet', '--no-tags', remote, branch).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )

/**
 * A remote URL without the credentials it may carry: `https://user:token@host/…`
 * becomes `https://host/…`. The record never holds a secret (docs/architecture/07).
 */
export const redactUrl = (url: string) => url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1')

/** Every remote's fetch URL, without credentials. */
export const remoteUrls = (cwd: string) =>
  Effect.map(git(cwd, 'remote', '-v'), (output) => [
    ...new Set(
      output
        .split('\n')
        .filter((line) => line.endsWith('(fetch)'))
        .map((line) => redactUrl(line.split(/\s+/)[1] ?? ''))
        .filter((url) => url !== ''),
    ),
  ])

/** Each remote by name, with its fetch URL (or the URLs it pushes to) without credentials, in the order git lists them. */
export const namedRemotes = (cwd: string, which: 'fetch' | 'push' = 'fetch') =>
  Effect.map(git(cwd, 'remote', '-v'), (output) =>
    output
      .split('\n')
      .filter((line) => line.endsWith(`(${which})`))
      .map((line) => {
        const [name = '', url = ''] = line.split(/\s+/)
        return { name, url: redactUrl(url) }
      })
      .filter((remote) => remote.name !== '' && remote.url !== ''),
  )

/** Adds a worktree on a new branch from a base. */
export const addWorktree = (repository: string, path: string, branch: string, base: string) =>
  git(repository, 'worktree', 'add', '-b', branch, path, base)

/** Puts back a worktree whose folder is gone, on the branch it had: git forgets the missing one first. */
export const restoreWorktree = (repository: string, path: string, branch: string) =>
  Effect.andThen(git(repository, 'worktree', 'prune'), git(repository, 'worktree', 'add', path, branch))

/** The files the worktree hasn't committed, changed, new or deleted, ignored files aside; by path, sorted. */
export const uncommittedFiles = (cwd: string) =>
  Effect.gen(function* () {
    const changed = yield* git(cwd, '-c', 'core.quotePath=false', 'diff', '--name-only', 'HEAD')
    const added = yield* git(cwd, '-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard')
    return [...new Set([...changed.split('\n'), ...added.split('\n')].filter((path) => path !== ''))].toSorted()
  })

/** How many commits `head` (HEAD, unless named) has that a base doesn't. */
export const commitsAhead = (cwd: string, base: string, head = 'HEAD') =>
  Effect.map(git(cwd, 'rev-list', '--count', `${base}..${head}`), Number)

/** Whether `commit` is the worktree's head or behind it. */
export const onHead = (cwd: string, commit: string) =>
  Effect.match(git(cwd, 'merge-base', '--is-ancestor', commit, 'HEAD'), { onFailure: () => false, onSuccess: () => true })

/**
 * Pushes HEAD to a branch of a remote by URL, never forced. The header that
 * signs the push in goes to git through its environment, so it is in no
 * process's arguments.
 */
export const pushTo = (
  cwd: string,
  target: { readonly url: string; readonly header: string | null },
  branch: string,
  /** What is pushed: the worktree's head, or a commit the person saw. */
  commit = 'HEAD',
) =>
  run(
    120_000,
    cwd,
    ['push', '--quiet', '--no-verify', target.url, `${commit}:refs/heads/${branch}`],
    target.header === null ? {} : { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: target.header },
  )

/**
 * The remote a repository's work goes to, as the person's own git would
 * send it: the one its default branch follows, else `origin`, else its only
 * remote; null where it has none, or several and no way to tell. A default
 * branch that follows a branch here (`.`), or a bare URL, follows no remote.
 */
export const remoteOf = (cwd: string, base: string) =>
  Effect.gen(function* () {
    const remotes = yield* namedRemotes(cwd).pipe(Effect.orElseSucceed(() => []))
    const names = [...new Set(remotes.map((remote) => remote.name))]
    const followed = yield* gitOutcome(cwd, 'for-each-ref', '--format=%(upstream:remotename)', `refs/heads/${base}`)
    if (followed.code === 0 && names.includes(followed.stdout)) return followed.stdout
    return names.includes('origin') ? 'origin' : names.length === 1 ? (names[0] ?? null) : null
  })
