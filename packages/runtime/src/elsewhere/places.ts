import { join, sep } from 'node:path'

import type { OtherTool } from '@althar/domain'

/*
 * Where each other tool keeps its work on this computer, as its own code
 * says (docs/decisions/workspaces-and-runs.md, "Bringing in other tools'
 * work"), read with the variables each honours. Nothing here reads a file:
 * it only says where to look, so a test points it at a home of its own.
 *
 * - Conductor: `~/conductor/workspaces/<repository>/<city>`, and
 *   `<repository>/.conductor/<city>` for repositories added before 0.25.
 * - Orca: `~/orca/workspaces[/<repository>]/<name>` (`settings.workspaceDir`,
 *   `repos[].worktreeBasePath` move it); its state in its app data's
 *   `profiles/<profile>/profile-state.db`.
 * - T3 Code: `$T3CODE_HOME` or `~/.t3`, worktrees in `worktrees/<repository>/…`
 *   (`userdata/settings.json`'s `worktreesDirectory` moves them).
 * - Paradev (Superset before it): `$SUPERSET_HOME_DIR`, `~/.paradev` or
 *   `~/.superset`, worktrees in `worktrees/<project>/<branch>`.
 * - Cursor: `~/.cursor/worktrees`.
 * - Codex: `$CODEX_HOME` or `~/.codex`, its sessions in `sessions/` and its
 *   worktrees in `worktrees/<id>/<repository>`.
 * - Claude Code: `$CLAUDE_CONFIG_DIR` or `~/.claude`, its sessions in
 *   `projects/<folder>/<session>.jsonl`, and `claude -w`'s worktrees in
 *   `<repository>/.claude/worktrees/<name>`.
 */

export interface Places {
  readonly home: string
  readonly claude: string
  readonly codex: string
  readonly t3: string
  /** Paradev's homes, the newer first: Superset's name stays as a link to it, or alone on an older install. */
  readonly paradev: ReadonlyArray<string>
  /** Orca's app data folders, by platform, the usual first. */
  readonly orca: ReadonlyArray<string>
  readonly conductor: string
  readonly cursor: string
}

const set = (value: string | undefined) => (value === undefined || value.trim() === '' ? undefined : value)

/** Where the tools keep their work for a person whose home is `home`, with the variables they read from `env`. */
export const placesOf = (home: string, env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform): Places => {
  const appData =
    platform === 'darwin'
      ? [join(home, 'Library', 'Application Support')]
      : platform === 'win32'
        ? [set(env['APPDATA']) ?? join(home, 'AppData', 'Roaming')]
        : [set(env['XDG_CONFIG_HOME']) ?? join(home, '.config')]
  return {
    home,
    claude: set(env['CLAUDE_CONFIG_DIR']) ?? join(home, '.claude'),
    codex: set(env['CODEX_HOME']) ?? join(home, '.codex'),
    t3: set(env['T3CODE_HOME']) ?? join(home, '.t3'),
    paradev: [
      ...(set(env['SUPERSET_HOME_DIR']) === undefined ? [] : [set(env['SUPERSET_HOME_DIR']) ?? '']),
      join(home, '.paradev'),
      join(home, '.superset'),
    ],
    orca: appData.flatMap((root) => [join(root, 'orca'), join(root, 'Orca')]),
    conductor: join(home, 'conductor'),
    cursor: join(home, '.cursor'),
  }
}

/** Whether `path` is `root` or inside it. */
export const within = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)

/**
 * The roots a tool keeps worktrees under, beyond its defaults: what its own
 * settings say, read by the caller (`stores.ts`).
 */
export interface Roots {
  readonly orca: ReadonlyArray<string>
  readonly t3: ReadonlyArray<string>
  readonly paradev: ReadonlyArray<string>
}

/**
 * Which tool made a worktree, by where it is: what a tool's own records
 * name comes first (the caller's `claimed`), then the folders each makes
 * them in. One no tool claims is the person's own, made by hand or by a tool
 * Althar doesn't know.
 */
export const madeBy = (
  input: {
    readonly path: string
    readonly repository: string
    /** The git folder of the worktree's own, where Codex leaves its mark (`codex-thread.json`). */
    readonly codexMarked: boolean
  },
  places: Places,
  roots: Roots,
): OtherTool => {
  const { path, repository } = input
  if (within(path, join(places.conductor, 'workspaces')) || within(path, join(repository, '.conductor'))) return 'conductor'
  if ([join(places.home, 'orca', 'workspaces'), ...roots.orca].some((root) => within(path, root))) return 'orca'
  if ([join(places.t3, 'worktrees'), ...roots.t3].some((root) => within(path, root))) return 't_three_code'
  if ([...places.paradev.map((home) => join(home, 'worktrees')), ...roots.paradev].some((root) => within(path, root))) return 'paradev'
  if (within(path, join(places.cursor, 'worktrees'))) return 'cursor'
  if (input.codexMarked || within(path, join(places.codex, 'worktrees'))) return 'codex'
  if (within(path, join(repository, '.claude', 'worktrees'))) return 'claude_code'
  return 'hand'
}

/** What each tool is called, as the person knows it. */
export const toolNames: Record<OtherTool, string> = {
  conductor: 'Conductor',
  orca: 'Orca',
  t_three_code: 'T3 Code',
  paradev: 'Paradev',
  cursor: 'Cursor',
  codex: 'Codex',
  claude_code: 'Claude Code',
  hand: 'By hand',
}
