import { looksExecutable } from './executable'
import { basename } from 'node:path'
import { fileHashes, type Files } from './hash'
import { fetchSkill, type GitHubAccess, type GitHubSkillSource, resolveRef } from './github'
import { type Install, putObject, readInstalls, readObject, serialized, withInstall, writeInstalls } from './store'
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
  readonly installed: Pick<Install, 'source' | 'treeHash' | 'repo' | 'sha' | 'review' | 'active'> | null
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
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lengths[i]![j] = a[i] === b[j] ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!)
  const all: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      all.push({ kind: 'same', text: a[i]! })
      i++
      j++
    } else if (i < a.length && (j === b.length || lengths[i + 1]![j]! >= lengths[i]![j + 1]!)) {
      all.push({ kind: 'removed', text: a[i]! })
      i++
    } else {
      all.push({ kind: 'added', text: b[j]! })
      j++
    }
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
): ReviewCard => {
  const checked = validateSkill(id, files, undefined, 'flag')
  const hashes = fileHashes(files)
  return {
    id,
    source,
    treeHash,
    name: checked.name,
    description: checked.description,
    license: checked.license,
    instructions: textOf(files.get('SKILL.md')) ?? '',
    files: [...files.keys()].toSorted().map((path) => ({
      path,
      bytes: files.get(path)!.byteLength,
      sha256: hashes[path]!,
      executable: looksExecutable(path),
    })),
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
            ...(installed.sha === undefined ? {} : { sha: installed.sha }),
          },
    changes: changesBetween(before, files),
  }
}

const installedFiles = async (root: string, install: Install | undefined): Promise<Files> =>
  install === undefined ? new Map() : readObject(root, install.treeHash)

/** The name a skill installs under: its directory's, as Agent Skills requires `name` to match. */
const idOf = (subpath: string): string => basename(subpath.replace(/\/+$/, '')) || ''

/**
 * Fetches a skill from GitHub at the commit its ref names now, keeps that version in the store (inert: a stored
 * version is not installed), and returns its review card. A version with something refused is still shown, so the
 * person sees why, but cannot be approved.
 */
export const stageFromGitHub = async (root: string, access: GitHubAccess, source: GitHubSkillSource): Promise<ReviewCard> => {
  const sha = await resolveRef(access, source.repo, source.ref)
  const subpath = source.subpath.replace(/^\/+|\/+$/g, '')
  const id = idOf(subpath) || source.repo.split('/')[1]!
  const files = await fetchSkill(access, source.repo, sha, subpath)
  const treeHash = await putObject(root, files)
  const read = await readInstalls(root)
  if (!read.ok) throw new Error(read.error)
  const installed = read.value.installs.find((install) => install.id === id)
  return cardOf(
    id,
    { kind: 'github', repo: source.repo, ref: source.ref, sha, subpath },
    treeHash,
    files,
    installed,
    await installedFiles(root, installed),
  )
}

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

/**
 * Installs the version a person approved, active. The stored version is read back and checked again, so a card
 * cannot install other files than it showed. An install of the same name from another source is replaced only when
 * the person said so; the version replaced is kept in its history, to roll back to.
 */
export const approve = (root: string, approval: Approval): Promise<Install> =>
  serialized(root, async () => {
    const files = await readObject(root, approval.treeHash)
    const checked = validateSkill(approval.id, files, undefined, 'flag')
    if (!checked.ok)
      throw new Error(
        `${approval.id} cannot be installed: ${checked.findings
          .filter((f) => f.level === 'reject')
          .map((f) => f.code)
          .join(', ')}`,
      )
    const read = await readInstalls(root)
    if (!read.ok) throw new Error(read.error)
    const was = read.value.installs.find((install) => install.id === approval.id)
    const sameSource = was !== undefined && was.source === 'github' && was.repo === approval.repo && was.subpath === approval.subpath
    if (was !== undefined && !sameSource && approval.replace !== true)
      throw new Error(`${approval.id} is already installed from ${was.repo ?? was.source}; replacing it needs the person's say-so`)
    const history =
      was === undefined || was.treeHash === approval.treeHash
        ? (was?.history ?? [])
        : [...(was.history ?? []), { treeHash: was.treeHash, ...(was.sha === undefined ? {} : { sha: was.sha }) }]
    const install: Install = {
      id: approval.id,
      source: 'github',
      repo: approval.repo,
      sha: approval.sha,
      subpath: approval.subpath,
      ref: approval.ref,
      treeHash: approval.treeHash,
      review: 'reviewed',
      active: true,
      ...(history.length === 0 ? {} : { history }),
    }
    await writeInstalls(root, withInstall(read.value, install))
    return install
  })

