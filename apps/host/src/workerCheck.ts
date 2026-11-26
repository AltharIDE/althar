import { execFile } from 'node:child_process'
import { accessSync, constants, readFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { BWRAP_TRY, bundledCodex, connect, type AgentDefinition, type ConfigOption, type LaunchSpec } from '@althar/provider-adapters'
import { Duration, Effect } from 'effect'

/*
 * A worker's check of itself (`althar-host worker check`), as its setup ends, after each sign-in, and with its hourly
 * timer: what Claude Code's and Codex's sandbox need shipped and linked where its runs find them (bubblewrap and
 * ripgrep from Codex's own package, socat built for the release), whether bubblewrap actually starts a namespace there,
 * and where it can't, why and the one command an administrator runs to let it; the tools on its PATH; and each
 * signed-in agent started once, as a run starts it, which says the models it offers there. What it finds is kept in
 * `readiness`, beside `signed-in`, which the worker sends the home with its hello and heartbeats (agent_readiness.rs).
 */

export type SandboxProblem = 'NoUserNamespaces' | 'NoBubblewrap' | 'NoSocat' | 'Failed'
export type SandboxCheck =
  | { readonly starts: true; readonly bwrap: string }
  | { readonly starts: false; readonly problem: SandboxProblem; readonly fix?: string }

export interface AgentCheck {
  readonly id: string
  readonly name: string
  readonly signedIn: boolean
  /** Started once, as a run starts it; or why not. Not tried where it isn't signed in. */
  readonly started?: boolean
  readonly message?: string
  readonly models: ReadonlyArray<{ readonly id: string; readonly name: string }>
}

export interface WorkerCheck {
  readonly sandbox: SandboxCheck
  readonly tools: ReadonlyArray<{ readonly name: string; readonly version: string }>
  readonly agents: ReadonlyArray<AgentCheck>
}

/** What the check runs on: programs it runs, files it reads, and starting an agent once. */
export interface CheckSystem {
  /** Runs a program to its end, or for `timeout` ms at most: whether it exited cleanly, and what it printed. */
  readonly run: (
    command: string,
    args: ReadonlyArray<string>,
    options?: { readonly env?: NodeJS.ProcessEnv; readonly timeout?: number },
  ) => Promise<{ readonly ok: boolean; readonly stdout: string; readonly stderr: string }>
  readonly read: (path: string) => string | undefined
  readonly executable: (path: string) => boolean
  /** Starts the agent this program runs, as a run would, and reads its models: what its session offers. */
  readonly startAgent: (
    definition: AgentDefinition,
    program: string,
    env: Readonly<Record<string, string>>,
    sandboxStarts: boolean,
  ) => Promise<ReadonlyArray<{ readonly id: string; readonly name: string }>>
}

/** The tools a project's files may ask for, looked for on the worker's PATH. */
export const CHECKED_TOOLS = [
  'git',
  'bun',
  'node',
  'npm',
  'pnpm',
  'yarn',
  'uv',
  'python3',
  'cargo',
  'go',
  'bundle',
  'ruby',
  'java',
  'make',
] as const

const home = (env: NodeJS.ProcessEnv) => env.HOME || homedir()

/**
 * The folders a worker's runs find programs in, as the worker puts them (apps/worker/src/agent_setup.rs `worker_path`),
 * without those of tools installed for one run: what it ships for its agents' sandbox first (`bin`, which holds only
 * bubblewrap, socat and ripgrep, under the one AppArmor rule that lets them), then the person's own folders, where a
 * lead's fix installs, then the system's, and last its own Node.
 */
export const workerPath = (folder: string, current: string, env: NodeJS.ProcessEnv = process.env) =>
  [
    join(folder, 'bin'),
    join(home(env), '.local', 'bin'),
    join(home(env), '.bun', 'bin'),
    join(home(env), '.cargo', 'bin'),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    join(current, 'node', 'bin'),
  ].join(':')

/** What a release ships for its agents' sandbox, by name: bubblewrap and ripgrep from Codex's own package, socat its own. */
export const shippedSandbox = (current: string, codex: string | null = bundledCodex()) => {
  // Codex's program is <vendor>/<target>/bin/codex; its bubblewrap and ripgrep sit beside that folder.
  const target = codex === null ? undefined : dirname(dirname(codex))
  return {
    ...(target === undefined ? {} : { bwrap: join(target, 'codex-resources', 'bwrap'), rg: join(target, 'codex-path', 'rg') }),
    socat: join(current, 'tools', 'bin', 'socat'),
  } as Readonly<Partial<Record<'bwrap' | 'rg' | 'socat', string>>>
}

/**
 * Links what the release ships for the sandbox into the worker's `bin`, through `current`, so the links hold across an
 * update; each replaced atomically. A program the release doesn't carry is left out, and the check says so.
 */
export const linkShipped = async (
  folder: string,
  programs: Readonly<Partial<Record<string, string>>>,
  exists: (path: string) => boolean,
) => {
  const bin = join(folder, 'bin')
  await fs.mkdir(bin, { recursive: true, mode: 0o700 })
  for (const [name, target] of Object.entries(programs)) {
    const link = join(bin, name)
    if (target === undefined || !exists(target)) {
      await fs.rm(link, { force: true })
      continue
    }
    const next = join(bin, `.${name}-${process.pid}`)
    await fs.rm(next, { force: true })
    await fs.symlink(target, next)
    await fs.rename(next, link)
  }
}

const SAFE_PATH = /^\/[A-Za-z0-9._/-]+$/u

/**
 * The AppArmor rule newer Ubuntu needs before bubblewrap may make a user namespace
 * (`kernel.apparmor_restrict_unprivileged_userns`): unconfined, with `userns`, for this worker's own bubblewrap alone,
 * at its program folder's releases. As ssh.sh's `sandbox_rule` writes it for a root login.
 */
export const apparmorRule = (program: string) =>
  [
    'abi <abi/4.0>,',
    'include <tunables/global>',
    `profile althar-worker-bwrap ${program}/bundle-*/**/bwrap flags=(unconfined) {`,
    '  userns,',
    '  include if exists <local/althar-worker-bwrap>',
    '}',
  ].join('\n')

export const APPARMOR_FILE = '/etc/apparmor.d/althar-worker-bwrap'

/** The root part of letting the sandbox start: a `sh -c` script, one line, in single quotes to copy as it is. */
const rootScript = (lines: ReadonlyArray<string>, then: string) => `printf "%s\\n" ${lines.map((line) => `"${line}"`).join(' ')} > ${then}`

/** What an administrator runs once to let the sandbox start, on one line; none where it can't be said safely. */
export const sandboxFix = (cause: 'apparmor' | 'clone' | 'max', program: string): string | undefined => {
  if (cause === 'apparmor') {
    if (!SAFE_PATH.test(program)) return undefined
    return `sudo sh -c '${rootScript(apparmorRule(program).split('\n'), APPARMOR_FILE)} && apparmor_parser -r ${APPARMOR_FILE}'`
  }
  const [name, value] = cause === 'clone' ? ['kernel.unprivileged_userns_clone', '1'] : ['user.max_user_namespaces', '15000']
  return `sudo sh -c 'sysctl -w ${name}=${value} && printf "%s\\n" "${name}=${value}" > /etc/sysctl.d/60-althar-worker-userns.conf'`
}

const onPath = (path: string, name: string, executable: (path: string) => boolean) =>
  path
    .split(':')
    .map((folder) => join(folder, name))
    .find(executable)

/**
 * Whether bubblewrap starts a namespace for this worker's runs: the first on their PATH, in a user unit as their agents
 * run, with no new privileges. Where it doesn't, the kernel's own switches say why, and what lets it.
 */
export const checkSandbox = async (path: string, program: string, system: CheckSystem): Promise<SandboxCheck> => {
  const bwrap = onPath(path, 'bwrap', system.executable)
  if (bwrap === undefined) return { starts: false, problem: 'NoBubblewrap' }
  if (onPath(path, 'socat', system.executable) === undefined) return { starts: false, problem: 'NoSocat' }
  const unit = system.executable('/usr/bin/systemd-run')
    ? {
        command: '/usr/bin/systemd-run',
        args: ['--user', '--quiet', '--wait', '--pipe', '--collect', '--property=NoNewPrivileges=yes', '--', bwrap, ...BWRAP_TRY],
      }
    : { command: bwrap, args: [...BWRAP_TRY] }
  if ((await system.run(unit.command, unit.args, { env: { ...process.env, PATH: path }, timeout: 20_000 })).ok)
    return { starts: true, bwrap }
  const switched = (file: string) => system.read(file)?.trim()
  const cause =
    switched('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') === '1'
      ? 'apparmor'
      : switched('/proc/sys/kernel/unprivileged_userns_clone') === '0'
        ? 'clone'
        : switched('/proc/sys/user/max_user_namespaces') === '0'
          ? 'max'
          : undefined
  if (cause === undefined) return { starts: false, problem: 'Failed' }
  const fix = sandboxFix(cause, program)
  return { starts: false, problem: 'NoUserNamespaces', ...(fix === undefined ? {} : { fix }) }
}

const VERSION = /\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.]+)?/u

