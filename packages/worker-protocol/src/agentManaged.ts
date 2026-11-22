import { createHash } from 'node:crypto'
import { create } from '@bufbuild/protobuf'
import type { Duplex } from 'node:stream'
import {
  AgentHelperStartSchema,
  AgentManagedInputSchema,
  AgentManagedRefSchema,
  AgentManagedStartSchema,
  AgentRunOutcome,
  type AgentHomeFrame,
  type AgentManagedExit,
  type AgentWorkerFrame,
} from './gen/althar/worker/v1/control_pb.ts'
import { validWorkerProtocolId } from './handshake.ts'
import { deferred, type Deferred } from './deferred.ts'
import { sourceOf, validCheckout, type WorkerCheckout } from './agentCheckout.ts'
import { workerSkillBundle, type WorkerSkillFile } from './agentSkillFiles.ts'

const MAX_COMMANDS = 8
const MAX_CHUNK = 2_048
const COMMAND_TIMEOUT = 10_000
const HELPER_UPLOAD_TIMEOUT = 180_000

export interface WorkerManagedCommand {
  readonly id: string
  readonly directory: string
  readonly command: string
  /** Bytes are delivered as they arrive, even if the process exits before start settles. */
  readonly output: (bytes: Uint8Array) => void
}

export interface WorkerHelperRequest extends Omit<WorkerManagedCommand, 'command'> {
  readonly providerId: string
  readonly skills?: ReadonlyArray<WorkerSkillFile>
  readonly checkout?: WorkerCheckout
}

export interface WorkerManagedProcess {
  readonly exit: Promise<AgentManagedExit>
  readonly stop: () => Promise<void>
  readonly preview?: (port: number, signal?: AbortSignal) => Promise<Duplex>
  readonly write?: (bytes: Uint8Array) => Promise<void>
  readonly ownsProcess?: () => boolean
  readonly checkoutPath?: string
  readonly skillsPath?: string
}

type HomePayload = AgentHomeFrame['payload']
export type ManagedPayload = Extract<NonNullable<AgentWorkerFrame['payload']>, { case: 'managedReady' | 'managedOutput' | 'managedExit' }>

interface Command {
  readonly ready: Deferred<WorkerManagedProcess>
  readonly exit: Deferred<AgentManagedExit>
  readonly output: WorkerManagedCommand['output']
  readonly stop: () => Promise<void>
  readonly write?: (bytes: Uint8Array) => Promise<void>
  readonly checkout: boolean
  readonly delivery: AbortController
  phase: 'starting' | 'running' | 'stopping'
  timeout?: NodeJS.Timeout
}

