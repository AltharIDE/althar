import { basename } from 'node:path'
import { Cause, Effect } from 'effect'
import { SkillRefused, type SkillError, type SkillStoreFailed } from './errors'
import { looksExecutable } from './executable'
import { byPath, fileHashes, type Files, sha256 } from './hash'
import { fetchSkill, type GitHubAccess, type GitHubSkillSource, repositoryLicense, resolveRef } from './github'
import {
  hasObject,
  type Install,
  type Installs,
  putObject,
  readInstalls,
  readObject,
  serialized,
  withInstall,
  writeInstalls,
} from './store'
import { type Finding, validateSkill } from './validate'

/*
 * Installing and updating a skill from GitHub as a person reviews it (docs/plans/skills-across-harnesses.md,
 * section 3). A fetch stages an immutable version and returns a review card; nothing is installed until the person
 * approves that card, and an update never replaces the active version by itself. Nothing in a skill is run.
 */

export interface ReviewFile {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
  /** A script or other file an agent could run. Althar never runs it. */
  readonly executable: boolean
}

/** One line of a file's change: kept, added or removed. */
export interface DiffLine {
  readonly kind: 'same' | 'added' | 'removed'
  readonly text: string
}

export interface FileChange {
  readonly path: string
  readonly change: 'added' | 'removed' | 'changed'
  /** The lines that changed, with a few around them, for a text file; none for a binary one or one too long to compare. */
  readonly lines: ReadonlyArray<DiffLine>
}

/** What a person reads before a version of a skill is installed: where it is from, what it holds, what changes. */
export interface ReviewCard {
  readonly id: string
  readonly source: { readonly kind: 'github'; readonly repo: string; readonly ref: string; readonly sha: string; readonly subpath: string }
  readonly treeHash: string
  readonly name: string | null
  readonly description: string | null
  readonly license: string | null
  /** The `SKILL.md` text, which is what the agent will be told. */
  readonly instructions: string
  readonly files: ReadonlyArray<ReviewFile>
  readonly findings: ReadonlyArray<Finding>
  /** Whether it may be installed: nothing in it is refused. */
  readonly installable: boolean
  /** The version installed under the same name now, if any, and where it is from. */
  readonly installed: Pick<Install, 'source' | 'treeHash' | 'repo' | 'subpath' | 'sha' | 'review' | 'active'> | null
  /** Against the installed version; every file is added when none is. */
  readonly changes: ReadonlyArray<FileChange>
}

const decoder = new TextDecoder('utf-8', { fatal: true })

const textOf = (bytes: Uint8Array | undefined): string | null => {
  if (bytes === undefined) return ''
  try {
    return decoder.decode(bytes)
  } catch {
    return null
  }
}

const MAX_COMPARED = 4000
const AROUND = 3

/** The lines of `after` against `before`: a longest-common-subsequence diff, trimmed to the changes and a few lines around each. */
export const diffLines = (before: string, after: string): ReadonlyArray<DiffLine> => {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  if (a.length > MAX_COMPARED || b.length > MAX_COMPARED) return []
  // lengths[i][j]: the longest common run of a[i..] and b[j..], kept flat; past either end it is 0.
  const width = b.length + 1
  const lengths = new Uint32Array((a.length + 1) * width)
  const length = (i: number, j: number): number => lengths[i * width + j] ?? 0
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lengths[i * width + j] = a[i] === b[j] ? length(i + 1, j + 1) + 1 : Math.max(length(i + 1, j), length(i, j + 1))
  const all: DiffLine[] = []
  let i = 0
  let j = 0
  for (;;) {
    const before = a[i]
    const after = b[j]
    if (before !== undefined && after !== undefined && before === after) {
      all.push({ kind: 'same', text: before })
      i++
      j++
    } else if (before !== undefined && (after === undefined || length(i + 1, j) >= length(i, j + 1))) {
      all.push({ kind: 'removed', text: before })
      i++
    } else if (after !== undefined) {
      all.push({ kind: 'added', text: after })
      j++
    } else break
  }
  return all.filter(
    (line, at) => line.kind !== 'same' || all.slice(Math.max(0, at - AROUND), at + AROUND + 1).some(({ kind }) => kind !== 'same'),
  )
}

