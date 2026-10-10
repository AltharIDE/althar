import { execFile } from 'node:child_process'

import { type LaunchSpec, usualDirs } from '@althar/provider-adapters'
import type { OnDevice } from '@althar/runtime'
import { Effect, Exit } from 'effect'

import { start } from './editors'

/*
 * The device outside a Flatpak (docs/architecture/02): a Flatpak's home is a
 * fresh empty one, so the person's own agents and editors are not in it. The
 * app's manifest lets it talk to org.freedesktop.Flatpak, and through
 * `flatpak-spawn --host` they are found and run where they are installed —
 * the commands the person would run themselves. What reaches the device is
 * built here: the sandbox's own environment stays out (no ssh agent, no
 * signed-in tools, as ADR-011 wants), while the account's home, Althar's
 * settings and the few names every process needs (the device's home, PATH,
 * runtime directory) cross. Document-portal paths are told apart: inside the
 * sandbox a project is at /run/flatpak/doc/…, on the device at
 * /run/user/<uid>/doc/….
 */

/** Where a granted project is in the sandbox: the document portal, under a path that exists only here. */
const PORTAL = '/run/flatpak/doc'

/** A path as the device sees it: the portal's sandbox path becomes the one that exists there; everything else is the same on both sides. */
export const portalPath = (path: string, uid: number): string =>
  path === PORTAL ? `/run/user/${uid}/doc` : path.startsWith(`${PORTAL}/`) ? `/run/user/${uid}/doc${path.slice(PORTAL.length)}` : path

/** What the device's session says: the names every process needs, and only those. */
const FROM_THE_DEVICE = ['HOME', 'PATH', 'TMPDIR', 'LANG', 'LANGUAGE', 'TZ', 'USER', 'LOGNAME', 'XDG_RUNTIME_DIR'] as const

/** What an executor set for the agent itself — an account's home, Althar's settings: these cross where they differ from the sandbox's own. */
const FROM_THE_EXECUTOR = [
  'CODEX_HOME',
  'CODEX_CONFIG',
  'CLAUDE_CONFIG_DIR',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'OPENCODE_CONFIG_DIR',
  'OPENCODE_CONFIG_CONTENT',
  'GH_CONFIG_DIR',
  'GLAB_CONFIG_DIR',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_KEY_0',
  'GIT_CONFIG_VALUE_0',
  'GIT_TERMINAL_PROMPT',
] as const

export interface DeviceFacts {
  /** The device's own environment, as its session has it. */
  readonly env: Readonly<Record<string, string>>
  readonly uid: number
  /** Althar's own environment here: what differs from it is something an executor set, and crosses. */
  readonly ambient: NodeJS.ProcessEnv
}

/**
 * A launch taken out to the device: `flatpak-spawn` runs the same command
 * there, with the names from the device's session and what an executor set
 * for the agent, and nothing else — so the device's ssh agent and its
 * signed-in tools stay away from agents. The bus address is inherited, as
 * `flatpak-spawn` itself needs it. `--watch-bus` ends the command with this
 * one, even where a kill reaches nothing else.
 */
export const relayOut = (
  spec: LaunchSpec,
  at: { readonly cwd?: string; readonly env: Readonly<Record<string, string | undefined>> },
  facts: DeviceFacts,
): LaunchSpec => {
  const args = ['--watch-bus', '--host', '--clear-env']
  for (const name of FROM_THE_DEVICE) {
    const value = facts.env[name]
    if (value !== undefined) args.push(`--env=${name}=${value}`)
  }
  for (const name of FROM_THE_EXECUTOR) {
    const value = at.env[name]
    if (value !== undefined && value !== facts.ambient[name]) args.push(`--env=${name}=${portalPath(value, facts.uid)}`)
  }
  if (at.cwd !== undefined) args.push(`--directory=${portalPath(at.cwd, facts.uid)}`)
  return {
    command: 'flatpak-spawn',
    args: [...args, portalPath(spec.command, facts.uid), ...spec.args.map((arg) => portalPath(arg, facts.uid))],
    inheritEnv: ['DBUS_SESSION_BUS_ADDRESS'],
  }
}

