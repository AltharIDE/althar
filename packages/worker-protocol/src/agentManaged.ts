import { create } from '@bufbuild/protobuf'
import type { Duplex } from 'node:stream'
import {
  AgentManagedRefSchema,
  AgentManagedStartSchema,
  AgentRunOutcome,
  type AgentHomeFrame,
  type AgentManagedExit,
  type AgentWorkerFrame,
} from './gen/althar/worker/v1/control_pb.ts'
import { validWorkerProtocolId } from './handshake.ts'
import { deferred, type Deferred } from './deferred.ts'

const MAX_COMMANDS = 8
const MAX_CHUNK = 2_048
const COMMAND_TIMEOUT = 10_000

export interface WorkerManagedCommand {
  readonly id: string
  readonly directory: string
  readonly command: string
  /** Bytes are delivered as they arrive, even if the process exits before start settles. */
  readonly output: (bytes: Uint8Array) => void
}

export interface WorkerManagedProcess {
  readonly exit: Promise<AgentManagedExit>
  readonly stop: () => Promise<void>
  readonly preview?: (port: number, signal?: AbortSignal) => Promise<Duplex>
}

type HomePayload = AgentHomeFrame['payload']
export type ManagedPayload = Extract<NonNullable<AgentWorkerFrame['payload']>, { case: 'managedReady' | 'managedOutput' | 'managedExit' }>

interface Command {
  readonly ready: Deferred<WorkerManagedProcess>
  readonly exit: Deferred<AgentManagedExit>
  readonly output: WorkerManagedCommand['output']
  readonly stop: () => Promise<void>
  phase: 'starting' | 'running' | 'stopping'
  timeout?: NodeJS.Timeout
}

export const makeManagedCommands = (
  runId: string,
  available: boolean,
  ownsRun: () => boolean,
  send: (payload: HomePayload) => void,
  invalid: (message: string) => void,
  previews?: {
    readonly open: (commandId: string, port: number, active: () => boolean, signal?: AbortSignal) => Promise<Duplex>
    readonly close: (commandId: string) => void
  },
) => {
  const active = new Map<string, Command>()
  const expired = () => invalid('The worker did not confirm the managed command in time.')
  return {
    start: (input: WorkerManagedCommand): Promise<WorkerManagedProcess> => {
      if (!ownsRun()) return Promise.reject(new Error('The worker no longer owns this checkout.'))
      if (!available) return Promise.reject(new Error('Update this worker to start project commands.'))
      if (active.size >= MAX_COMMANDS || active.has(input.id))
        return Promise.reject(new Error('This worker checkout has too many commands.'))
      if (
        !validWorkerProtocolId(input.id, 'proc_') ||
        Buffer.byteLength(input.directory) > 1_024 ||
        Buffer.byteLength(input.command) > MAX_CHUNK ||
        !input.command.trim() ||
        input.command.includes('\0')
      )
        return Promise.reject(new Error('This command is too large or has an invalid workspace folder.'))
      const managed = create(AgentManagedRefSchema, { runId, commandId: input.id })
      const record: Command = {
        ready: deferred(),
        exit: deferred(),
        output: input.output,
        phase: 'starting',
        timeout: setTimeout(expired, COMMAND_TIMEOUT).unref(),
        stop: async () => {
          if (active.get(input.id) === record && record.phase !== 'stopping') {
            record.phase = 'stopping'
            previews?.close(input.id)
            clearTimeout(record.timeout)
            record.timeout = setTimeout(expired, COMMAND_TIMEOUT).unref()
            send({ case: 'managedStop', value: managed })
          }
          const result = await record.exit.promise
          if (result.outcome === AgentRunOutcome.UNCONFIRMED) throw new Error('The worker could not confirm that the command stopped.')
        },
      }
      void record.ready.promise.catch(() => undefined)
      void record.exit.promise.catch(() => undefined)
      active.set(input.id, record)
      send({
        case: 'managedStart',
        value: create(AgentManagedStartSchema, { managed, directory: input.directory, command: input.command }),
      })
      return record.ready.promise
    },
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
        command.ready.resolve({ exit: command.exit.promise, stop: command.stop, ...(previews === undefined ? {} : { preview }) })
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
      previews?.close(managed.commandId)
      command.ready.reject(new Error('The worker could not start this command. Check its project folder and worker log.'))
      command.exit.resolve(frame.value)
    },
    close: (error: Error) => {
      for (const [id, command] of active) {
        previews?.close(id)
        clearTimeout(command.timeout)
        command.ready.reject(error)
        command.exit.reject(error)
      }
      active.clear()
    },
  }
}
