import type * as acp from '@agentclientprotocol/sdk'

/*
 * What an agent leaves running: a command it sent to the background, such
 * as a dev server or a watcher. Claude Code's and Codex's adapters report
 * these to a client that asks, through the JetBrains AIR `asyncTasks`
 * extension: one is spawned, its output goes somewhere, and it ends, by
 * itself or because it was stopped. ACP's schema doesn't have these updates
 * yet, and the SDK drops what its schema doesn't know before any handler
 * sees it, so the connection takes them off the stream first.
 *
 * Only commands. Claude Code reports some of its other background work the
 * same way, which isn't the person's to see or stop here. A command's name
 * is what the agent calls it: Codex's is the command, Claude Code's is
 * what the command's tool call says it does; the tool call has the command.
 */

/** The AIR capability that asks for them. */
export const asyncTasksCapability = 'asyncTasks'

/** How one ended: by itself, well or not, or stopped. */
export type BackgroundEnd = 'completed' | 'failed' | 'stopped'

export type BackgroundEvent =
  | {
      readonly _tag: 'BackgroundStarted'
      readonly id: string
      readonly name: string
      /** The tool call that started it, whose command it runs. */
      readonly toolCallId?: string
      /** The file its output goes to, where the agent says (Claude Code). */
      readonly outputPath?: string
    }
  /** Where its output goes, said after it started. */
  | { readonly _tag: 'BackgroundOutput'; readonly id: string; readonly outputPath: string }
  | { readonly _tag: 'BackgroundEnded'; readonly id: string; readonly end: BackgroundEnd }

/** The request that stops one, and what it answers. */
export const stopBackgroundMethod = '_session/async_task/stop'
export interface StopBackgroundResponse {
  readonly stopped: boolean
}

const recordOf = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined
const stringOf = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

const ends: ReadonlyArray<string> = ['completed', 'failed', 'stopped']

/** The background event in an update, if it is one; undefined for any other update, and for background work that isn't a command. */
const eventOf = (update: Readonly<Record<string, unknown>>): BackgroundEvent | undefined => {
  const id = stringOf(update.asyncTaskId)
  if (id === undefined) return undefined
  const outputPath = stringOf(update.outputFilePath)
  switch (update.sessionUpdate) {
    case 'async_task_spawned': {
      if (update.taskType !== 'shell') return undefined
      const toolCallId = stringOf(update.toolCallId)
      return {
        _tag: 'BackgroundStarted',
        id,
        name: stringOf(update.name) ?? stringOf(update.description) ?? '',
        ...(toolCallId === undefined ? {} : { toolCallId }),
        ...(outputPath === undefined ? {} : { outputPath }),
      }
    }
    case 'async_task_progress':
      return outputPath === undefined ? undefined : { _tag: 'BackgroundOutput', id, outputPath }
    case 'async_task_state_update': {
      const state = stringOf(update.state)
      if (state !== undefined && ends.includes(state)) return { _tag: 'BackgroundEnded', id, end: state as BackgroundEnd }
      // Running again or paused: still running, as far as the person can tell.
      return outputPath === undefined ? undefined : { _tag: 'BackgroundOutput', id, outputPath }
    }
    default:
      return undefined
  }
}

/** Whether a message is one of these updates, whatever becomes of it. */
const isBackgroundUpdate = (message: acp.AnyMessage): Readonly<Record<string, unknown>> | undefined => {
  const fields = recordOf(message)
  if (fields?.method !== 'session/update') return undefined
  const params = recordOf(fields.params)
  const update = recordOf(params?.update)
  return typeof update?.sessionUpdate === 'string' && update.sessionUpdate.startsWith('async_task_') ? params : undefined
}

/**
 * The stream the SDK reads, without these updates: each one that is about a
 * command goes to `heard` with its session instead, in the order it came.
 */
export const takingBackground = (stream: acp.Stream, heard: (sessionId: string, event: BackgroundEvent) => void): acp.Stream => ({
  writable: stream.writable,
  readable: stream.readable.pipeThrough(
    new TransformStream<acp.AnyMessage, acp.AnyMessage>({
      transform(message, controller) {
        const params = isBackgroundUpdate(message)
        if (params === undefined) return controller.enqueue(message)
        const sessionId = stringOf(params.sessionId)
        const event = eventOf(recordOf(params.update) ?? {})
        if (sessionId !== undefined && event !== undefined) heard(sessionId, event)
      },
    }),
  ),
})