/** What changes from one version's files to another's, file by file. */
export const changesBetween = (before: Files, after: Files): ReadonlyArray<FileChange> => {
  const was = fileHashes(before)
  const now = fileHashes(after)
  const changes: FileChange[] = []
  for (const path of [...new Set([...Object.keys(was), ...Object.keys(now)])].toSorted()) {
    if (was[path] === now[path]) continue
    const change = was[path] === undefined ? 'added' : now[path] === undefined ? 'removed' : 'changed'
    const old = textOf(before.get(path))
    const updated = textOf(after.get(path))
    changes.push({ path, change, lines: old === null || updated === null ? [] : diffLines(old, updated) })
  }
  return changes
}

const cardOf = (
  id: string,
  source: ReviewCard['source'],
  treeHash: string,
  files: Files,
  installed: Install | undefined,
  before: Files,
  /** The repository's licence, for a skill that names none of its own. */
  repositoryLicense: string | null,
): ReviewCard => {
  const checked = validateSkill(id, files, undefined, 'flag')
  return {
    id,
    source,
    treeHash,
    name: checked.name,
    description: checked.description,
    license: checked.license ?? repositoryLicense,
    instructions: textOf(files.get('SKILL.md')) ?? '',
    files: [...files]
      .toSorted(byPath)
      .map(([path, bytes]) => ({ path, bytes: bytes.byteLength, sha256: sha256(bytes), executable: looksExecutable(path) })),
    findings: checked.findings,
    installable: checked.ok,
    installed:
      installed === undefined
        ? null
        : {
            source: installed.source,
            treeHash: installed.treeHash,
            review: installed.review,
            active: installed.active,
            ...(installed.repo === undefined ? {} : { repo: installed.repo }),
            ...(installed.subpath === undefined ? {} : { subpath: installed.subpath }),
            ...(installed.sha === undefined ? {} : { sha: installed.sha }),
          },
    changes: changesBetween(before, files),
  }
}

const installedFiles = (root: string, install: Install | undefined): Effect.Effect<Files, SkillStoreFailed> =>
  install === undefined ? Effect.succeed(new Map()) : readObject(root, install.treeHash)

/** The name a skill installs under: its directory's, as Agent Skills requires `name` to match. */
const idOf = (subpath: string): string => basename(subpath.replace(/\/+$/, '')) || ''

const refused = (message: string) => new SkillRefused({ message })

/** The install of that name, if any. */
const installOf = (
  root: string,
  id: string,
): Effect.Effect<{ readonly all: Installs; readonly was: Install | undefined }, SkillStoreFailed> =>
  Effect.map(readInstalls(root), (all) => ({ all, was: all.installs.find((install) => install.id === id) }))

/**
 * Fetches a skill from GitHub at the commit its ref names now, keeps that version in the store (inert: a stored
 * version is not installed), and returns its review card. A version with something refused is still shown, so the
 * person sees why, but cannot be approved. A skill that names no licence of its own shows its repository's.
 */
export const stageFromGitHub = (root: string, access: GitHubAccess, source: GitHubSkillSource): Effect.Effect<ReviewCard, SkillError> =>
  Effect.gen(function* () {
    const sha = yield* resolveRef(access, source.repo, source.ref)
    const subpath = source.subpath.replace(/^\/+|\/+$/g, '')
    const id = idOf(subpath) || (source.repo.split('/')[1] ?? source.repo)
    const files = yield* fetchSkill(access, source.repo, sha, subpath)
    const treeHash = yield* putObject(root, files)
    const { was } = yield* installOf(root, id)
    // Asked only where the skill says nothing; a repository GitHub won't describe leaves the licence unknown, not the card unshown.
    const license =
      validateSkill(id, files, undefined, 'flag').license === null
        ? yield* repositoryLicense(access, source.repo).pipe(Effect.catchTag('SkillRefused', () => Effect.succeed(null)))
        : null
    return cardOf(
      id,
      { kind: 'github', repo: source.repo, ref: source.ref, sha, subpath },
      treeHash,
      files,
      was,
      yield* installedFiles(root, was),
      license,
    )
  })

