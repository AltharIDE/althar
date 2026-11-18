import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { Effect, Schema } from 'effect'

import { configuredHome } from './configuration'
import { HostError, fileErrorCode } from './errors'
import { initializeHome, type HostDependencies } from './home'
import type { HostOptions } from './options'
import { privateDirectory, readPrivate, writePrivate } from './privateFiles'
import type { ServiceCommands } from './service'
import { hostStatus } from './status'
import { readReleaseKey } from './updates/bundle'
import { releaseInfo } from './updates/info'
import { MAX_MANIFEST_BYTES, verifyRelease } from './updates/release'
import { configureUpdates } from './updates/setup'

const processFile = promisify(execFile)
type ProcessOptions = { timeout: number; maxBuffer?: number; env?: NodeJS.ProcessEnv }
export interface SetupSystem {
  readonly command: (file: string, args: string[], options: ProcessOptions) => Promise<{ stdout: string; stderr: string }>
  readonly install: typeof configureUpdates
  readonly ready: typeof hostStatus
}
const defaultSystem: SetupSystem = { command: processFile, install: configureUpdates, ready: hostStatus }
const UNIT = 'althar-host-setup.service'
const LOG_LIMIT = 48 * 1024
const Step = Schema.Literals(['setup', 'start', 'identity'])
const Event = Schema.Struct({
  protocol: Schema.Literal(1),
  step: Step,
  state: Schema.Literals(['started', 'done', 'failed']),
  code: Schema.optional(Schema.String),
  homeId: Schema.optional(Schema.String),
  hostDeviceId: Schema.optional(Schema.String),
  apiVersion: Schema.optional(Schema.Int),
  version: Schema.optional(Schema.String),
})
type Event = typeof Event.Type
const Plan = Schema.Struct({ node: Schema.String, entry: Schema.String, manifest: Schema.String, key: Schema.String })
type Plan = typeof Plan.Type
const State = Schema.Struct({ protocol: Schema.Literal(1), plan: Plan, events: Schema.Array(Event) })
type State = typeof State.Type
const folder = (options: HostOptions) => `${options.updateRoot}.setup-v1`
const statePath = (root: string) => join(root, 'setup.json')
const logPath = (root: string) => join(root, 'setup.log')

class SetupFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}
const failure = (code: string, message: string) => new SetupFailure(code, message)
const notFound = () => failure('SetupNotFound', 'Start setup with a verified release first.')
const locked = () => failure('LockHeld', 'Another host setup is running. Check setup status before retrying.')
const invalidRelease = () => failure('SignatureMismatch', 'The portable release failed signature, expiration or platform verification.')
const readState = async (root: string): Promise<State | null> => {
  const bytes = await readPrivate(statePath(root), 32 * 1024, true)
  if (bytes === null) return null
  return Schema.decodeUnknownSync(State)(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
}
const unitActive = async (system: SetupSystem) => {
  try {
    await system.command('systemctl', ['--user', 'is-active', '--quiet', UNIT], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}
const readOutput = async (root: string) => (await readPrivate(logPath(root), LOG_LIMIT, true))?.toString('utf8') ?? ''
const appendOutput = async (root: string, text: string) => {
  const next = Buffer.from((await readOutput(root)) + text)
  await writePrivate(logPath(root), next.subarray(Math.max(0, next.length - LOG_LIMIT)), true)
}
const verify = async (plan: Plan) => {
  try {
    const bytes = await readPrivate(plan.manifest, MAX_MANIFEST_BYTES, true)
    if (bytes === null) throw invalidRelease()
    const actual = releaseInfo()
    const release = verifyRelease(bytes, {
      keys: [await readReleaseKey(plan.key)],
      arch: actual.arch,
      now: Date.now(),
      installedVersion: '0.0.0',
      minimumSequence: 0,
    })
    const { manifest } = release
    if (actual.version !== manifest.version || actual.apiVersion !== manifest.apiVersion || actual.storage !== manifest.storage)
      throw invalidRelease()
    return release
  } catch {
    throw invalidRelease()
  }
}

export const setupStatus = async (options: HostOptions, system: SetupSystem = defaultSystem) => {
  const root = folder(options)
  const state = await readState(root)
  if (state === null) return { protocol: 1, state: (await unitActive(system)) ? 'queued' : 'absent', events: [], rawOutput: '' }
  const last = state.events.at(-1)
  const status =
    last?.step === 'identity' && last.state === 'done'
      ? 'done'
      : (await unitActive(system))
        ? 'running'
        : last?.state === 'failed'
          ? 'failed'
          : 'interrupted'
  return { protocol: 1, state: status, events: state.events, rawOutput: await readOutput(root) }
}

const launch = async (options: HostOptions, commands: ServiceCommands, plan: Plan, system: SetupSystem) => {
  try {
    await system.command('systemctl', ['--user', 'show-environment'], { timeout: 5000 })
  } catch {
    throw failure('NoUserManager', 'Could not reach the systemd user manager in this login session.')
  }
  if (await unitActive(system)) throw locked()
  const inherited = ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'ALTHAR_HOST_PROFILE'].flatMap((key) => {
    const value = process.env[key]
    return value === undefined ? [] : [`--setenv=${key}=${value}`]
  })
  try {
    await system.command(
      'systemd-run',
      [
        '--user',
        '--quiet',
        '--collect',
        `--unit=${UNIT}`,
        '--property=Type=exec',
        '--property=RuntimeMaxSec=15min',
        '--property=UMask=0077',
        '--setenv=ALTHAR_HOST_SETUP_UNIT=1',
        `--setenv=PATH=${commands.path}`,
        ...inherited,
        '--',
        '/usr/bin/flock',
        '--nonblock',
        '--no-fork',
        '--conflict-exit-code',
        '75',
        join(folder(options), 'lock'),
        plan.node,
        plan.entry,
        'setup',
        '--run-setup',
        '--installation',
        options.updateRoot,
        '--profile',
        options.profile,
        '--key-file',
        options.keyFile,
        '--manifest',
        plan.manifest,
        '--release-key',
        plan.key,
        '--json',
      ],
      { timeout: 10_000, maxBuffer: 16 * 1024 },
    )
  } catch {
    if (await unitActive(system)) throw locked()
    throw failure('SetupLaunchFailed', 'The systemd user manager could not launch host setup.')
  }
}

const runSetup = async (
  options: HostOptions,
  commands: ServiceCommands,
  plan: Plan,
  dependencies: HostDependencies,
  out: (line: string) => void,
  system: SetupSystem,
) => {
  const root = folder(options)
  const existing = await readState(root)
  const oldEvents = existing?.events ?? []
  const events = oldEvents.filter((entry) => entry.state === 'done')
  if (events.some((entry) => entry.step === 'identity')) return
  let step: typeof Step.Type = 'setup'
  const report = async (entry: Omit<Event, 'protocol'>) => {
    const event: Event = { protocol: 1, ...entry }
    events.push(event)
    await writePrivate(statePath(root), JSON.stringify({ protocol: 1, plan, events }), true)
    out(`${JSON.stringify(event)}\n`)
  }
  const run: NonNullable<ServiceCommands['run']> = async (file, args, env) => {
    try {
      const result = await system.command(file, [...args], { timeout: 125_000, maxBuffer: LOG_LIMIT, ...(env ? { env } : {}) })
      await appendOutput(root, `${result.stdout}${result.stderr}`)
    } catch (error) {
      if (typeof error === 'object' && error !== null) {
        const output = error as { stdout?: string; stderr?: string }
        await appendOutput(root, `${output.stdout ?? ''}${output.stderr ?? ''}`)
      }
      throw error
    }
  }
  try {
    if (!events.some((entry) => entry.step === 'setup')) {
      await report({ step, state: 'started' })
      const signedBootstrap = await verify(plan)
      const initialized = await Effect.runPromise(initializeHome({ ...options, projects: [] }, dependencies))
      const configured = await Effect.runPromise(configuredHome(options))
      await system.install({ ...configured, start: false }, { ...commands, run }, { signedBootstrap })
      await report({ step, state: 'done', homeId: initialized.homeId })
    }
    step = 'start'
    if (!events.some((entry) => entry.step === 'start')) {
      await report({ step, state: 'started' })
      // The managed unit is Type=notify, so systemctl waits for its readiness barrier.
      await run('systemctl', ['--user', 'enable', '--now', `${options.serviceName}.service`])
      await report({ step, state: 'done' })
    }
    step = 'identity'
    await report({ step, state: 'started' })
    const identity = await Effect.runPromise(system.ready(options.profile, true))
    if (identity.homeId !== events.find((entry) => entry.step === 'setup' && entry.state === 'done')?.homeId)
      throw failure('IdentityMismatch', 'The running service does not match the initialized home.')
    await report({ ...identity, step, state: 'done' })
  } catch (error) {
    const code =
      error instanceof SetupFailure
        ? error.code
        : fileErrorCode(error) === 'ENOSPC'
          ? 'NotEnoughDisk'
          : step === 'setup'
            ? 'InstallFailed'
            : 'ServiceFailedToStart'
    await appendOutput(root, `${error instanceof Error ? error.message : 'Host setup failed.'}\n`)
    await report({ step, state: 'failed', code })
    throw failure(code, 'Host setup stopped. Read setup status and the user service journal before resuming.')
  }
}

export const setupHome = async (
  options: HostOptions,
  commands: ServiceCommands,
  out: (line: string) => void,
  dependencies: HostDependencies,
  system: SetupSystem = defaultSystem,
) => {
  const signalFailure = (issue: SetupFailure) => {
    out(`${JSON.stringify({ protocol: 1, step: 'setup', state: 'failed', code: issue.code })}\n`)
    return new HostError({ code: 'InvalidConfig', message: issue.message })
  }
  try {
    if (process.getuid?.() === 0) throw failure('DedicatedUserRequired', 'Set up the home in its dedicated account.')
    const root = await privateDirectory(folder(options), true)
    const mode = options.setup?.mode
    const state = await readState(root)
    const done = state?.events.at(-1)
    if (done?.step === 'identity' && done.state === 'done') {
      out(`${JSON.stringify(done)}\n`)
      return
    }
    const manifest = options.setup?.manifest
    const key = options.releaseKeys[0]
    const plan = manifest !== undefined && key !== undefined ? { node: commands.node, entry: commands.entry, manifest, key } : state?.plan
    if (plan === undefined) throw notFound()
    if (mode === 'run') {
      if (process.env.ALTHAR_HOST_SETUP_UNIT !== '1' || !process.env.INVOCATION_ID)
        throw failure('InvalidRequest', 'Use setup or setup --resume to start the locked installer.')
      await runSetup(options, commands, plan, dependencies, out, system)
      return
    }
    if (manifest !== undefined) await verify(plan)
    await launch(options, commands, plan, system)
    out(`${JSON.stringify({ protocol: 1, step: 'setup', state: 'started', detached: true })}\n`)
  } catch (error) {
    throw signalFailure(
      error instanceof SetupFailure ? error : failure('InstallFailed', 'The host setup directory or checkpoint is unavailable.'),
    )
  }
}
