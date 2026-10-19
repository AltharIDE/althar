/*
 * The repository boundary (docs/plans/skills-across-harnesses.md, section 4): skill and OpenSpec files
 * are never written into, committed to or pushed from a person's repository unless they said so for
 * that project. The checks look at paths alone, so they hold whoever wrote the file.
 */

/** A project's "Repository files" settings. Every one is off until the person turns it on. */
export interface RepositoryFiles {
  readonly writeSkills: boolean
  readonly writeOpenSpec: boolean
  readonly pushProtected: boolean
}

export const DEFAULT_REPOSITORY_FILES: RepositoryFiles = { writeSkills: false, writeOpenSpec: false, pushProtected: false }

export type ProtectedKind = 'skills' | 'openspec'

const SKILL_ROOTS = new Set(['.agents', '.claude', '.opencode'])

const segmentsOf = (path: string): string[] =>
  path
    .replaceAll('\\', '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.')

/**
 * Which protected class a repository-relative path falls under: a file below a native skill root, or below an
 * `openspec/` directory, at any depth, so a monorepo subproject is covered too (a docs folder named `openspec`
 * is a false positive that a one-time grant clears). Callers pass plain, unquoted paths, one per entry, such as
 * from `git status --porcelain -z`; a rename is two paths, old and new, both to be checked.
 */
export const protectedKind = (path: string): ProtectedKind | null => {
  const parts = segmentsOf(path)
  for (const [at, segment] of parts.slice(0, -1).entries()) {
    const part = segment.toLowerCase()
    if (part === 'openspec') return 'openspec'
    if (at + 2 < parts.length && SKILL_ROOTS.has(part) && parts[at + 1]?.toLowerCase() === 'skills') return 'skills'
  }
  return null
}

export interface Blocked {
  readonly path: string
  readonly kind: ProtectedKind
  readonly reason: 'write-off' | 'push-off'
}

/**
 * Changed paths that may not be staged or committed: skill files while writing skills is off, `openspec/`
 * while writing OpenSpec is off. `granted` holds directories a one-time grant names; a path below one passes.
 */
export const blockedBeforeCommit = (
  paths: ReadonlyArray<string>,
  settings: RepositoryFiles,
  granted: ReadonlyArray<string> = [],
): Blocked[] => {
  const grants = granted.map((directory) => segmentsOf(directory).join('/'))
  const blocked: Blocked[] = []
  for (const path of paths) {
    const kind = protectedKind(path)
    if (kind === null) continue
    if (kind === 'skills' ? settings.writeSkills : settings.writeOpenSpec) continue
    const normal = segmentsOf(path).join('/')
    if (grants.some((directory) => normal === directory || normal.startsWith(`${directory}/`))) continue
    blocked.push({ path, kind, reason: 'write-off' })
  }
  return blocked
}

/** Paths in what is about to be pushed that may not leave the machine: every protected path, unless pushing them is on. */
export const blockedBeforePush = (paths: ReadonlyArray<string>, settings: RepositoryFiles): Blocked[] => {
  if (settings.pushProtected) return []
  return paths.flatMap((path) => {
    const kind = protectedKind(path)
    return kind === null ? [] : [{ path, kind, reason: 'push-off' as const }]
  })
}

/** The paths in `git diff --name-only -z --no-renames` output: NUL-separated and unquoted, a rename as its old and new paths. */
export const parseNulPaths = (output: string): string[] => output.split('\0').filter((path) => path !== '')
