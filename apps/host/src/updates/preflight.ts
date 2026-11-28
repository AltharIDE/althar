import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

import { agents } from '@althar/provider-adapters'
import { type Pty, PtySpawner } from '@althar/runtime'
import { Effect, Schema } from 'effect'

import metadata from '../../package.json'
import { readPrivate } from '../privateFiles'
import { shippedSandbox } from '../workerCheck'
import { updateError } from './store'

/** Starts a program in a pseudo-terminal, as a terminal's shell starts. */
export type StartPty = (
  file: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly cols: number; readonly rows: number; readonly env: Record<string, string> },
) => Pty

/** node-pty as the runtime loads it as a terminal opens: from beside the host's entry, in a release from the release. */
const runtimePty: StartPty = (file, args, options) =>
  Effect.runSync(
    Effect.gen(function* () {
      return yield* PtySpawner
    }).pipe(Effect.provide(PtySpawner.node)),
  ).spawn(file, args, options)

const ptyRefused = () => updateError('UpdateFailed', 'The release can’t start a terminal: its node-pty is missing or doesn’t load here.')

/** A shell started the way a terminal starts one, through node-pty, that prints and ends well. */
const startsAShell = (start: StartPty, cwd: string) =>
  new Promise<void>((done, fail) => {
    let printed = ''
    let heard = false
    const pty = (() => {
      try {
        return start('/bin/sh', ['-c', 'echo althar-pty'], { cwd, cols: 80, rows: 24, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } })
      } catch {
        return undefined
      }
    })()
    if (pty === undefined) return fail(ptyRefused())
    // oxlint-disable-next-line althar/one-clock -- a release probe outside any effect, as execFile's own timeout above
    const timer = setTimeout(() => {
      pty.kill()
      fail(ptyRefused())
    }, 30_000)
    pty.onData((data) => {
      printed += data
      if (printed.includes('althar-pty')) heard = true
    })
    pty.onExit(({ exitCode }) => {
      clearTimeout(timer)
      if (heard && exitCode === 0) done()
      else fail(ptyRefused())
    })
  })

/** Runs only side-effect-free version probes in a fresh home with no inherited provider credentials. */
export const verifyBundledPrograms = async (entry: string, start: StartPty = runtimePty) => {
  const require = createRequire(entry)
  const probe = await fs.mkdtemp(join(tmpdir(), 'althar-release-probe-'))
  try {
    // A home's terminals: node-pty from the release, for this machine, starting a shell; one missing or built elsewhere can't.
    await startsAShell(start, probe)
    for (const name of ['@agentclientprotocol/claude-agent-acp', '@agentclientprotocol/codex-acp'] as const) {
      const bytes = await readPrivate(require.resolve(`${name}/package.json`), 65_536)
      const value = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }))(
        JSON.parse(new TextDecoder().decode(bytes ?? Buffer.alloc(0))),
      )
      if (value.version !== metadata.dependencies[name])
        throw updateError('ReleaseRejected', 'The bundled adapter versions do not match this host release.')
    }
    let codex: string | null = null
    for (const id of ['claude-code', 'codex'] as const) {
      const program = agents[id].cli?.bundled?.()
      if (program === undefined || program === null)
        throw updateError('UpdateFailed', 'The release is missing its native provider CLI for this platform.')
      if (id === 'codex') codex = program
      await promisify(execFile)(program, ['--version'], {
        env: {
          HOME: probe,
          XDG_CONFIG_HOME: probe,
          XDG_DATA_HOME: probe,
          CODEX_HOME: probe,
          CLAUDE_CONFIG_DIR: probe,
          PATH: '/usr/bin:/bin',
          LANG: 'C.UTF-8',
          DISABLE_AUTOUPDATER: '1',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        },
        timeout: 30_000,
        maxBuffer: 16_384,
      })
    }
    // A release that carries the worker carries what its agents' sandbox needs too: Codex's bubblewrap and ripgrep, its socat.
    const release = resolve(dirname(entry), '..')
    if (await executable(join(release, 'althar-worker'))) {
      const shipped = shippedSandbox(release, codex)
      for (const name of ['bwrap', 'rg', 'socat'] as const) {
        const program = shipped[name]
        if (program === undefined || !(await executable(program)))
          throw updateError('UpdateFailed', `The release is missing ${name}, which its worker’s sandbox needs.`)
      }
    }
  } finally {
    await fs.rm(probe, { recursive: true, force: true }).catch(() => undefined)
  }
}

const executable = (path: string) =>
  fs.access(path, fs.constants.X_OK).then(
    () => true,
    () => false,
  )
