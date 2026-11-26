import { createHash, randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { status, type MethodDefinition, type ServerDuplexStream } from '@grpc/grpc-js'

import {
  AgentHomeFrameSchema,
  AgentHomeHelloSchema,
  AgentRunReconcileSchema,
  AgentRunBytesSchema,
  AgentRunOutcome,
  AgentRunStartSchema,
  AgentRunStopSchema,
  AgentPreviewOpenSchema,
  AgentSnapshotRequestSchema,
  AgentWorkerFrameSchema,
  AgentWorkerHeartbeatSchema,
  type AgentWorkerCapacity,
  AgentWorkspaceSetupSchema,
  WorkerControlService,
  type AgentHomeFrame,
  type AgentRunExit,
  type AgentWorkerCapability,
  type AgentWorkerReadiness,
  type AgentWorkspaceSetupResult,
} from './gen/althar/worker/v1/control_pb.ts'
import { validWorkerProtocolId, WORKER_PROTOCOL_VERSION } from './handshake.ts'
import { MAX_WORKER_BUNDLE_BYTES, gitObjectId as objectId, sourceOf, validCheckout, type WorkerCheckout } from './agentCheckout.ts'
import { makeWorkerFiles, type WorkerFile } from './agentFiles.ts'
import { makeManagedCommands, type WorkerHelperRequest, type WorkerManagedCommand, type WorkerManagedProcess } from './agentManaged.ts'
import { makePreviewTunnels } from './agentPreviews.ts'
import { workerSkillBundle, type WorkerSkillFile } from './agentSkillFiles.ts'
import { deferred, type Deferred } from './deferred.ts'

export type { WorkerFile } from './agentFiles.ts'
export type { WorkerManagedCommand, WorkerManagedProcess } from './agentManaged.ts'
export { MAX_WORKER_SKILL_BYTES, MAX_WORKER_SKILL_FILES, type WorkerSkillFile } from './agentSkillFiles.ts'

export const MAX_AGENT_CHUNK = 2_048
export const AGENT_WORKER_LEASE_MS = 8_000
const MAX_CAPABILITIES = 32
const MAX_BUFFERED_BYTES = 64 * 1024
const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 6_000
const CHECKOUT_TIMEOUT_MS = 180_000
const SNAPSHOT_TIMEOUT_MS = 60_000
const MAX_PATCH_BYTES = 16 * 1024 * 1024
const MAX_COMMIT_BUNDLE_BYTES = 64 * 1024 * 1024
const MAX_SETUP_BYTES = 128 * 1024
const SETUP_TIMEOUT_MS = 10 * 60_000 + START_TIMEOUT_MS
export { MAX_WORKER_BUNDLE_BYTES, type WorkerCheckout } from './agentCheckout.ts'
const PROVIDER_ID = /^[a-z][a-z0-9-]{0,47}$/
const MCP_COMMAND_NAME = /^[a-zA-Z0-9_.-]{1,64}$/
const MAX_MCP_COMMANDS = 16

const identity = (value: Buffer): Buffer => value
export const runAgentMethod: MethodDefinition<Buffer, Buffer> = {
  path: `/${WorkerControlService.typeName}/${WorkerControlService.method.runAgent.name}`,
  requestStream: true,
  responseStream: true,
  requestSerialize: identity,
  requestDeserialize: identity,
  responseSerialize: identity,
  responseDeserialize: identity,
}

export interface AgentPlacement {
  readonly projectId: string
  readonly providerId: string
  readonly workspaceId: string
}

export interface AgentRunAssignment extends AgentPlacement {
  readonly runId: string
}

interface AgentRunOptions {
  readonly signal?: AbortSignal
  readonly checkout?: WorkerCheckout
  readonly toolPort?: number
  readonly setup?: WorkerSetup
  readonly repositories?: ReadonlyArray<WorkerRepository>
  readonly skills?: ReadonlyArray<WorkerSkillFile>
}

export interface WorkerSetupCommands {
  readonly directory: string
  readonly commands: ReadonlyArray<string>
}

/** A program on a worker's PATH, or one a run asks it to install first: `bun`, `node`, `pnpm` or `uv`, at a version or `latest`. */
export interface WorkerTool {
  readonly name: string
  readonly version: string
}

export type WorkerSetup = (
  | WorkerSetupCommands
  | { readonly repositories: ReadonlyArray<WorkerSetupCommands & { readonly workspaceId: string }> }
) & {
  /** What the worker installs into its own folder, without root, before the commands run. */
  readonly tools?: ReadonlyArray<WorkerTool>
}

/**
 * What a worker's own check found (`althar-host worker check`): whether Claude Code's sandbox starts there, and where not
 * why (`NoUserNamespaces`, `NoBubblewrap`, `NoSocat`, `Failed`) with the command an administrator runs to let it; the
 * tools on its PATH; and the models each of its signed-in agents offers.
 */
export interface WorkerReadiness {
  readonly sandbox: { readonly starts: true } | { readonly starts: false; readonly problem: string; readonly fix?: string }
  readonly tools: ReadonlyArray<WorkerTool>
  readonly models: ReadonlyArray<{
    readonly providerId: string
    readonly models: ReadonlyArray<{ readonly id: string; readonly name: string }>
  }>
  /** Each signed-in agent, started once as a run starts it: whether it did, and where not, why. */
  readonly agents: ReadonlyArray<{ readonly providerId: string; readonly starts: boolean; readonly problem?: string }>
}

const SANDBOX_PROBLEMS = new Set(['NoUserNamespaces', 'NoBubblewrap', 'NoSocat', 'Failed'])
const TOOL_NAME = /^[a-z0-9][a-z0-9._+-]{0,47}$/u
const TOOL_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u
// eslint-disable-next-line no-control-regex -- A name a worker reports is shown: no control characters.
const SHOWN = /^[^\x00-\x1f\x7f]{1,200}$/u
// eslint-disable-next-line no-control-regex -- Why an agent couldn't start is shown, on one line.
const SHOWN_LONG = /^[^\x00-\x1f\x7f]{1,400}$/u
// eslint-disable-next-line no-control-regex -- The command is shown to copy, on one line.
const FIX = /^[^\x00-\x1f\x7f]{1,4096}$/u

/** A worker's check as it reported it, kept to what can be shown and trusted. */
export const readinessOf = (reported: AgentWorkerReadiness): WorkerReadiness => {
  const problem = SANDBOX_PROBLEMS.has(reported.sandboxProblem) ? reported.sandboxProblem : 'Failed'
  const fix = FIX.test(reported.sandboxFix)
  return {
    sandbox: reported.sandboxStarts ? { starts: true } : { starts: false, problem, ...(fix ? { fix: reported.sandboxFix } : {}) },
    tools: reported.tools
      .filter((tool) => TOOL_NAME.test(tool.name) && TOOL_VERSION.test(tool.version))
      .slice(0, 64)
      .map(({ name, version }) => ({ name, version })),
    models: reported.models
      .filter((entry) => PROVIDER_ID.test(entry.providerId))
      .slice(0, MAX_CAPABILITIES)
      .map((entry) => ({
        providerId: entry.providerId,
        models: entry.models
          .filter((model) => SHOWN.test(model.id) && SHOWN.test(model.name))
          .slice(0, 96)
          .map(({ id, name }) => ({ id, name })),
      })),
    agents: reported.agents
      .filter((agent) => PROVIDER_ID.test(agent.providerId))
      .slice(0, MAX_CAPABILITIES)
      .map(({ providerId, starts, problem }) => ({
        providerId,
        starts,
        ...(starts || !SHOWN_LONG.test(problem) ? {} : { problem }),
      })),
  }
}

export interface WorkerRepository {
  readonly workspaceId: string
  readonly directory: string
  readonly checkout: WorkerCheckout
}

/** The home records authority before sending a start and clears it only on confirmed exit. */
export interface AgentRunLedger {
  readonly bind: (workerId: string, journalId: string) => boolean
  readonly permits: (workerId: string, projectId: string) => boolean
  readonly permitsRun: (workerId: string, runId: string) => boolean
  readonly outstanding: (workerId: string) => AgentRunAssignment | undefined
  readonly begin: (workerId: string, run: AgentRunAssignment) => boolean
  readonly finish: (workerId: string, result: AgentRunExit) => boolean
}

export interface WorkerPatch {
  readonly tree: string
  readonly head: string
  readonly patch: Uint8Array
  readonly commits: Uint8Array
  readonly index?: { readonly tree: string; readonly patch: Uint8Array }
}

export interface WorkerLocalMcpCommand {
  readonly name: string
  readonly executable: string
}

export interface WorkerAgentProcess {
  readonly workspacePath: string
  readonly toolPort?: number
  readonly setup?: AgentWorkspaceSetupResult
  readonly skillsPath?: string
  readonly localMcp?: ReadonlyArray<WorkerLocalMcpCommand>
  readonly startCommand: (input: WorkerManagedCommand) => Promise<WorkerManagedProcess>
  readonly startHelper?: (input: WorkerHelperRequest) => Promise<WorkerManagedProcess>
  readonly output: PassThrough
  /** Settles only when the worker confirms the outcome or this stream is lost. */
  readonly exit: Promise<AgentRunExit>
  readonly write: (chunk: Uint8Array) => Promise<void>
  readonly stop: () => Promise<AgentRunExit>
  readonly ownsRun: () => boolean
  readonly readFile?: (relativePath: string, workspaceId?: string) => Promise<WorkerFile>
  readonly readPatch: (baseTree: string, baseHead: string, workspaceId?: string, captureIndex?: boolean) => Promise<WorkerPatch>
}

export interface WorkerCapacity {
  readonly platform: 'linux' | 'macos' | 'windows'
  readonly architecture: 'x64' | 'arm64'
  readonly cpuCores: number
  readonly freeMemoryMib: number
  readonly freeDiskMib: number
}

const capacityOf = (reported: AgentWorkerCapacity | undefined): WorkerCapacity | undefined => {
  if (reported === undefined) return undefined
  const { platform, architecture, cpuCores, freeMemoryMib, freeDiskMib } = reported
  if (
    (platform !== 'linux' && platform !== 'macos' && platform !== 'windows') ||
    (architecture !== 'x64' && architecture !== 'arm64') ||
    cpuCores < 1 ||
    cpuCores > 65_535
  )
    return undefined
  return { platform, architecture, cpuCores, freeMemoryMib, freeDiskMib }
}

export interface AvailableAgentWorker {
  readonly workerId: string
  readonly capacity?: WorkerCapacity
  /** Of its providers, those signed in on it, where it says. */
  readonly signedIn?: ReadonlyArray<string>
  /** The Althar release it runs, where it says. */
  readonly release?: string
  /** What its own check found, where it has checked. */
  readonly readiness?: WorkerReadiness
  /** It offers its agents for any project the home grants it. */
  readonly anyProject?: boolean
  readonly capabilities: ReadonlyArray<
    Pick<AgentWorkerCapability, 'projectId' | 'providerId'> & Partial<Pick<AgentWorkerCapability, 'workspaceSets'>>
  >
  readonly busy: boolean
}

interface Slot {
  readonly workerId: string
  /** What it said of itself; who is signed in, again with its heartbeats. */
  said: Pick<AvailableAgentWorker, 'signedIn' | 'release' | 'anyProject' | 'readiness'>
  readonly capacity: () => WorkerCapacity | undefined
  readonly capabilities: ReadonlyArray<AgentWorkerCapability>
  readonly start: (placement: AgentPlacement, options: AgentRunOptions) => Promise<WorkerAgentProcess>
  readonly openTools: (runId: string, invalidate: () => void) => { port: number; active: () => boolean; release: () => void } | undefined
  readonly busy: () => boolean
}

interface SnapshotPart {
  readonly hash: Uint8Array
  readonly bytes: Buffer
  written: number
}

interface PendingSnapshot {
  readonly result: Deferred<WorkerPatch>
  readonly timer: NodeJS.Timeout
  readonly baseHead: string
  readonly baseTree: string
  readonly workspaceId: string
  readonly captureIndex: boolean
  transfer?: { tree: string; head: string; patch: SnapshotPart; commits: SnapshotPart; index?: SnapshotPart & { readonly tree: string } }
}

interface Run {
  readonly id: string
  readonly output: PassThrough
  readonly ready: Deferred<WorkerAgentProcess>
  readonly exit: Deferred<AgentRunExit>
  readonly starting: NodeJS.Timeout
  readonly cleanup: () => void
  readonly toolPort: number | undefined
  readonly requiresSetup: boolean
  readonly requiresSkills: boolean
  readonly workspaceIndex: boolean
  readonly setupRepositories: ReadonlySet<string>
  readonly repositories: ReadonlySet<string>
  readonly managed: ReturnType<typeof makeManagedCommands>
  readonly files: ReturnType<typeof makeWorkerFiles>
  readonly fileReads: boolean
  readonly tunnels: Set<() => void>
  stopping?: NodeJS.Timeout
  snapshot?: PendingSnapshot
  accept?: Deferred<boolean>
  phase: 'starting' | 'running' | 'stopping'
}

const encode = (payload: AgentHomeFrame['payload']): Buffer =>
  Buffer.from(toBinary(AgentHomeFrameSchema, create(AgentHomeFrameSchema, { payload })))

/** A capability for any project the home grants: a worker its home set up offers its agents so, and the grants decide. */
export const ANY_PROJECT = '*'
const covers = (capability: Pick<AgentWorkerCapability, 'projectId'>, projectId: string): boolean =>
  capability.projectId === projectId || capability.projectId === ANY_PROJECT

const supports = (slot: Slot, projectId: string, providerId: string): boolean =>
  slot.capabilities.some((item) => covers(item, projectId) && item.providerId === providerId)

export const MAX_WORKER_REPOSITORIES = 8
export const MAX_WORKER_SET_BYTES = 2 * MAX_WORKER_BUNDLE_BYTES
export const WORKER_REPOSITORY_FOLDER = /^[a-z0-9][a-z0-9._-]{0,63}$/

const validRepositorySet = (entries: ReadonlyArray<WorkerRepository>, primary: string): boolean =>
  entries.length >= 2 &&
  entries.length <= MAX_WORKER_REPOSITORIES &&
  entries.some((entry) => entry.workspaceId === primary) &&
  new Set(entries.map((entry) => entry.workspaceId)).size === entries.length &&
  new Set(entries.map((entry) => entry.directory)).size === entries.length &&
  entries.every(
    (entry) =>
      validWorkerProtocolId(entry.workspaceId, 'ws_') && WORKER_REPOSITORY_FOLDER.test(entry.directory) && validCheckout(entry.checkout),
  ) &&
  entries.reduce((sum, entry) => sum + entry.checkout.size, 0) <= MAX_WORKER_SET_BYTES

const validPath = (path: string): boolean =>
  path.startsWith('/') &&
  path.length <= 1_024 &&
  // eslint-disable-next-line no-control-regex -- Reject control characters in paths reported by a peer.
  !/[\x00-\x1f\x7f]/u.test(path) &&
  path
    .slice(1)
    .split('/')
    .every((part) => part !== '' && part !== '.' && part !== '..')

const validOutcome = (exit: AgentRunExit): boolean =>
  exit.workerBusy
    ? exit.outcome === AgentRunOutcome.START_FAILED && exit.exitCode === undefined
    : exit.outcome === AgentRunOutcome.EXITED
      ? exit.exitCode !== undefined && exit.exitCode <= 255
      : exit.exitCode === undefined &&
        (exit.outcome === AgentRunOutcome.STOPPED ||
          exit.outcome === AgentRunOutcome.START_FAILED ||
          exit.outcome === AgentRunOutcome.UNCONFIRMED)

const validSetupResult = (current: Run, result: AgentWorkspaceSetupResult | undefined): boolean => {
  if (result === undefined) return !current.requiresSetup
  if (!current.requiresSetup) return false
  const readable = (one: { exitCode: number; timedOut: boolean; outputTail: Uint8Array }, maximum: number) =>
    one.exitCode <= 255 && one.outputTail.byteLength <= maximum && (!one.timedOut || one.exitCode !== 0)
  if (current.setupRepositories.size === 0) return result.repositories.length === 0 && readable(result, MAX_AGENT_CHUNK)
  return (
    result.exitCode === 0 &&
    !result.timedOut &&
    result.outputTail.byteLength === 0 &&
    result.repositories.length === current.setupRepositories.size &&
    new Set(result.repositories.map(({ workspaceId }) => workspaceId)).size === result.repositories.length &&
    result.repositories.every((report) => current.setupRepositories.has(report.workspaceId) && readable(report, 192))
  )
}

export type AgentWorkerConnection = 'connected' | 'disconnected'

/** The home routes by a verified certificate and the worker's operator-granted project and provider. */
export const makeAgentWorkerPool = (ledger: AgentRunLedger, connectionChanged?: (outcome: AgentWorkerConnection) => void) => {
  const slots = new Map<string, Slot>()
  const previews = makePreviewTunnels()
  const reportConnection = (outcome: AgentWorkerConnection): void => {
    try {
      connectionChanged?.(outcome)
    } catch {
      // Reporting must never interrupt worker execution or cleanup.
    }
  }

  const connect = (call: ServerDuplexStream<Buffer, Buffer>, homeId: string, enrolledWorker: () => string | undefined): void => {
    let slot: Slot | undefined
    let capacity: WorkerCapacity | undefined
    let sampledAt = 0
    let accountReserved = false
    let reserveBeforeTransfer = false
    let run: Run | undefined
    let recovering: AgentRunAssignment | undefined
    let closed = false
    let sequence = 0
    let timer: NodeJS.Timeout

    const ownsRun = (current: Run): boolean =>
      !closed &&
      run === current &&
      current.phase === 'running' &&
      slot !== undefined &&
      enrolledWorker() === slot.workerId &&
      ledger.permitsRun(slot.workerId, current.id)

    const closeTools = (current: Run): void => {
      for (const invalidate of current.tunnels) invalidate()
      current.tunnels.clear()
    }
    const openTools: Slot['openTools'] = (runId, invalidate) => {
      const current = run
      if (current === undefined || current.id !== runId || !ownsRun(current) || current.toolPort === undefined || current.tunnels.size >= 4)
        return
      current.tunnels.add(invalidate)
      return {
        port: current.toolPort,
        active: () => ownsRun(current),
        release: () => {
          current.tunnels.delete(invalidate)
        },
      }
    }
    const release = (error: Error): void => {
      if (closed) return
      closed = true
      clearTimeout(timer)
      if (slot !== undefined && slots.get(slot.workerId) === slot) {
        slots.delete(slot.workerId)
        reportConnection('disconnected')
      }
      if (run !== undefined) {
        clearTimeout(run.starting)
        clearTimeout(run.stopping)
        run.cleanup()
        closeTools(run)
        run.ready.reject(error)
        run.managed.close(error)
        run.files.close(error)
        interruptSnapshot(run, error)
        run.output.destroy(error)
        run.exit.reject(error)
      }
    }
    const fail = (code: status, message: string): void => {
      if (closed) return
      release(new Error(message))
      call.emit('error', Object.assign(new Error(message), { code }))
    }
    const lost = (): void => release(new Error('The worker connection closed before it confirmed the agent had stopped.'))
    const expired = (): void => fail(status.DEADLINE_EXCEEDED, 'The agent worker lease expired.')
    const renew = (milliseconds: number): void => {
      clearTimeout(timer)
      timer = setTimeout(expired, milliseconds)
      timer.unref()
    }
    const send = (payload: AgentHomeFrame['payload']): Promise<void> =>
      new Promise((resolve, reject) => {
        if (closed) return reject(new Error('The worker connection is closed.'))
        if (call.writableLength > 32) {
          fail(status.RESOURCE_EXHAUSTED, 'The worker is not reading its messages.')
          return reject(new Error('The worker is not reading its messages.'))
        }
        call.write(encode(payload), (error?: Error | null) => (error ? reject(error) : resolve()))
      })
    const sendControl = (payload: AgentHomeFrame['payload']): void => {
      void send(payload).catch(() => fail(status.UNAVAILABLE, 'Could not send an agent frame to the worker.'))
    }
    const stage = async (current: Run, checkout: WorkerCheckout, signal: AbortSignal): Promise<void> => {
      let bytes = 0
      for await (const chunk of checkout.contents(signal)) {
        for (let offset = 0; offset < chunk.byteLength; offset += MAX_AGENT_CHUNK) {
          if (run !== current || current.phase !== 'starting' || signal.aborted) return
          const data = chunk.subarray(offset, offset + MAX_AGENT_CHUNK)
          bytes += data.byteLength
          if (bytes > checkout.size) throw new Error('The prepared workspace exceeded its declared size.')
          await send({ case: 'checkout', value: create(AgentRunBytesSchema, { runId: current.id, data }) })
        }
      }
      if (!signal.aborted && bytes !== checkout.size) throw new Error('The prepared workspace ended early.')
    }
    const interruptSnapshot = (current: Run, error: Error): void => {
      const pending = current.snapshot
      if (pending === undefined) return
      delete current.snapshot
      clearTimeout(pending.timer)
      pending.result.reject(error)
    }
    const readPatch = (current: Run, baseTree: string, baseHead: string, workspaceId = '', captureIndex = false): Promise<WorkerPatch> => {
      if (!ownsRun(current) || current.snapshot !== undefined || !objectId.test(baseTree) || !objectId.test(baseHead))
        return Promise.reject(new Error('The worker cannot check that workspace now.'))
      const leasedHelper = current.managed.ownsCheckout(workspaceId)
      if (!leasedHelper && (current.repositories.size === 0 ? workspaceId !== '' : !current.repositories.has(workspaceId)))
        return Promise.reject(new Error('This run does not own that repository.'))
      const result = deferred<WorkerPatch>()
      const timer = setTimeout(
        () => fail(status.DEADLINE_EXCEEDED, 'The worker did not return its workspace changes.'),
        SNAPSHOT_TIMEOUT_MS,
      )
      timer.unref()
      current.snapshot = { result, timer, baseHead, baseTree, workspaceId, captureIndex }
      sendControl({
        case: 'snapshot',
        value: create(AgentSnapshotRequestSchema, { runId: current.id, baseTree, baseHead, workspaceId, captureIndex }),
      })
      return result.promise
    }
    const finishSnapshot = (current: Run, pending: PendingSnapshot): void => {
      const transfer = pending.transfer
      if (transfer === undefined) return
      const parts = transfer.index === undefined ? [transfer.patch, transfer.commits] : [transfer.patch, transfer.commits, transfer.index]
      if (parts.some((part) => part.written !== part.bytes.length)) return
      if (parts.some((part) => !createHash('sha256').update(part.bytes).digest().equals(part.hash)))
        return fail(status.INVALID_ARGUMENT, 'The worker returned the wrong workspace transfer digest.')
      clearTimeout(pending.timer)
      delete current.snapshot
      pending.result.resolve({
        tree: transfer.tree,
        head: transfer.head,
        patch: transfer.patch.bytes,
        commits: transfer.commits.bytes,
        ...(transfer.index === undefined ? {} : { index: { tree: transfer.index.tree, patch: transfer.index.bytes } }),
      })
    }
    const start: Slot['start'] = (placement, { checkout, repositories, signal, toolPort, setup, skills }) => {
      if (closed || run !== undefined || recovering !== undefined)
        return Promise.reject(new Error('The worker is already running an agent.'))
      if (signal?.aborted === true) return Promise.reject(new Error('The agent start was cancelled.'))
      const group = setup !== undefined && 'repositories' in setup ? setup.repositories : undefined
      if (
        group !== undefined &&
        (group.length === 0 ||
          group.some((entry) => !repositories?.some((one) => one.workspaceId === entry.workspaceId)) ||
          new Set(group.map((entry) => entry.workspaceId)).size !== group.length)
      )
        return Promise.reject(new Error('The worker setup does not match its task repositories.'))
      const plan =
        setup === undefined
          ? undefined
          : toBinary(
              AgentWorkspaceSetupSchema,
              create(
                AgentWorkspaceSetupSchema,
                'repositories' in setup
                  ? {
                      repositories: setup.repositories.map((one) => ({ ...one, commands: [...one.commands] })),
                      tools: [...(setup.tools ?? [])],
                    }
                  : { directory: setup.directory, commands: [...setup.commands], tools: [...(setup.tools ?? [])] },
              ),
            )
      if (plan !== undefined && (plan.byteLength === 0 || plan.byteLength > MAX_SETUP_BYTES))
        return Promise.reject(new Error('The project setup is too large for the worker.'))
      const assets = skills === undefined ? undefined : workerSkillBundle(skills)
      const id = `war_${randomUUID().replaceAll('-', '')}`
      if (slot === undefined || !ledger.begin(slot.workerId, { ...placement, runId: id }))
        return Promise.reject(new Error('A previous run still owns this worker or workspace.'))
      const output = new PassThrough({ highWaterMark: MAX_BUFFERED_BYTES })
      // A disconnect can arrive before a consumer has attached to either result.
      output.on('error', () => undefined)
      const exit = deferred<AgentRunExit>()
      void exit.promise.catch(() => undefined)
      const starting = setTimeout(
        () => fail(status.DEADLINE_EXCEEDED, 'The worker did not start the agent in time.'),
        (checkout === undefined && repositories === undefined && assets === undefined ? START_TIMEOUT_MS : CHECKOUT_TIMEOUT_MS) +
          (plan === undefined ? 0 : SETUP_TIMEOUT_MS),
      )
      starting.unref()
      const transfer = new AbortController()
      const accept = reserveBeforeTransfer ? deferred<boolean>() : undefined
      const abort = (): void => {
        if (run?.id !== id) return
        run.ready.reject(new Error('The agent start was cancelled.'))
        void stop(run).catch(() => undefined)
      }
      const cleanup = (): void => {
        signal?.removeEventListener('abort', abort)
        transfer.abort()
        accept?.resolve(false)
      }
      const capability = slot.capabilities.find((cap) => covers(cap, placement.projectId) && cap.providerId === placement.providerId)
      const workerId = slot.workerId
      const managed = makeManagedCommands(
        id,
        capability?.managedCommands === true,
        () => run?.id === id && ownsRun(run),
        send,
        (message) => fail(status.INVALID_ARGUMENT, message),
        (providerId, withSkills, withCheckout) => {
          const cap = slot?.capabilities.find((each) => covers(each, placement.projectId) && each.providerId === providerId)
          if (cap === undefined) return 'agent'
          // What it lacks is what a newer worker reports it can do.
          return cap.helperAgents && (!withSkills || cap.helperSkillFiles) && (!withCheckout || cap.helperCheckouts) ? undefined : 'update'
        },
        capability?.managedPreview === true
          ? {
              open: (commandId, port, active, signal) =>
                previews.open(
                  workerId,
                  commandId,
                  active,
                  (tunnelId) => {
                    sendControl({
                      case: 'previewOpen',
                      value: create(AgentPreviewOpenSchema, { tunnelId, port, managed: { runId: id, commandId } }),
                    })
                  },
                  signal,
                ),
              close: (commandId) => previews.close(workerId, commandId),
            }
          : undefined,
      )
      const files = makeWorkerFiles(
        id,
        () => run?.id === id && ownsRun(run),
        sendControl,
        (message) => fail(status.INVALID_ARGUMENT, message),
      )
      run = {
        id,
        starting,
        output,
        ready: deferred<WorkerAgentProcess>(),
        exit,
        cleanup,
        toolPort,
        requiresSetup: plan !== undefined,
        requiresSkills: assets !== undefined,
        workspaceIndex: capability?.workspaceIndex === true,
        setupRepositories: new Set(group?.map((entry) => entry.workspaceId)),
        repositories: new Set(repositories?.map((entry) => entry.workspaceId)),
        managed,
        files,
        fileReads: capability?.fileReads === true,
        tunnels: new Set(),
        phase: 'starting',
        ...(accept === undefined ? {} : { accept }),
      }
      signal?.addEventListener('abort', abort, { once: true })
      const current = run
      const source = checkout === undefined ? undefined : sourceOf(checkout)
      const entries = repositories?.map((one) => ({
        workspaceId: one.workspaceId,
        directory: one.directory,
        source: sourceOf(one.checkout),
      }))
      void send({
        case: 'start',
        value: create(AgentRunStartSchema, {
          ...placement,
          runId: id,
          tools: toolPort !== undefined,
          ...(source === undefined ? {} : { source }),
          ...(entries === undefined ? {} : { repositories: entries }),
          ...(plan === undefined ? {} : { setup: { size: plan.byteLength, sha256: createHash('sha256').update(plan).digest() } }),
          ...(assets === undefined ? {} : { skills: { size: assets.byteLength, sha256: createHash('sha256').update(assets).digest() } }),
        }),
      })
        .then(async () => {
          if (accept !== undefined && !(await accept.promise)) return
          for (const [kind, descriptor] of [
            ['setupChunk', plan],
            ['skillsChunk', assets],
          ] as const) {
            if (descriptor === undefined) continue
            for (let offset = 0; offset < descriptor.byteLength; offset += MAX_AGENT_CHUNK) {
              if (run !== current || current.phase !== 'starting' || transfer.signal.aborted) return
              const data = descriptor.subarray(offset, offset + MAX_AGENT_CHUNK)
              await send({ case: kind, value: create(AgentRunBytesSchema, { runId: current.id, data }) })
            }
          }
          if (checkout !== undefined) await stage(current, checkout, transfer.signal)
          for (const one of repositories ?? []) await stage(current, one.checkout, transfer.signal)
        })
        .catch(() => {
          if (!transfer.signal.aborted) fail(status.UNAVAILABLE, 'Could not send the project workspace to the worker.')
        })
      return current.ready.promise
    }
    const write = async (current: Run, bytes: Uint8Array): Promise<void> => {
      for (let offset = 0; offset < bytes.byteLength; offset += MAX_AGENT_CHUNK) {
        if (!ownsRun(current)) throw new Error('The worker agent no longer owns this run.')
        const data = bytes.subarray(offset, offset + MAX_AGENT_CHUNK)
        await send({ case: 'input', value: create(AgentRunBytesSchema, { runId: current.id, data }) })
      }
    }
    const stop = (current: Run): Promise<AgentRunExit> => {
      if (run === current && current.phase !== 'stopping') {
        current.phase = 'stopping'
        closeTools(current)
        current.files.close(new Error('The worker workspace is stopping.'))
        current.managed.close(new Error('The worker workspace is stopping.'))
        current.cleanup()
        clearTimeout(current.starting)
        current.stopping = setTimeout(
          () => fail(status.DEADLINE_EXCEEDED, 'The worker did not confirm that the agent stopped.'),
          STOP_TIMEOUT_MS,
        )
        current.stopping.unref()
        // An unread provider stream may have paused this call. Stop and its
        // confirmation must still get through after the provider is released.
        call.resume()
        sendControl({ case: 'stop', value: create(AgentRunStopSchema, { runId: current.id }) })
      }
      return current.exit.promise
    }

    renew(5_000)
    call.once('cancelled', lost)
    call.once('close', lost)
    call.once('error', lost)
    call.once('end', () => fail(status.CANCELLED, 'The worker closed its agent stream.'))
    call.on('data', (bytes: Buffer) => {
      if (closed) return
      const workerId = enrolledWorker()
      if (workerId === undefined || (slot !== undefined && slot.workerId !== workerId))
        return fail(status.UNAUTHENTICATED, 'The worker certificate is not enrolled.')
      try {
        const { payload } = fromBinary(AgentWorkerFrameSchema, bytes, { readUnknownFields: false })
        if (slot === undefined) {
          if (payload.case !== 'hello' || payload.value.workerId !== workerId || payload.value.version !== WORKER_PROTOCOL_VERSION)
            return fail(status.PERMISSION_DENIED, 'The worker identity or protocol version did not match.')
          const { capabilities } = payload.value
          const distinct = new Set(capabilities.map(({ projectId, providerId }) => `${projectId}/${providerId}`))
          if (
            !validWorkerProtocolId(workerId, 'wrk_') ||
            capabilities.length === 0 ||
            capabilities.length > MAX_CAPABILITIES ||
            distinct.size !== capabilities.length ||
            capabilities.some(
              ({ projectId, providerId }) =>
                !(validWorkerProtocolId(projectId, 'proj_') || (payload.value.anyProject && projectId === ANY_PROJECT)) ||
                !PROVIDER_ID.test(providerId),
            ) ||
            payload.value.signedIn.length > MAX_CAPABILITIES ||
            payload.value.signedIn.some((providerId) => !PROVIDER_ID.test(providerId)) ||
            payload.value.release.length > 64
          )
            return fail(status.INVALID_ARGUMENT, 'The worker sent invalid agent capabilities.')
          if (slots.has(workerId)) return fail(status.ALREADY_EXISTS, 'This worker already has an agent stream.')
          if (!validWorkerProtocolId(payload.value.journalId, 'wjn_') || !ledger.bind(workerId, payload.value.journalId))
            return fail(status.PERMISSION_DENIED, 'The worker does not have its enrolled execution journal.')
          recovering = ledger.outstanding(workerId)
          capacity = capacityOf(payload.value.capacity)
          accountReserved = payload.value.capacity?.accountReserved ?? false
          reserveBeforeTransfer = payload.value.reserveBeforeTransfer
          sampledAt = performance.now()
          const hello = payload.value
          slot = {
            workerId,
            said: {
              ...(hello.reportsSignIn ? { signedIn: [...new Set(hello.signedIn)] } : {}),
              ...(hello.release === '' ? {} : { release: hello.release }),
              ...(hello.anyProject ? { anyProject: true } : {}),
              ...(hello.readiness === undefined ? {} : { readiness: readinessOf(hello.readiness) }),
            },
            capabilities,
            start,
            openTools,
            busy: () =>
              run !== undefined || recovering !== undefined || (accountReserved && performance.now() - sampledAt <= AGENT_WORKER_LEASE_MS),
            capacity: () => (performance.now() - sampledAt > AGENT_WORKER_LEASE_MS ? undefined : capacity),
          }
          slots.set(workerId, slot)
          renew(AGENT_WORKER_LEASE_MS)
          reportConnection('connected')
          sendControl({
            case: 'hello',
            value: create(AgentHomeHelloSchema, {
              homeId,
              workerId,
              version: WORKER_PROTOCOL_VERSION,
              leaseMs: AGENT_WORKER_LEASE_MS,
              reserveBeforeTransfer,
            }),
          })
          if (recovering !== undefined) sendControl({ case: 'reconcile', value: create(AgentRunReconcileSchema, recovering) })
          return
        }
        // A project grant can end independently of the worker certificate. Let the same
        // stream confirm stop, while rejecting any further effect from its withdrawn run.
        if (run !== undefined && !ledger.permitsRun(workerId, run.id)) {
          void stop(run).catch(() => undefined)
          if (payload.case !== 'heartbeat' && payload.case !== 'exit') return
        }
        if (payload.case === 'heartbeat') {
          if (payload.value.sequence !== sequence + 1) return fail(status.INVALID_ARGUMENT, 'The worker heartbeat was out of order.')
          sequence = payload.value.sequence
          if (payload.value.reportsSignIn && payload.value.signedIn.every((providerId) => PROVIDER_ID.test(providerId)))
            slot.said = { ...slot.said, signedIn: [...new Set(payload.value.signedIn)].slice(0, MAX_CAPABILITIES) }
          if (payload.value.readiness !== undefined) slot.said = { ...slot.said, readiness: readinessOf(payload.value.readiness) }
          if (payload.value.capacity !== undefined) {
            capacity = capacityOf(payload.value.capacity)
            accountReserved = payload.value.capacity.accountReserved
            sampledAt = performance.now()
          }
          renew(AGENT_WORKER_LEASE_MS)
          sendControl({ case: 'heartbeat', value: create(AgentWorkerHeartbeatSchema, { sequence }) })
          return
        }
        if (recovering !== undefined) {
          if (payload.case !== 'exit' || payload.value.runId !== recovering.runId || !validOutcome(payload.value))
            return fail(status.PERMISSION_DENIED, 'The worker has not reconciled its previous agent run.')
          if (payload.value.outcome === AgentRunOutcome.UNCONFIRMED)
            return fail(status.FAILED_PRECONDITION, 'The previous agent run has not stopped.')
          if (!ledger.finish(workerId, payload.value))
            return fail(status.FAILED_PRECONDITION, 'The previous agent run is no longer current.')
          recovering = undefined
          lost()
          call.end()
          return
        }
        const current = run
        if (payload.case === 'fileResult' || payload.case === 'fileChunk') {
          if (current === undefined || !current.fileReads)
            return fail(status.PERMISSION_DENIED, 'There is no active workspace for this file.')
          if (current.phase !== 'stopping') current.files.receive(payload)
          return
        }
        if (payload.case === 'managedReady' || payload.case === 'managedOutput' || payload.case === 'managedExit') {
          if (current === undefined) return fail(status.PERMISSION_DENIED, 'There is no active worker workspace for this command.')
          if (current.phase !== 'stopping') current.managed.receive(payload)
          return
        }
        if (
          current === undefined ||
          (payload.case !== 'accepted' &&
            payload.case !== 'ready' &&
            payload.case !== 'output' &&
            payload.case !== 'exit' &&
            payload.case !== 'snapshot' &&
            payload.case !== 'patch' &&
            payload.case !== 'indexPatch' &&
            payload.case !== 'commits') ||
          payload.value.runId !== current.id
        )
          return fail(status.PERMISSION_DENIED, 'This stream does not own that agent run.')
        if (payload.case === 'accepted') {
          if (current.phase === 'stopping') return
          if (current.phase !== 'starting' || current.accept === undefined)
            return fail(status.INVALID_ARGUMENT, 'The worker sent an unexpected run reservation.')
          current.accept.resolve(true)
          delete current.accept
          return
        }
        if (payload.case === 'ready') {
          if (current.phase === 'stopping' && validPath(payload.value.workspacePath)) return
          const hasPort = payload.value.toolsPort > 0 && payload.value.toolsPort <= 65_535
          const { setup, skillsPath, workspacePath, mcpCommands } = payload.value
          const names = new Set(mcpCommands.map(({ name }) => name))
          const invalidMcp = mcpCommands.some(
            ({ name, executable }) =>
              !MCP_COMMAND_NAME.test(name) ||
              !validPath(executable) ||
              /\p{Cc}/u.test(executable) ||
              executable === workspacePath ||
              executable.startsWith(workspacePath + '/'),
          )
          const expectedSkills = workspacePath.slice(0, workspacePath.lastIndexOf('/')) + `/.${current.id}.skills`
          if (
            current.phase !== 'starting' ||
            current.accept !== undefined ||
            !validPath(workspacePath) ||
            !validSetupResult(current, setup) ||
            invalidMcp ||
            names.size > MAX_MCP_COMMANDS ||
            names.size !== mcpCommands.length ||
            (current.requiresSkills ? skillsPath !== expectedSkills : skillsPath !== '') ||
            (current.toolPort === undefined ? payload.value.toolsPort !== 0 : !hasPort)
          )
            return fail(status.INVALID_ARGUMENT, 'The worker sent invalid agent readiness.')
          clearTimeout(current.starting)
          current.cleanup()
          current.phase = 'running'
          current.ready.resolve({
            workspacePath: payload.value.workspacePath,
            ...(hasPort ? { toolPort: payload.value.toolsPort } : {}),
            ...(setup === undefined ? {} : { setup }),
            ...(skillsPath === '' ? {} : { skillsPath }),
            ...(mcpCommands.length === 0 ? {} : { localMcp: mcpCommands.map(({ name, executable }) => ({ name, executable })) }),
            startCommand: current.managed.start,
            startHelper: async (requested) => {
              const process = await current.managed.start(requested)
              if (requested.skills === undefined && requested.checkout === undefined) return process
              const folder = workspacePath.slice(0, workspacePath.lastIndexOf('/'))
              const scope = `${current.id}-${requested.id}`
              return {
                ...process,
                ...(requested.skills === undefined ? {} : { skillsPath: `${folder}/.${scope}.skills` }),
                ...(requested.checkout === undefined ? {} : { checkoutPath: `${folder}/${scope}` }),
              }
            },
            output: current.output,
            exit: current.exit.promise,
            write: (chunk) => write(current, chunk),
            stop: () => stop(current),
            ownsRun: () => ownsRun(current),
            ...(current.fileReads
              ? {
                  readFile: (path: string, workspaceId = '') => {
                    if (current.repositories.size === 0 ? workspaceId !== '' : !current.repositories.has(workspaceId))
                      return Promise.reject(new Error('This run does not own that repository.'))
                    return current.files.read(workspaceId, path)
                  },
                }
              : {}),
            readPatch: (baseTree, baseHead, workspaceId, captureIndex) => {
              if (captureIndex && !current.workspaceIndex) return Promise.reject(new Error('Update this worker to copy its staged files.'))
              return readPatch(current, baseTree, baseHead, workspaceId, captureIndex)
            },
          })
          return
        }
        if (payload.case === 'output') {
          const { data } = payload.value
          if (current.phase === 'starting' || data.byteLength === 0 || data.byteLength > MAX_AGENT_CHUNK)
            return fail(status.INVALID_ARGUMENT, 'The worker sent invalid agent output.')
          if (current.phase === 'stopping') return
          if (!current.output.write(data)) {
            call.pause()
            current.output.once('drain', () => {
              if (!closed) call.resume()
            })
          }
          return
        }
        if (payload.case === 'snapshot' || payload.case === 'patch' || payload.case === 'commits' || payload.case === 'indexPatch') {
          const pending = current.snapshot
          if (pending === undefined) return fail(status.FAILED_PRECONDITION, 'There is no request for workspace changes.')
          if (payload.case === 'snapshot') {
            const { size, sha256, tree, head, commitsSize, commitsSha256, unavailable, index } = payload.value
            if (pending.transfer !== undefined) return fail(status.INVALID_ARGUMENT, 'The worker already sent its patch metadata.')
            if (payload.value.workspaceId !== pending.workspaceId)
              return fail(status.INVALID_ARGUMENT, 'The worker returned changes for a different repository.')
            if (unavailable) return interruptSnapshot(current, new Error('The worker could not read its workspace changes.'))
            if (
              size > MAX_PATCH_BYTES ||
              commitsSize > MAX_COMMIT_BUNDLE_BYTES ||
              !objectId.test(tree) ||
              !objectId.test(head) ||
              sha256.byteLength !== 32 ||
              commitsSha256.byteLength !== 32 ||
              (head === pending.baseHead) !== (commitsSize === 0) ||
              pending.captureIndex !== (index !== undefined) ||
              (index !== undefined &&
                (!objectId.test(index.tree) ||
                  index.tree.length !== pending.baseTree.length ||
                  index.size > MAX_PATCH_BYTES ||
                  index.sha256.byteLength !== 32 ||
                  (index.tree === pending.baseTree) !== (index.size === 0)))
            )
              return fail(status.INVALID_ARGUMENT, 'The worker sent invalid workspace transfer metadata.')
            pending.transfer = {
              tree,
              head,
              patch: { bytes: Buffer.alloc(size), hash: sha256, written: 0 },
              commits: { bytes: Buffer.alloc(commitsSize), hash: commitsSha256, written: 0 },
              ...(index === undefined
                ? {}
                : { index: { tree: index.tree, bytes: Buffer.alloc(index.size), hash: index.sha256, written: 0 } }),
            }
            finishSnapshot(current, pending)
            return
          }
          const part =
            payload.case === 'patch'
              ? pending.transfer?.patch
              : payload.case === 'indexPatch'
                ? pending.transfer?.index
                : pending.transfer?.commits
          const { data } = payload.value
          if (
            part === undefined ||
            data.byteLength === 0 ||
            data.byteLength > MAX_AGENT_CHUNK ||
            part.written + data.byteLength > part.bytes.length
          )
            return fail(status.INVALID_ARGUMENT, 'The worker sent invalid workspace transfer bytes.')
          part.bytes.set(data, part.written)
          part.written += data.byteLength
          finishSnapshot(current, pending)
          return
        }
        if (!validOutcome(payload.value)) return fail(status.INVALID_ARGUMENT, 'The worker sent an invalid agent outcome.')
        if (payload.value.outcome !== AgentRunOutcome.UNCONFIRMED && !ledger.finish(workerId, payload.value))
          return fail(status.FAILED_PRECONDITION, 'The agent run is no longer current.')
        clearTimeout(current.starting)
        clearTimeout(current.stopping)
        current.cleanup()
        current.ready.reject(
          new Error(
            payload.value.workerBusy
              ? 'This worker account is busy. Wait for its current task to finish.'
              : 'The worker could not start the agent. Check the worker log and provider setup.',
          ),
        )
        current.files.close(new Error('The worker workspace ended.'))
        current.managed.close(new Error('The worker workspace ended.'))
        closeTools(current)
        interruptSnapshot(current, new Error('The agent ended before its changes were received.'))
        current.output.end()
        current.exit.resolve(payload.value)
        run = undefined
        lost()
        call.end()
      } catch {
        fail(status.INVALID_ARGUMENT, 'The worker sent an invalid agent frame.')
      }
    })
  }

  return {
    connect,
    connectPreview: previews.connect,
    list: (projectId: string): ReadonlyArray<AvailableAgentWorker> =>
      [...slots.values()]
        .filter(({ workerId }) => ledger.permits(workerId, projectId))
        .map(({ workerId, capabilities, busy, capacity, said }) => {
          const reported = capacity()
          return {
            workerId,
            ...(said.signedIn === undefined ? {} : { signedIn: said.signedIn }),
            ...(said.readiness === undefined ? {} : { readiness: said.readiness }),
            // One for any project is, here, for this one.
            capabilities: capabilities.filter((item) => covers(item, projectId)).map((item) => ({ ...item, projectId })),
            busy: busy(),
            ...(reported === undefined ? {} : { capacity: reported }),
          }
        })
        .filter((item) => item.capabilities.length > 0),
    /** Every worker connected now, whatever it may work on: for the home's own list of its workers, not for placing work. */
    connected: (): ReadonlyArray<AvailableAgentWorker> =>
      [...slots.values()].map(({ workerId, capabilities, busy, capacity, said }) => {
        const reported = capacity()
        return {
          workerId,
          ...said,
          capabilities: capabilities.map(({ projectId, providerId }) => ({ projectId, providerId })),
          busy: busy(),
          ...(reported === undefined ? {} : { capacity: reported }),
        }
      }),
    openTools: (workerId: string, runId: string, invalidate: () => void) => slots.get(workerId)?.openTools(runId, invalidate),
    start: async (workerId: string, placement: AgentPlacement, options: AgentRunOptions = {}): Promise<WorkerAgentProcess> => {
      const { checkout, repositories, toolPort, skills } = options
      if (toolPort !== undefined && (!Number.isInteger(toolPort) || toolPort < 1 || toolPort > 65_535))
        throw new Error('The worker needs a valid local tool server port.')
      const slot = slots.get(workerId)
      if (
        slot === undefined ||
        !ledger.permits(workerId, placement.projectId) ||
        !supports(slot, placement.projectId, placement.providerId)
      )
        return Promise.reject(new Error('This worker is unavailable for that project and provider.'))
      if (!validWorkerProtocolId(placement.workspaceId, 'ws_')) return Promise.reject(new Error('The worker needs a valid workspace ID.'))
      if (checkout !== undefined && !validCheckout(checkout)) throw new Error('The worker needs a valid, bounded Git bundle.')
      if (repositories !== undefined) {
        if (checkout !== undefined || !validRepositorySet(repositories, placement.workspaceId))
          throw new Error('The worker needs a valid, bounded set of Git repositories.')
        if (
          !slot.capabilities.some((cap) => covers(cap, placement.projectId) && cap.providerId === placement.providerId && cap.workspaceSets)
        )
          throw new Error('Update this worker to run a task with several repositories.')
      }
      if (skills !== undefined) {
        if (!slot.capabilities.some((cap) => covers(cap, placement.projectId) && cap.providerId === placement.providerId && cap.skillFiles))
          throw new Error('Update this worker to load the selected skills.')
      }
      if (
        options.setup !== undefined &&
        !slot.capabilities.some(
          (entry) => covers(entry, placement.projectId) && entry.providerId === placement.providerId && entry.workspaceSetup,
        )
      )
        throw new Error('Update this worker to run the project’s setup in its task checkout.')
      return slot.start(placement, options)
    },
  }
}

export type AgentWorkerPool = ReturnType<typeof makeAgentWorkerPool>