/** What the person approved: the card's identity, so the version installed is the one they read, not a refetch. */
export interface Approval {
  readonly id: string
  readonly repo: string
  readonly ref: string
  readonly sha: string
  readonly subpath: string
  readonly treeHash: string
  /** Put it in place of an install of the same name from somewhere else, which the person was shown. */
  readonly replace?: boolean | undefined
}

/** An install's version and where it is from, as its history keeps it to roll back to. */
const versionOf = ({ id: _id, active: _active, history: _history, ...version }: Install): NonNullable<Install['history']>[number] => version

/**
 * Installs the version a person approved, active. The stored version is read back and checked again, so a card
 * cannot install other files than it showed. An install of the same name from another source is replaced only when
 * the person said so; the version replaced is kept in its history, to roll back to.
 */
export const approve = (root: string, approval: Approval): Effect.Effect<Install, SkillError> =>
  serialized(
    root,
    Effect.gen(function* () {
      if (!(yield* hasObject(root, approval.treeHash).pipe(Effect.catchTag('SkillStoreFailed', () => Effect.succeed(false)))))
        return yield* refused(`The version of ${approval.id} you reviewed isn't in the store any more; review it again`)
      const files = yield* readObject(root, approval.treeHash)
      const checked = validateSkill(approval.id, files, undefined, 'flag')
      if (!checked.ok)
        return yield* refused(
          `${approval.id} cannot be installed: ${checked.findings
            .filter((f) => f.level === 'reject')
            .map((f) => f.code)
            .join(', ')}`,
        )
      const { all, was } = yield* installOf(root, approval.id)
      const sameSource = was !== undefined && was.source === 'github' && was.repo === approval.repo && was.subpath === approval.subpath
      if (was !== undefined && !sameSource && approval.replace !== true)
        return yield* refused(`${approval.id} is already installed from ${was.repo ?? was.source}; replacing it needs the person's say-so`)
      const history =
        was === undefined || was.treeHash === approval.treeHash ? (was?.history ?? []) : [...(was.history ?? []), versionOf(was)]
      const install: Install = {
        id: approval.id,
        source: 'github',
        repo: approval.repo,
        sha: approval.sha,
        subpath: approval.subpath,
        ref: approval.ref,
        treeHash: approval.treeHash,
        review: 'reviewed',
        // An update keeps it off if the person turned it off; a new one, or one put in place of another, is on.
        active: sameSource ? was.active : true,
        ...(history.length === 0 ? {} : { history }),
      }
      yield* writeInstalls(root, withInstall(all, install))
      return install
    }),
  )

/** One installed GitHub skill's update check: a card when its ref names a newer commit, or why it couldn't be checked. */
export type UpdateCheck =
  | { readonly id: string; readonly state: 'current'; readonly sha: string }
  | { readonly id: string; readonly state: 'available'; readonly card: ReviewCard }
  | {
      readonly id: string
      readonly state: 'failed'
      readonly error: string
      /** Where it failed for no reason of the person's or GitHub's: the failure whole, for whoever reports it (ADR-047). */
      readonly unexpected?: Cause.Cause<unknown>
    }

/** Why a check failed, in words for the person; what Althar didn't expect is kept whole beside them, to be reported. */
const failedCheck = (id: string, cause: Cause.Cause<SkillError>): UpdateCheck => {
  const error = Cause.findErrorOption(cause)
  return error._tag === 'Some' && error.value._tag === 'SkillRefused'
    ? { id, state: 'failed', error: error.value.message }
    : { id, state: 'failed', error: "Althar couldn't check it. Its log has the details.", unexpected: cause }
}

