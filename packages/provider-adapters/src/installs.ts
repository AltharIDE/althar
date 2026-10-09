import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

import type { AgentDefinition, LaunchSpec } from './registry'

/*
 * Finding an agent's command, and the copy Althar downloaded where the
 * person has none (ADR-012's "the official tool owns it" holds: it is the
 * agent's own release, run as itself). The person's own install always
 * wins: on the PATH, or where the usual installers put one, since an app
 * opened from the Finder doesn't get the PATH a terminal has. Only where
 * neither has it does Althar's copy stand in, by its absolute path, so
 * nothing on the person's PATH changes.
 */

/** Where installers put commands, outside a GUI app's PATH: Homebrew, ~/.local/bin, and agents' own installers. */
export const usualDirs = (home = homedir()): ReadonlyArray<string> => [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  join(home, '.local', 'bin'),
  join(home, '.opencode', 'bin'),
  join(home, '.bun', 'bin'),
]

const executable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export interface Located {
  /** The command as a spec should run it: its bare name where it is on the PATH, else its full path. */
  readonly command: string
  /** Whose it is: the person's on their PATH or in a usual place, or the copy Althar keeps. */
  readonly whose: 'theirs' | 'althar'
}

/**
 * Where a command is: on the PATH, in a usual place, or Althar's copy;
 * null where none has it.
 */
export const locate = (
  command: string,
  kept: string | null,
  env: { readonly PATH?: string | undefined } = process.env,
  dirs: ReadonlyArray<string> = usualDirs(),
  isExecutable: (path: string) => boolean = executable,
): Located | null => {
  const onPath = (env.PATH ?? '').split(delimiter).some((dir) => dir !== '' && isExecutable(join(dir, command)))
  if (onPath) return { command, whose: 'theirs' }
  const usual = dirs.map((dir) => join(dir, command)).find(isExecutable)
  if (usual !== undefined) return { command: usual, whose: 'theirs' }
  return kept !== null && isExecutable(kept) ? { command: kept, whose: 'althar' } : null
}

/** A path as a shell reads it as one word. */
export const quoted = (path: string): string => (/^[\w./-]+$/.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`)

/**
 * The agent, with every command it runs pointed at where its command is,
 * looked up each time, so a copy downloaded while Althar runs is used at
 * once. An agent Althar can't download, or whose command is nowhere, is as
 * it was.
 */
export const usingLocated = (definition: AgentDefinition, find: () => Located | null): AgentDefinition => {
  const install = definition.install
  if (install === undefined) return definition
  const pointed =
    <A extends ReadonlyArray<unknown>>(make: (...args: A) => LaunchSpec) =>
    (...args: A): LaunchSpec => {
      const spec = make(...args)
      const found = spec.command === install.command ? find() : null
      return found === null ? spec : { ...spec, command: found.command }
    }
  const { signIn } = definition
  return {
    ...definition,
    launch: pointed(definition.launch),
    signIn: {
      ...signIn,
      // What the person runs in a terminal names the same command: Althar's copy by its full path, quoted, as it isn't on their PATH.
      get login() {
        const found = find()
        return found === null || found.command === install.command || !signIn.login.startsWith(`${install.command} `)
          ? signIn.login
          : `${quoted(found.command)}${signIn.login.slice(install.command.length)}`
      },
      status: pointed(signIn.status),
      ...(signIn.inApp === undefined ? {} : { inApp: { ...signIn.inApp, run: pointed(signIn.inApp.run) } }),
      ...(signIn.logout === undefined ? {} : { logout: { ...signIn.logout, run: pointed(signIn.logout.run) } }),
    },
    ...(definition.version === undefined ? {} : { version: pointed(definition.version) }),
  }
}
