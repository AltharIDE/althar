import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, win32 } from 'node:path'

import type { AgentDefinition, LaunchSpec, OutOnDevice } from './registry'

/*
 * Finding an agent's command, on a Mac, Windows or Linux (ADR-012's "the
 * official tool owns it" holds: every copy is the agent's own program, run
 * as itself). The person's own install always wins: on the PATH, or where
 * the usual installers put one, since an app opened from the Finder or the
 * Start menu doesn't get the PATH a terminal has. Where they have none, the
 * copy that ships with Althar stands in, then one Althar downloaded at their
 * asking, each by its full path, so nothing on the person's PATH changes.
 */

/** Where installers put commands, outside a GUI app's PATH, on each system. */
export const usualDirs = (
  platform: string = process.platform,
  home: string = homedir(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): ReadonlyArray<string> => {
  if (platform === 'win32') {
    const at = (...parts: ReadonlyArray<string>) => win32.join(...parts)
    return [
      at(home, '.local', 'bin'),
      at(home, '.opencode', 'bin'),
      at(home, '.bun', 'bin'),
      at(home, 'scoop', 'shims'),
      ...(env.APPDATA === undefined ? [] : [at(env.APPDATA, 'npm')]),
    ]
  }
  return [
    ...(platform === 'darwin' ? ['/opt/homebrew/bin'] : ['/home/linuxbrew/.linuxbrew/bin']),
    '/usr/local/bin',
    join(home, '.local', 'bin'),
    join(home, '.opencode', 'bin'),
    join(home, '.bun', 'bin'),
  ]
}

/**
 * The names a command goes by: on Windows with each of PATHEXT's endings, as
 * `opencode.exe` or `code.cmd`. A `.cmd` or `.bat` only runs through a shell,
 * so it counts only where the caller runs commands through one (`scripts`);
 * an agent's process starts without, so for an agent only a program counts.
 */
export const namesOf = (
  command: string,
  platform: string = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env,
  scripts = false,
) =>
  platform === 'win32'
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .map((ending) => ending.toLowerCase())
        .filter((ending) => ending !== '' && (scripts || ending === '.exe' || ending === '.com'))
        .map((ending) => `${command}${ending}`)
    : [command]

/** A program's file name on this system: `opencode.exe` on Windows. */
export const programName = (command: string, platform: string = process.platform) => (platform === 'win32' ? `${command}.exe` : command)

const executable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export interface Located {
  /** The command as a spec should run it: its bare name where it is on the PATH (outside Windows), else its full path. */
  readonly command: string
  /** Whose it is: the person's own, the copy that ships with Althar, or the one Althar downloaded. */
  readonly whose: 'theirs' | 'bundled' | 'althar'
  /**
   * Where this copy is not here but out on the device (a Flatpak's host, where
   * the person's own install lives): given the spec that names it, how that
   * spec runs out there (`Installs.ts`'s `onDevice`).
   */
  readonly out?: (spec: LaunchSpec) => OutOnDevice
}

export interface LocateOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly dirs?: ReadonlyArray<string>
  readonly platform?: string
  readonly isExecutable?: (path: string) => boolean
  /** On Windows, a `.cmd` or `.bat` counts too: for a caller that runs it through a shell. */
  readonly scripts?: boolean
}

/**
 * Where a command is: the person's, on the PATH or in a usual place; else
 * the copy that ships with Althar; else the one it downloaded; null where
 * there is none. On Windows always by its full path, as a program started
 * without a shell finds no `.cmd` by its bare name.
 */
export const locate = (
  command: string,
  copies: { readonly bundled: string | null; readonly kept: string | null },
  options: LocateOptions = {},
): Located | null => {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const isExecutable = options.isExecutable ?? executable
  const names = namesOf(command, platform, env, options.scripts === true)
  const separator = platform === 'win32' ? ';' : delimiter
  const at = (dir: string, name: string) => (platform === 'win32' ? win32.join(dir, name) : join(dir, name))
  const inDirs = (dirs: ReadonlyArray<string>) =>
    dirs.flatMap((dir) => (dir === '' ? [] : names.map((name) => at(dir, name)))).find(isExecutable)
  const onPath = inDirs((env.PATH ?? env.Path ?? '').split(separator))
  if (onPath !== undefined) return { command: platform === 'win32' ? onPath : command, whose: 'theirs' }
  const usual = inDirs(options.dirs ?? usualDirs(platform, homedir(), env))
  if (usual !== undefined) return { command: usual, whose: 'theirs' }
  if (copies.bundled !== null && isExecutable(copies.bundled)) return { command: copies.bundled, whose: 'bundled' }
  if (copies.kept !== null && isExecutable(copies.kept)) return { command: copies.kept, whose: 'althar' }
  return null
}

/** A path as a shell reads it as one word: single quotes on a Mac and Linux, double quotes on Windows. */
export const quoted = (path: string, platform: string = process.platform): string =>
  // A backslash is only a separator on Windows; elsewhere the shell would read it as an escape.
  (platform === 'win32' ? /^[\w./:\\-]+$/ : /^[\w./-]+$/).test(path)
    ? path
    : platform === 'win32'
      ? `"${path}"`
      : `'${path.replaceAll("'", `'\\''`)}'`

/**
 * The agent, with every command it runs pointed at where its command is,
 * looked up each time, so a copy downloaded while Althar runs is used at
 * once; and what the person runs to sign in names the same copy. An agent
 * without a named command, or whose command is nowhere, is as it was.
 */
export const usingLocated = (definition: AgentDefinition, find: () => Located | null): AgentDefinition => {
  const cli = definition.cli
  if (cli === undefined) return definition
  const pointed =
    <A extends ReadonlyArray<unknown>>(make: (...args: A) => LaunchSpec) =>
    (...args: A): LaunchSpec => {
      const spec = make(...args)
      const found = spec.command === cli.name ? find() : null
      if (found === null) return spec
      const named = { ...spec, command: found.command }
      return found.out === undefined ? named : { ...named, onDevice: found.out(named) }
    }
  const { signIn } = definition
  return {
    ...definition,
    launch: pointed(definition.launch),
    signIn: {
      ...signIn,
      get login() {
        const found = find()
        return found === null || found.command === cli.name || !signIn.login.startsWith(`${cli.name} `)
          ? signIn.login
          : `${quoted(found.command)}${signIn.login.slice(cli.name.length)}`
      },
      status: pointed(signIn.status),
      ...(signIn.inApp === undefined ? {} : { inApp: { ...signIn.inApp, run: pointed(signIn.inApp.run) } }),
      ...(signIn.logout === undefined ? {} : { logout: { ...signIn.logout, run: pointed(signIn.logout.run) } }),
    },
    ...(definition.version === undefined ? {} : { version: pointed(definition.version) }),
  }
}
