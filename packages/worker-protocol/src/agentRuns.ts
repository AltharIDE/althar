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
  AgentSnapshotRequestSchema,
  AgentWorkerFrameSchema,
  WorkerControlService,
  type AgentHomeFrame,
  type AgentRunExit,
  type AgentWorkerCapability,
} from './gen/althar/worker/v1/control_pb.ts'
import { validWorkerProtocolId, WORKER_PROTOCOL_VERSION } from './handshake.ts'

export const MAX_AGENT_CHUNK = 2_048
export const AGENT_WORKER_LEASE_MS = 8_000
const MAX_CAPABILITIES = 32
const MAX_BUFFERED_BYTES = 64 * 1024
const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 6_000
const CHECKOUT_TIMEOUT_MS = 180_000
const SNAPSHOT_TIMEOUT_MS = 60_000
const MAX_PATCH_BYTES = 16 * 1024 * 1024
export const MAX_WORKER_BUNDLE_BYTES = 128 * 1024 * 1024
const PROVIDER_ID = /^[a-z][a-z0-9-]{0,47}$/

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
}

export interface WorkerCheckout {
  readonly size: number
  readonly sha256: Uint8Array
  readonly head: string
  readonly contents: (signal: AbortSignal) => AsyncIterable<Uint8Array>
}

/** The home records authority before sending a start and clears it only on confirmed exit. */
export interface AgentRunLedger {
  readonly bind: (workerId: string, journalId: string) => boolean
  readonly outstanding: (workerId: string) => AgentRunAssignment | undefined
  readonly begin: (workerId: string, run: AgentRunAssignment) => boolean
  readonly finish: (workerId: string, result: AgentRunExit) => boolean
}

export interface WorkerPatch {
  readonly tree: string
  readonly patch: Uint8Array
}

export interface WorkerAgentProcess {
  readonly workspacePath: string
  readonly toolPort?: number
  readonly output: PassThrough
  /** Settles only when the worker confirms the outcome or this stream is lost. */
  readonly exit: Promise<AgentRunExit>
  readonly write: (chunk: Uint8Array) => Promise<void>
  readonly stop: () => Promise<AgentRunExit>
  readonly readPatch: (baseTree: string) => Promise<WorkerPatch>
}

export interface AvailableAgentWorker {
  readonly workerId: string
  readonly capabilities: ReadonlyArray<Pick<AgentWorkerCapability, 'projectId' | 'providerId'>>
  readonly busy: boolean
}

interface Slot {
  readonly workerId: string
  readonly capabilities: ReadonlyArray<AgentWorkerCapability>
  readonly start: (placement: AgentPlacement, options: AgentRunOptions) => Promise<WorkerAgentProcess>
  readonly openTools: (runId: string, invalidate: () => void) => { port: number; release: () => void } | undefined
  readonly busy: () => boolean
}

interface Deferred<A> {
  readonly promise: Promise<A>
  readonly resolve: (value: A) => void
  readonly reject: (error: Error) => void
}