/** Each of the checked tools on the PATH, with the version it says. */
export const checkTools = async (path: string, system: CheckSystem) => {
  const found = await Promise.all(
    CHECKED_TOOLS.map(async (name) => {
      const program = onPath(path, name, system.executable)
      if (program === undefined) return undefined
      const asked = await system.run(program, name === 'go' ? ['version'] : name === 'java' ? ['-version'] : ['--version'], {
        env: { ...process.env, PATH: path },
        timeout: 5_000,
      })
      const version = VERSION.exec(`${asked.stdout}\n${asked.stderr}`)?.[0]
      return { name, version: version ?? 'unknown' }
    }),
  )
  return found.flatMap((tool) => (tool === undefined ? [] : [tool]))
}

/** The models a session offers, from its settings: the agent's own `model` option, or the first in its category. */
export const offeredModels = (definition: AgentDefinition, options: ReadonlyArray<ConfigOption>) => {
  const option = options.find((one) => one.id === definition.options.model) ?? options.find((one) => one.category === 'model')
  const choices = option === undefined ? [] : (option.choices ?? option.values.map((value) => ({ value, name: value })))
  return choices.map((choice) => ({ id: choice.value, name: choice.name }))
}

const field = (value: string) => value.replace(/[\t\n\r]/gu, ' ').trim()