/** The commands whose places are looked up on the device: the agents the person may have installed themselves. */
export const HOST_COMMANDS = ['opencode', 'claude', 'codex'] as const

/** A shell script for the device that prints each name it finds, and where: one line, a tab apart. */
export const whereScript = (names: ReadonlyArray<string>, dirs: ReadonlyArray<string> = usualDirs('linux', '$HOME', {})): string =>
  [
    `for name in ${names.join(' ')}; do`,
    `  found=$(command -v "$name" 2>/dev/null || true)`,
    `  if [ -z "$found" ]; then`,
    `    for dir in ${dirs.map((dir) => `"${dir}"`).join(' ')}; do`,
    `      if [ -x "$dir/$name" ]; then found="$dir/$name"; break; fi`,
    `    done`,
    `  fi`,
    `  if [ -n "$found" ]; then printf '%s\\t%s\\n' "$name" "$found"; fi`,
    `done`,
  ].join('\n')

/** What the device answered: each command it found, and where (`whereScript`). */
export const whereFound = (said: string): ReadonlyMap<string, string> =>
  new Map(
    said
      .split('\n')
      .map((line) => line.split('\t'))
      .flatMap(([name, path]) => (name === undefined || name === '' || path === undefined || path === '' ? [] : [[name, path] as const])),
  )

/** The device's environment, from what `env` said there: names may carry a `=` in their value. */
export const envFound = (said: string): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const line of said.split('\n')) {
    const at = line.indexOf('=')
    if (at > 0) env[line.slice(0, at)] = line.slice(at + 1)
  }
  return env
}

/**
 * The device, when Althar runs in a Flatpak; none anywhere else, where
 * everything is already local. Reachability is measured once; a device that
 * cannot be reached is still a device, and a run out there says what to put
 * right (`words.ts`) rather than looking like a missing install.
 */
export interface Device {
  readonly onDevice: OnDevice
  /** Starts one of the person's own commands out there, with the device's own environment — an editor needs its display and bus — and leaves it running. */
  readonly start: (command: string, args: ReadonlyArray<string>) => Effect.Effect<boolean>
  /** A path as the device sees it (`portalPath`). */
  readonly path: (path: string) => string
}

const ask = (args: ReadonlyArray<string>): Effect.Effect<string, Error> =>
  Effect.callback<string, Error>((resume) => {
    execFile('flatpak-spawn', [...args], { timeout: 15_000 }, (error, stdout, stderr) =>
      resume(error === null ? Effect.succeed(stdout) : Effect.fail(new Error(`${error.message}\n${stderr}`))),
    )
  })

export const deviceHere = (env: NodeJS.ProcessEnv = process.env, uid = process.getuid?.() ?? 1000): Effect.Effect<Device | undefined> => {
  if (env.FLATPAK_ID === undefined) return Effect.succeed(undefined)
  const path = (at: string) => portalPath(at, uid)
  const startThere = (command: string, args: ReadonlyArray<string>) => start('flatpak-spawn', ['--host', command, ...args], 'linux')
  const unreachable: Device = {
    onDevice: { reachable: false, where: () => null, run: (spec, at) => relayOut(spec, at, { env: {}, uid, ambient: env }) },
    start: startThere,
    path,
  }
  return Effect.gen(function* () {
    const reached = yield* Effect.exit(ask(['--host', 'true']))
    if (Exit.isFailure(reached)) return unreachable
    const facts = { env: envFound(yield* ask(['--host', 'env'])), uid, ambient: env }
    const here = whereFound(yield* ask(['--host', 'sh', '-c', whereScript(HOST_COMMANDS)]))
    return {
      onDevice: { reachable: true, where: (name) => here.get(name) ?? null, run: (spec, at) => relayOut(spec, at, facts) },
      start: startThere,
      path,
    }
  }).pipe(Effect.catch(() => Effect.succeed(unreachable)))
}