const deferred = <A>(): Deferred<A> => {
  let resolve!: Deferred<A>['resolve']
  let reject!: Deferred<A>['reject']
  const promise = new Promise<A>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

interface PendingSnapshot {
  readonly result: Deferred<WorkerPatch>
  readonly timer: NodeJS.Timeout
  transfer?: { tree: string; hash: Uint8Array; patch: Buffer; written: number }
}

interface Run {
  readonly id: string
  readonly output: PassThrough
  readonly ready: Deferred<WorkerAgentProcess>
  readonly exit: Deferred<AgentRunExit>
  readonly starting: NodeJS.Timeout
  readonly cleanup: () => void
  readonly toolPort: number | undefined
  readonly tunnels: Set<() => void>
  stopping?: NodeJS.Timeout
  snapshot?: PendingSnapshot
  phase: 'starting' | 'running' | 'stopping'
}

const encode = (payload: AgentHomeFrame['payload']): Buffer =>
  Buffer.from(toBinary(AgentHomeFrameSchema, create(AgentHomeFrameSchema, { payload })))

const supports = (slot: Slot, projectId: string, providerId: string): boolean =>
  slot.capabilities.some((item) => item.projectId === projectId && item.providerId === providerId)

const objectId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

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
  exit.outcome === AgentRunOutcome.EXITED
    ? exit.exitCode !== undefined && exit.exitCode <= 255
    : exit.exitCode === undefined &&
      (exit.outcome === AgentRunOutcome.STOPPED ||
        exit.outcome === AgentRunOutcome.START_FAILED ||
        exit.outcome === AgentRunOutcome.UNCONFIRMED)

/** The home routes by a verified certificate and the worker's operator-granted project and provider. */
export const makeAgentWorkerPool = (ledger: AgentRunLedger) => {
  const slots = new Map<string, Slot>()

  const connect = (call: ServerDuplexStream<Buffer, Buffer>, homeId: string, enrolledWorker: () => string | undefined): void => {
    let slot: Slot | undefined
    let run: Run | undefined
    let recovering: AgentRunAssignment | undefined
    let closed = false
    let sequence = 0
    let timer: NodeJS.Timeout

    const closeTools = (current: Run): void => {
      for (const invalidate of current.tunnels) invalidate()
      current.tunnels.clear()
    }
    const openTools: Slot['openTools'] = (runId, invalidate) => {
      const current = run
      if (
        closed ||
        current === undefined ||
        current.id !== runId ||
        current.phase !== 'running' ||
        current.toolPort === undefined ||
        current.tunnels.size >= 4
      )
        return
      current.tunnels.add(invalidate)
      return {
        port: current.toolPort,
        release: () => {
          current.tunnels.delete(invalidate)
        },
      }
    }
    const release = (error: Error): void => {
      if (closed) return
      closed = true
      clearTimeout(timer)
      if (slot !== undefined && slots.get(slot.workerId) === slot) slots.delete(slot.workerId)
      if (run !== undefined) {
        clearTimeout(run.starting)
        clearTimeout(run.stopping)
        run.cleanup()
        closeTools(run)
        run.ready.reject(error)
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
    const readPatch = (current: Run, baseTree: string): Promise<WorkerPatch> => {
      if (run !== current || current.phase !== 'running' || current.snapshot !== undefined || !objectId.test(baseTree))
        return Promise.reject(new Error('The worker cannot check that workspace now.'))
      const result = deferred<WorkerPatch>()
      const timer = setTimeout(
        () => fail(status.DEADLINE_EXCEEDED, 'The worker did not return its workspace changes.'),
        SNAPSHOT_TIMEOUT_MS,
      )
      timer.unref()
      current.snapshot = { result, timer }
      sendControl({ case: 'snapshot', value: create(AgentSnapshotRequestSchema, { runId: current.id, baseTree }) })
      return result.promise
    }
    const finishSnapshot = (current: Run, pending: PendingSnapshot): void => {
      const transfer = pending.transfer
      if (transfer === undefined) return
      if (!createHash('sha256').update(transfer.patch).digest().equals(transfer.hash))
        return fail(status.INVALID_ARGUMENT, 'The worker returned the wrong workspace patch digest.')
      clearTimeout(pending.timer)
      delete current.snapshot
      pending.result.resolve({ tree: transfer.tree, patch: transfer.patch })
    }
    const start: Slot['start'] = (placement, { checkout, signal, toolPort }) => {
      if (closed || run !== undefined || recovering !== undefined)
        return Promise.reject(new Error('The worker is already running an agent.'))
      if (signal?.aborted === true) return Promise.reject(new Error('The agent start was cancelled.'))
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
        checkout === undefined ? START_TIMEOUT_MS : CHECKOUT_TIMEOUT_MS,
      )
      starting.unref()
      const transfer = new AbortController()
      const abort = (): void => {
        if (run?.id !== id) return
        run.ready.reject(new Error('The agent start was cancelled.'))
        void stop(run).catch(() => undefined)
      }
      const cleanup = (): void => {
        signal?.removeEventListener('abort', abort)
        transfer.abort()
      }
      run = { id, starting, output, ready: deferred<WorkerAgentProcess>(), exit, cleanup, toolPort, tunnels: new Set(), phase: 'starting' }
      signal?.addEventListener('abort', abort, { once: true })
      const current = run
      const source = checkout === undefined ? undefined : { size: checkout.size, sha256: checkout.sha256, head: checkout.head }
      void send({
        case: 'start',
        value: create(AgentRunStartSchema, {
          ...placement,
          runId: id,
          tools: toolPort !== undefined,
          ...(source === undefined ? {} : { source }),
        }),
      })
        .then(() => (checkout === undefined ? undefined : stage(current, checkout, transfer.signal)))
        .catch(() => {
          if (!transfer.signal.aborted) fail(status.UNAVAILABLE, 'Could not send the project workspace to the worker.')
        })
      return current.ready.promise
    }
    const write = async (current: Run, bytes: Uint8Array): Promise<void> => {
      for (let offset = 0; offset < bytes.byteLength; offset += MAX_AGENT_CHUNK) {
        if (current !== run || current.phase !== 'running') throw new Error('The worker agent is no longer running.')
        const data = bytes.subarray(offset, offset + MAX_AGENT_CHUNK)
        await send({ case: 'input', value: create(AgentRunBytesSchema, { runId: current.id, data }) })
      }
    }
    const stop = (current: Run): Promise<AgentRunExit> => {
      if (run === current && current.phase !== 'stopping') {
        current.phase = 'stopping'
        closeTools(current)
        current.cleanup()
        clearTimeout(current.starting)
        current.stopping = setTimeout(
          () => fail(status.DEADLINE_EXCEEDED, 'The worker did not confirm that the agent stopped.'),
          STOP_TIMEOUT_MS,
        )
        current.stopping.unref()
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
            capabilities.some(({ projectId, providerId }) => !validWorkerProtocolId(projectId, 'proj_') || !PROVIDER_ID.test(providerId))
          )
            return fail(status.INVALID_ARGUMENT, 'The worker sent invalid agent capabilities.')
          if (slots.has(workerId)) return fail(status.ALREADY_EXISTS, 'This worker already has an agent stream.')
          if (!validWorkerProtocolId(payload.value.journalId, 'wjn_') || !ledger.bind(workerId, payload.value.journalId))
            return fail(status.PERMISSION_DENIED, 'The worker does not have its enrolled execution journal.')
          recovering = ledger.outstanding(workerId)
          slot = { workerId, capabilities, start, openTools, busy: () => run !== undefined || recovering !== undefined }
          slots.set(workerId, slot)
          renew(AGENT_WORKER_LEASE_MS)
          sendControl({
            case: 'hello',
            value: create(AgentHomeHelloSchema, { homeId, workerId, version: WORKER_PROTOCOL_VERSION, leaseMs: AGENT_WORKER_LEASE_MS }),
          })
          if (recovering !== undefined) sendControl({ case: 'reconcile', value: create(AgentRunReconcileSchema, recovering) })
          return
        }
        if (payload.case === 'heartbeat') {
          if (payload.value.sequence !== sequence + 1) return fail(status.INVALID_ARGUMENT, 'The worker heartbeat was out of order.')
          sequence = payload.value.sequence
          renew(AGENT_WORKER_LEASE_MS)
          sendControl(payload)
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
        if (
          current === undefined ||
          (payload.case !== 'ready' &&
            payload.case !== 'output' &&
            payload.case !== 'exit' &&
            payload.case !== 'snapshot' &&
            payload.case !== 'patch') ||
          payload.value.runId !== current.id
        )
          return fail(status.PERMISSION_DENIED, 'This stream does not own that agent run.')
        if (payload.case === 'ready') {
          if (current.phase === 'stopping' && validPath(payload.value.workspacePath)) return
          const hasPort = payload.value.toolsPort > 0 && payload.value.toolsPort <= 65_535
          if (
            current.phase !== 'starting' ||
            !validPath(payload.value.workspacePath) ||
            (current.toolPort === undefined ? payload.value.toolsPort !== 0 : !hasPort)
          )
            return fail(status.INVALID_ARGUMENT, 'The worker sent invalid agent readiness.')
          clearTimeout(current.starting)
          current.cleanup()
          current.phase = 'running'
          current.ready.resolve({
            workspacePath: payload.value.workspacePath,
            ...(hasPort ? { toolPort: payload.value.toolsPort } : {}),
            output: current.output,
            exit: current.exit.promise,
            write: (chunk) => write(current, chunk),
            stop: () => stop(current),
            readPatch: (baseTree) => readPatch(current, baseTree),
          })
          return
        }
        if (payload.case === 'output') {
          const { data } = payload.value
          if (current.phase === 'starting' || data.byteLength === 0 || data.byteLength > MAX_AGENT_CHUNK)
            return fail(status.INVALID_ARGUMENT, 'The worker sent invalid agent output.')
          if (!current.output.write(data)) {
            call.pause()
            current.output.once('drain', () => {
              if (!closed) call.resume()
            })
          }
          return
        }
        if (payload.case === 'snapshot' || payload.case === 'patch') {
          const pending = current.snapshot
          if (pending === undefined) return fail(status.FAILED_PRECONDITION, 'There is no request for workspace changes.')
          if (payload.case === 'snapshot') {
            const { size, sha256, tree, unavailable } = payload.value
            if (pending.transfer !== undefined) return fail(status.INVALID_ARGUMENT, 'The worker already sent its patch metadata.')
            if (unavailable) return interruptSnapshot(current, new Error('The worker could not read its workspace changes.'))
            if (size > MAX_PATCH_BYTES || !objectId.test(tree) || sha256.byteLength !== 32)
              return fail(status.INVALID_ARGUMENT, 'The worker sent invalid workspace patch metadata.')
            pending.transfer = { patch: Buffer.alloc(size), hash: sha256, tree, written: 0 }
            if (size === 0) finishSnapshot(current, pending)
            return
          }
          const transfer = pending.transfer
          const { data } = payload.value
          if (
            transfer === undefined ||
            data.byteLength === 0 ||
            data.byteLength > MAX_AGENT_CHUNK ||
            transfer.written + data.byteLength > transfer.patch.byteLength
          )
            return fail(status.INVALID_ARGUMENT, 'The worker sent invalid workspace patch bytes.')
          transfer.patch.set(data, transfer.written)
          transfer.written += data.byteLength
          if (transfer.written === transfer.patch.byteLength) finishSnapshot(current, pending)
          return
        }
        if (!validOutcome(payload.value)) return fail(status.INVALID_ARGUMENT, 'The worker sent an invalid agent outcome.')
        if (payload.value.outcome !== AgentRunOutcome.UNCONFIRMED && !ledger.finish(workerId, payload.value))
          return fail(status.FAILED_PRECONDITION, 'The agent run is no longer current.')
        clearTimeout(current.starting)
        clearTimeout(current.stopping)
        current.cleanup()
        current.ready.reject(new Error('The worker could not start the agent. Check the worker log and provider setup.'))
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
    list: (projectId: string): ReadonlyArray<AvailableAgentWorker> =>
      [...slots.values()]
        .map(({ workerId, capabilities, busy }) => ({
          workerId,
          capabilities: capabilities.filter((item) => item.projectId === projectId),
          busy: busy(),
        }))
        .filter((item) => item.capabilities.length > 0),
    openTools: (workerId: string, runId: string, invalidate: () => void) => slots.get(workerId)?.openTools(runId, invalidate),
    start: async (workerId: string, placement: AgentPlacement, options: AgentRunOptions = {}): Promise<WorkerAgentProcess> => {
      const { checkout, toolPort } = options
      if (toolPort !== undefined && (!Number.isInteger(toolPort) || toolPort < 1 || toolPort > 65_535))
        throw new Error('The worker needs a valid local tool server port.')
      const slot = slots.get(workerId)
      if (slot === undefined || !supports(slot, placement.projectId, placement.providerId))
        return Promise.reject(new Error('This worker is unavailable for that project and provider.'))
      if (!validWorkerProtocolId(placement.workspaceId, 'ws_')) return Promise.reject(new Error('The worker needs a valid workspace ID.'))
      if (
        checkout !== undefined &&
        (!Number.isSafeInteger(checkout.size) ||
          checkout.size <= 0 ||
          checkout.size > MAX_WORKER_BUNDLE_BYTES ||
          checkout.sha256.byteLength !== 32 ||
          !objectId.test(checkout.head))
      )
        throw new Error('The worker needs a valid, bounded Git bundle.')
      return slot.start(placement, options)
    },
  }
}

export type AgentWorkerPool = ReturnType<typeof makeAgentWorkerPool>