/** The lines the worker reads (agent_readiness.rs), for what a check found. */
export const readinessLines = (check: WorkerCheck) =>
  [
    check.sandbox.starts ? 'sandbox\tstarts' : `sandbox\tfails\t${check.sandbox.problem}`,
    ...(!check.sandbox.starts && check.sandbox.fix !== undefined ? [`fix\t${field(check.sandbox.fix)}`] : []),
    ...check.tools.map((tool) => `tool\t${field(tool.name)}\t${field(tool.version)}`),
    ...check.agents.flatMap((agent) => agent.models.map((model) => `model\t${agent.id}\t${field(model.id)}\t${field(model.name)}`)),
    // Each agent it started, and whether it did: one that couldn't takes no task there.
    ...check.agents.flatMap((agent) =>
      agent.started === undefined
        ? []
        : [agent.started ? `agent\t${agent.id}\tstarts` : `agent\t${agent.id}\tfails\t${field(agent.message ?? 'It couldn’t start.')}`],
    ),
  ]
    .map((line) => `${line}\n`)
    .join('')

/** This computer: its programs, its files, and its agents started as the worker's runs start them. */
export const checkHere: CheckSystem = {
  run: (command, args, options = {}) =>
    new Promise((resolve) => {
      execFile(
        command,
        [...args],
        { timeout: options.timeout ?? 10_000, env: options.env ?? process.env, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => resolve({ ok: error === null, stdout: String(stdout), stderr: String(stderr) }),
      )
    }),
  read: (path) => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
  },
  executable: (path) => {
    try {
      accessSync(path, constants.X_OK)
      return true
    } catch {
      return false
    }
  },
  startAgent: async (definition, program, env, sandboxStarts) => {
    const folder = await fs.mkdtemp(join(tmpdir(), 'althar-worker-check-'))
    try {
      // The worker's own program for the agent (agents.conf's), in an empty folder: what a run starts.
      const spec: LaunchSpec = { command: program, args: [], env }
      return await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* connect({
              transport: { _tag: 'Process', spec, cwd: folder },
              onPermission: () => Effect.succeed({ decision: 'reject' as const }),
              permissions: definition.permissions,
            })
            const session = yield* connection.newSession({
              cwd: folder,
              mode: definition.modes.ask,
              modeOptionId: definition.options.mode,
              ...(definition.sessionMeta === undefined ? {} : { meta: definition.sessionMeta('lead', { sandboxStarts }) }),
            })
            return offeredModels(definition, yield* session.options)
          }),
        ).pipe(Effect.timeout(Duration.seconds(60))),
      )
    } finally {
      await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined)
    }
  },
}

/** Why an agent couldn't start, in a line: its own words where it gave some, short. */
const startProblem = (error: unknown) => {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const line = message.split('\n').find((one) => one.trim() !== '') ?? ''
  return line === '' ? 'It couldn’t start.' : line.length > 300 ? `${line.slice(0, 299)}…` : line
}

/**
 * The whole check: the sandbox, the tools, and each signed-in agent started once with the sandbox as it found it. Kept in
 * `readiness`, written only where it changed.
 */
export const checkWorker = async (
  input: {
    readonly folder: string
    readonly current: string
    readonly program: string
    readonly agents: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly definition: AgentDefinition
      readonly signedIn: boolean
    }>
  },
  system: CheckSystem = checkHere,
  write: (path: string, text: string) => Promise<unknown> = (path, text) => fs.writeFile(path, text, { mode: 0o600 }),
): Promise<WorkerCheck> => {
  const path = workerPath(input.folder, input.current)
  const sandbox = await checkSandbox(path, input.program, system)
  const tools = await checkTools(path, system)
  const agents: AgentCheck[] = []
  // One at a time: a small worker starts one agent's program at once, as it runs one task.
  for (const agent of input.agents) {
    if (!agent.signedIn) {
      agents.push({ id: agent.id, name: agent.name, signedIn: false, models: [] })
      continue
    }
    try {
      const models = await system.startAgent(agent.definition, join(input.folder, 'agents', agent.id), { PATH: path }, sandbox.starts)
      agents.push({ id: agent.id, name: agent.name, signedIn: true, started: true, models })
    } catch (error) {
      agents.push({ id: agent.id, name: agent.name, signedIn: true, started: false, message: startProblem(error), models: [] })
    }
  }
  const check = { sandbox, tools, agents }
  const file = join(input.folder, 'readiness')
  const text = readinessLines(check)
  if (system.read(file) !== text) await write(file, text)
  return check
}