/**
 * Checks each skill installed from GitHub for a newer commit on the ref it was installed from, only when the person
 * asks, that changed the skill's files. A newer one is staged and returned as a card to review; the installed version stays active until approved.
 * One that can't be checked says so on its own, and the rest are checked.
 */
export const checkUpdates = (root: string, access: GitHubAccess): Effect.Effect<ReadonlyArray<UpdateCheck>, SkillStoreFailed> =>
  Effect.gen(function* () {
    const { installs } = yield* readInstalls(root)
    const checks: UpdateCheck[] = []
    for (const install of installs) {
      const { repo, subpath } = install
      if (install.source !== 'github' || repo === undefined || subpath === undefined) continue
      const ref = install.ref ?? install.sha ?? 'HEAD'
      const check = Effect.gen(function* () {
        const sha = yield* resolveRef(access, repo, ref)
        if (sha === install.sha) return { id: install.id, state: 'current', sha } as const
        // A newer commit that left the skill's own files as they were is no update: there is nothing to review.
        const card = yield* stageFromGitHub(root, access, { repo, subpath, ref })
        if (card.treeHash === install.treeHash) return { id: install.id, state: 'current', sha } as const
        return { id: install.id, state: 'available', card } as const
      })
      checks.push(
        yield* check.pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.succeed(failedCheck(install.id, cause)),
          ),
        ),
      )
    }
    return checks
  })

/** Puts an install back to the version it had before its last update. The newer version stays stored. */
export const rollBack = (root: string, id: string): Effect.Effect<Install, SkillError> =>
  serialized(
    root,
    Effect.gen(function* () {
      const { all, was } = yield* installOf(root, id)
      const past = was?.history ?? []
      const previous = past.at(-1)
      if (was === undefined || previous === undefined) return yield* refused(`${id} has no earlier version to go back to`)
      yield* readObject(root, previous.treeHash)
      const history = past.slice(0, -1)
      // An entry that says where it was from is put back whole; one without is from the source the install has now.
      const from = previous.source === undefined ? was : previous
      const restored: Install = {
        id,
        active: was.active,
        source: previous.source ?? was.source,
        review: previous.review ?? was.review,
        treeHash: previous.treeHash,
        ...(from.repo === undefined ? {} : { repo: from.repo }),
        ...(from.subpath === undefined ? {} : { subpath: from.subpath }),
        ...(from.ref === undefined ? {} : { ref: from.ref }),
        ...(previous.sha === undefined ? {} : { sha: previous.sha }),
        ...(history.length === 0 ? {} : { history }),
      }
      yield* writeInstalls(root, withInstall(all, restored))
      return restored
    }),
  )

/** Turns an install on or off for later runs. One never reviewed cannot be turned on. */
export const setActive = (root: string, id: string, active: boolean): Effect.Effect<Install, SkillError> =>
  serialized(
    root,
    Effect.gen(function* () {
      const { all, was } = yield* installOf(root, id)
      if (was === undefined) return yield* refused(`${id} is not installed`)
      if (active && was.review === 'not-reviewed') return yield* refused(`${id} hasn't been reviewed, so it can't be turned on`)
      const install = { ...was, active }
      yield* writeInstalls(root, withInstall(all, install))
      return install
    }),
  )

/**
 * Removes a person's own install from later runs, and says what it was; nothing where none is installed. A default
 * can only be turned off: the catalog would put it back. Its stored versions are kept.
 */
export const uninstall = (root: string, id: string): Effect.Effect<Install | undefined, SkillError> =>
  serialized(
    root,
    Effect.gen(function* () {
      const { all, was } = yield* installOf(root, id)
      if (was === undefined) return undefined
      if (was.source === 'althar-default') return yield* refused(`${id} comes with Althar; turn it off instead`)
      yield* writeInstalls(root, { ...all, installs: all.installs.filter((install) => install.id !== id) })
      return was
    }),
  )
