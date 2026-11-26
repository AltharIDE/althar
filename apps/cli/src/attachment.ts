import { createHash, randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'

import { ApiError, type FeedPosition } from '@althar/contracts'
import { apiClient, inspectSshHost, openLocalConnection, openSshConnection, transportError } from '@althar/transport-node'
import { Effect, Stream } from 'effect'

import { type AttachmentOptions, type AttachmentTarget, ATTACH_USAGE } from './attachmentOptions'
import { attachmentPrinter, terminalText } from './attachmentPrinter'
import { attachmentLines } from './attachmentInput'
import { parseLine } from './input'

export type AttachedApi = Effect.Success<ReturnType<typeof apiClient>>['api']
export interface AttachmentIO {
  readonly input: Readable
  readonly write: (text: string) => Effect.Effect<void, Error>
}
const newCommand = () => `cmd_${randomUUID().replaceAll('-', '')}`
/** Separate durable commands, deterministically related so an explicitly retried creation cannot start the agent twice. */
export const startCommand = (createCommand: string) =>
  `cmd_${createHash('sha256').update(`althar.attach.start.v1:${createCommand}`).digest('hex').slice(0, 32)}`
export const attachmentFailure = (error: unknown) =>
  error instanceof ApiError
    ? `${error.reason}: ${terminalText(error.message)}`
    : error instanceof Error
      ? terminalText(error.message)
      : 'The attached client failed.'

export const attachedSession = (
  api: AttachedApi,
  homeId: string,
  selection: Extract<AttachmentOptions, { command: 'attach' }>['selection'],
  io: AttachmentIO,
) =>
  Effect.gen(function* () {
    let threadId: string
    let start: { commandId: string; agentId: string; model?: string } | undefined
    if ('threadId' in selection) threadId = selection.threadId
    else {
      const commandId = selection.commandId ?? newCommand()
      // Print before dispatch: after an uncertain disconnect the person can reuse this id explicitly.
      yield* io.write(`Creation command: ${commandId}\n`)
      const task = yield* api.CreateTask({ commandId, projectId: selection.projectId, title: selection.title })
      threadId = task.threadId
      start = {
        commandId: startCommand(commandId),
        agentId: selection.agentId,
        ...(selection.model === undefined ? {} : { model: selection.model }),
      }
    }
    yield* io.write(`Thread: ${terminalText(threadId)}\n${ATTACH_USAGE}\n`)
    const out = attachmentPrinter()
    let position: FeedPosition
    const refresh = Effect.gen(function* () {
      const snapshot = yield* api.GetThread({ threadId, limit: 100 })
      if (snapshot.position === undefined || snapshot.position.homeId !== homeId)
        return yield* transportError('HomeMismatch', 'The thread did not return a position belonging to this home.')
      yield* io.write(out.snapshot(snapshot))
      return snapshot.position
    })
    position = yield* refresh
    if (start !== undefined) yield* api.StartSession({ threadId, ...start })
    const watch = Effect.gen(function* () {
      let refreshed = false
      for (;;) {
        const failure = yield* api.WatchFrom({ position }).pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              refreshed = false
              if (event._tag === 'Streaming' && event.threadId === threadId) yield* io.write(out.streaming(event))
              if (event._tag === 'Changed') {
                if (event.checkpoint === undefined)
                  return yield* transportError('ConnectionClosed', 'The host omitted its durable feed checkpoint.')
                position = { homeId, cursor: event.cursor, checkpoint: event.checkpoint }
                if (event.threadId === threadId || event.projectId !== null) yield* refresh
              }
            }),
          ),
          Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }),
        )
        if (failure instanceof ApiError && failure.reason === 'SnapshotRequired' && !refreshed) {
          refreshed = true
          yield* io.write('\n[Feed changed; reading a fresh snapshot]\n')
          position = yield* refresh
        } else
          return yield* Effect.fail(
            failure ?? transportError('ConnectionClosed', 'The home disconnected. Its work continues; reattach with --thread.'),
          )
      }
    })
    const input = Stream.fromAsyncIterable(attachmentLines(io.input), (error) =>
      error instanceof Error ? error : new Error('Terminal input closed.'),
    ).pipe(
      Stream.takeWhile((line) => parseLine(line)._tag !== 'Quit'),
      Stream.runForEach((line) =>
        Effect.gen(function* () {
          const action = parseLine(line)
          const commandId = newCommand()
          switch (action._tag) {
            case 'Say':
            case 'Interrupt':
              yield* api.Send({
                commandId,
                threadId,
                body: action.text,
                disposition: action._tag === 'Say' ? 'after_current' : 'interrupt_and_continue',
              })
              break
            case 'Model':
              yield* api.SetModel({ commandId, threadId, model: action.model })
              break
            case 'Agent':
              yield* api.SwitchAgent({
                commandId,
                threadId,
                agentId: action.agent,
                ...(action.model === undefined ? {} : { model: action.model }),
              })
              break
            case 'Stop':
              yield* api.StopSession({ commandId, threadId })
              break
            case 'Answer':
              yield* io.write('This terminal can’t answer permissions or questions: answer them in the Althar window.\n')
              break
            case 'Help':
              yield* io.write(`${ATTACH_USAGE}\n`)
              break
            case 'Unknown':
              yield* io.write(`${terminalText(action.message)}\n`)
              break
          }
        }).pipe(
          Effect.catch((error) =>
            error instanceof ApiError && error.reason !== 'ConnectionClosed'
              ? io.write(`! ${attachmentFailure(error)}\n`)
              : Effect.fail(error),
          ),
        ),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          io.input.destroy()
        }),
      ),
    )
    yield* Effect.raceFirst(input, watch)
  })

export const attachedClient = (target: AttachmentTarget) =>
  Effect.gen(function* () {
    if (target.kind === 'local') return yield* apiClient(yield* openLocalConnection(target.profile, target.homeId))
    if (target.homeId === undefined)
      return yield* transportError('HomeMismatch', 'Verify the remote home ID before opening its connection.')
    return yield* apiClient(yield* openSshConnection({ ...target.ssh, homeId: target.homeId }))
  })

export const runAttachment = (options: AttachmentOptions, io: AttachmentIO) =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = options.target
      if (options.command === 'inspect' && target.kind === 'ssh' && target.homeId === undefined) {
        const status = yield* inspectSshHost(target.ssh)
        yield* io.write(
          options.json
            ? `${JSON.stringify(status)}\n`
            : `Home: ${status.homeId}\nHost: ${status.hostDeviceId}\nVersion: ${terminalText(status.version)} (API ${status.apiVersion})\nUse this verified home with attach.\n`,
        )
        return
      }
      const { api, info } = yield* attachedClient(target)
      if (options.command === 'inspect') {
        const projects = yield* api.ListProjects()
        yield* io.write(
          options.json
            ? `${JSON.stringify({ info, projects })}\n`
            : `Home: ${info.identity.homeId}\n${projects.projects.map((project) => `${project.id}: ${terminalText(project.name)}`).join('\n')}\n`,
        )
      } else yield* attachedSession(api, info.identity.homeId, options.selection, io)
    }),
  )