/** One installed GitHub skill's update check: a card when its ref names a newer commit, or why it couldn't be checked. */
export type UpdateCheck =
  | { readonly id: string; readonly state: 'current'; readonly sha: string }
  | { readonly id: string; readonly state: 'available'; readonly card: ReviewCard }
  | { readonly id: string; readonly state: 'failed'; readonly error: string }

/**
 * Checks each skill installed from GitHub for a newer commit on the ref it was installed from, only when the person
 * asks. A newer one is staged and returned as a card to review; the installed version stays active until approved.
 */
export const checkUpdates = async (root: string, access: GitHubAccess): Promise<ReadonlyArray<UpdateCheck>> => {
  const read = await readInstalls(root)
  if (!read.ok) throw new Error(read.error)
  const checks: UpdateCheck[] = []
  for (const install of read.value.installs) {
    if (install.source !== 'github' || install.repo === undefined || install.subpath === undefined) continue
    try {
      const ref = install.ref ?? install.sha ?? 'HEAD'
      const sha = await resolveRef(access, install.repo, ref)
      if (sha === install.sha) checks.push({ id: install.id, state: 'current', sha })
      else
        checks.push({
          id: install.id,
          state: 'available',
          card: await stageFromGitHub(root, access, { repo: install.repo, subpath: install.subpath, ref }),
        })
    } catch (error) {
      checks.push({ id: install.id, state: 'failed', error: error instanceof Error ? error.message : String(error) })
    }
  }
  return checks
}

/** Puts an install back to the version it had before its last update. The newer version stays stored. */
export const rollBack = (root: string, id: string): Promise<Install> =>
  serialized(root, async () => {
    const read = await readInstalls(root)
    if (!read.ok) throw new Error(read.error)
    const was = read.value.installs.find((install) => install.id === id)
    const previous = was?.history?.at(-1)
    if (was === undefined || previous === undefined) throw new Error(`${id} has no earlier version to go back to`)
    await readObject(root, previous.treeHash)
    const history = was.history!.slice(0, -1)
    const { sha: _sha, history: _history, ...rest } = was
    const install: Install = {
      ...rest,
      treeHash: previous.treeHash,
      ...(previous.sha === undefined ? {} : { sha: previous.sha }),
      ...(history.length === 0 ? {} : { history }),
    }
    await writeInstalls(root, withInstall(read.value, install))
    return install
  })

/** Turns an install on or off for later runs. One never reviewed cannot be turned on. */
export const setActive = (root: string, id: string, active: boolean): Promise<Install> =>
  serialized(root, async () => {
    const read = await readInstalls(root)
    if (!read.ok) throw new Error(read.error)
    const was = read.value.installs.find((install) => install.id === id)
    if (was === undefined) throw new Error(`${id} is not installed`)
    const install = { ...was, active }
    await writeInstalls(root, withInstall(read.value, install))
    return install
  })

/**
 * Removes a person's own install from later runs. A default can only be turned off: the catalog would put it back.
 * Its stored versions are kept.
 */
export const uninstall = (root: string, id: string): Promise<void> =>
  serialized(root, async () => {
    const read = await readInstalls(root)
    if (!read.ok) throw new Error(read.error)
    const was = read.value.installs.find((install) => install.id === id)
    if (was === undefined) return
    if (was.source === 'althar-default') throw new Error(`${id} comes with Althar; turn it off instead`)
    await writeInstalls(root, { version: 1, installs: read.value.installs.filter((install) => install.id !== id) })
  })