export const makeManagedCommands = (
  runId: string,
  available: boolean,
  ownsRun: () => boolean,
  send: (payload: HomePayload) => Promise<void>,
  invalid: (message: string) => void,
  /** Why the worker can't start a helper of this agent, with skills or a checkout: it hasn't the agent, or is too old; none where it can. */
  helperUnfit: (providerId: string, withSkills: boolean, withCheckout: boolean) => 'agent' | 'update' | undefined,
  previews?: {
    readonly open: (commandId: string, port: number, active: () => boolean, signal?: AbortSignal) => Promise<Duplex>
    readonly close: (commandId: string) => void
  },
) => {
  const active = new Map<string, Command>()
  const expired = () => invalid('The worker did not confirm the managed command in time.')
  const post = (payload: HomePayload) => {
    void send(payload).catch(() => invalid('Could not send a command frame to the worker.'))
  }
  // Only one selected skill projection is uploaded at a time for a workspace lease.
  let uploads = Promise.resolve()
  const start = async (input: WorkerManagedCommand | WorkerHelperRequest): Promise<WorkerManagedProcess> => {
    if (!ownsRun()) return Promise.reject(new Error('The worker no longer owns this checkout.'))
    const helper = 'providerId' in input
    const checkout = helper ? input.checkout : undefined
    const unfit = helper ? helperUnfit(input.providerId, input.skills !== undefined, checkout !== undefined) : undefined
    if (unfit === 'agent') return Promise.reject(new Error('This worker doesn’t have the helper’s agent for this project.'))
    if (unfit === 'update') return Promise.reject(new Error('Update this worker to start this helper on it.'))
    if (!helper && !available) return Promise.reject(new Error('Update this worker to start project commands.'))
    if (active.size >= MAX_COMMANDS || active.has(input.id)) return Promise.reject(new Error('This worker checkout has too many commands.'))
    if (
      !validWorkerProtocolId(input.id, 'proc_') ||
      Buffer.byteLength(input.directory) > 1_024 ||
      (!helper && (Buffer.byteLength(input.command) > MAX_CHUNK || !input.command.trim() || input.command.includes('\0')))
    )
      return Promise.reject(new Error('This command is too large or has an invalid workspace folder.'))
    if (checkout !== undefined && !validCheckout(checkout)) throw new Error('The helper’s checkout is too large or incomplete.')
    const assets = helper && input.skills !== undefined ? workerSkillBundle(input.skills) : undefined
    const transfer = checkout !== undefined || assets !== undefined
    const managed = create(AgentManagedRefSchema, { runId, commandId: input.id })
    const record: Command = {
      ready: deferred(),
      exit: deferred(),
      output: input.output,
      phase: 'starting',
      checkout: checkout !== undefined,
      delivery: new AbortController(),
      ...(transfer ? {} : { timeout: setTimeout(expired, COMMAND_TIMEOUT).unref() }),
      stop: async () => {
        if (active.get(input.id) === record && record.phase !== 'stopping') {
          record.phase = 'stopping'
          record.delivery.abort()
          previews?.close(input.id)
          clearTimeout(record.timeout)
          record.timeout = setTimeout(expired, COMMAND_TIMEOUT).unref()
          post({ case: 'managedStop', value: managed })
        }
        const result = await record.exit.promise
        if (result.outcome === AgentRunOutcome.UNCONFIRMED) throw new Error('The worker could not confirm that the command stopped.')
      },
      ...(helper
        ? {
            write: async (bytes: Uint8Array) => {
              for (let start = 0; start < bytes.byteLength; start += MAX_CHUNK) {
                if (!ownsRun() || active.get(input.id) !== record || record.phase !== 'running')
                  throw new Error('The worker helper has stopped.')
                await send({
                  case: 'helperInput',
                  value: create(AgentManagedInputSchema, { managed, data: bytes.subarray(start, start + MAX_CHUNK) }),
                })
              }
            },
          }
        : {}),
    }
    void record.ready.promise.catch(() => undefined)
    void record.exit.promise.catch(() => undefined)
    active.set(input.id, record)
    if (helper && transfer) {
      uploads = uploads
        .then(async () => {
          if (!ownsRun() || active.get(input.id) !== record || record.phase !== 'starting') return
          record.timeout = setTimeout(expired, HELPER_UPLOAD_TIMEOUT).unref()
          await send({
            case: 'helperStart',
            value: create(AgentHelperStartSchema, {
              managed,
              directory: input.directory,
              providerId: input.providerId,
              ...(checkout === undefined ? {} : { checkout: sourceOf(checkout) }),
              ...(assets === undefined
                ? {}
                : { skills: { size: assets.byteLength, sha256: createHash('sha256').update(assets).digest() } }),
            }),
          })
          const uploading = () => ownsRun() && active.get(input.id) === record && record.phase === 'starting'
          const deliver = async (bytes: Uint8Array, kind: 'helperCheckoutChunk' | 'helperSkillsChunk') => {
            for (let offset = 0; uploading() && offset < bytes.byteLength; offset += MAX_CHUNK) {
              await send({
                case: kind,
                value: create(AgentManagedInputSchema, { managed, data: bytes.subarray(offset, offset + MAX_CHUNK) }),
              })
            }
          }
          if (checkout !== undefined) {
            let sent = 0
            for await (const bytes of checkout.contents(record.delivery.signal)) {
              if (!uploading()) return
              sent += bytes.byteLength
              if (sent > checkout.size) throw new Error('The helper checkout changed during transfer.')
              await deliver(bytes, 'helperCheckoutChunk')
            }
            if (sent !== checkout.size && uploading()) throw new Error('The helper checkout ended during transfer.')
          }
          if (assets !== undefined) await deliver(assets, 'helperSkillsChunk')
        })
        .catch(() => {
          if (!record.delivery.signal.aborted) invalid('Could not send the checkout or selected skills to the worker helper.')
        })
    } else if (helper) {
      post({
        case: 'helperStart',
        value: create(AgentHelperStartSchema, { managed, directory: input.directory, providerId: input.providerId }),
      })
    } else {
      post({
        case: 'managedStart',
        value: create(AgentManagedStartSchema, { managed, directory: input.directory, command: input.command }),
      })
    }
    return record.ready.promise
  }
  return {
    start,
    ownsCheckout: (id: string) => ownsRun() && active.get(id)?.checkout === true && active.get(id)?.phase === 'running',
    receive: (frame: ManagedPayload) => {
      const managed = frame.case === 'managedReady' ? frame.value : frame.value.managed
      const command = managed === undefined ? undefined : active.get(managed.commandId)
      if (!ownsRun() || managed?.runId !== runId || command === undefined) return invalid('The worker sent an unassigned managed command.')
      if (frame.case === 'managedReady') {
        if (command.phase !== 'starting') return invalid('The worker sent unexpected command readiness.')
        clearTimeout(command.timeout)
        command.phase = 'running'
        const commandId = managed.commandId
        const preview = (port: number, signal?: AbortSignal) => {
          if (previews === undefined || !Number.isInteger(port) || port < 1 || port > 65_535)
            return Promise.reject(new Error('Choose a valid worker preview port.'))
          return previews.open(commandId, port, () => ownsRun() && active.get(commandId) === command && command.phase === 'running', signal)
        }
        command.ready.resolve({
          exit: command.exit.promise,
          stop: command.stop,
          ownsProcess: () => ownsRun() && active.get(commandId) === command && command.phase === 'running',
          ...(command.write === undefined ? (previews === undefined ? {} : { preview }) : { write: command.write }),
        })
        return
      }
      if (frame.case === 'managedOutput') {
        const data = frame.value.data
        if (command.phase === 'starting' || data.byteLength === 0 || data.byteLength > MAX_CHUNK)
          return invalid('The worker sent invalid command output.')
        command.output(data)
        return
      }
      const { outcome, exitCode } = frame.value
      if (
        outcome === AgentRunOutcome.EXITED
          ? command.phase === 'starting' || exitCode === undefined || exitCode > 255
          : exitCode !== undefined ||
            (outcome !== AgentRunOutcome.START_FAILED && outcome !== AgentRunOutcome.STOPPED && outcome !== AgentRunOutcome.UNCONFIRMED)
      )
        return invalid('The worker sent an invalid command result.')
      clearTimeout(command.timeout)
      active.delete(managed.commandId)
      command.delivery.abort()
      previews?.close(managed.commandId)
      command.ready.reject(new Error('The worker could not start this command. Check its project folder and worker log.'))
      command.exit.resolve(frame.value)
    },
    close: (error: Error) => {
      for (const [id, command] of active) {
        previews?.close(id)
        command.delivery.abort()
        clearTimeout(command.timeout)
        command.ready.reject(error)
        command.exit.reject(error)
      }
      active.clear()
    },
  }
}
