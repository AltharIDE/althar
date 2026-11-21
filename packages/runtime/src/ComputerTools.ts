import { Ids, type ProjectId, newId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Duration, Effect, Layer, Schedule } from 'effect'
import { SqlClient } from 'effect/sql'

import { Artifacts } from './Artifacts'
import { RuntimeConfig } from './Config'
import { ToolRefused, ToolServer } from './ToolServer'
import { type ComputerOwner, computerCallOf, computerInput } from './computerBridge'
import { keepPicture } from './handed'
import { addItem } from './threads'

export class ComputerTools extends Context.Service<ComputerTools, object>()('@althar/runtime/ComputerTools') {
  static readonly layer = Layer.effect(
    ComputerTools,
    Effect.gen(function* () {
      const { computer, computerEnded } = yield* RuntimeConfig
      const tools = yield* ToolServer
      if (computer === undefined) return ComputerTools.of({})

      const context = yield* Effect.context<SqlClient.SqlClient | Artifacts | Ledger | Crypto.Crypto>()
      const sql = yield* SqlClient.SqlClient
      const refuse = (message: string) => new ToolRefused({ message })
      const owners = new Map<string, ComputerOwner>()
      if (computerEnded !== undefined) {
        const release = (owner: ComputerOwner) => {
          if (owners.get(owner.taskId) !== owner) return
          owners.delete(owner.taskId)
          computerEnded(owner)
        }
        yield* Effect.gen(function* () {
          if (owners.size === 0) return
          const checking = [...owners.values()]
          const live = yield* sql<{ id: string }>`
            SELECT id FROM turn_deliveries WHERE id IN ${sql.in(checking.map((one) => one.turnId))} AND state = 'delivered'
          `.pipe(Effect.orElseSucceed(() => []))
          const active = new Set(live.map((one) => one.id))
          for (const owner of checking) if (!active.has(owner.turnId)) release(owner)
        }).pipe(Effect.repeat(Schedule.spaced(Duration.seconds(1))), Effect.forkScoped)
      }

      yield* tools.serve(
        ['lead', 'reviewer'],
        [
          {
            name: 'computer',
            description:
              'Use native apps on this task’s computer. Start with status. Request access with a short reason and name the apps the person should select. Ask for desktop access only for work needing foreground input or a whole-display view. Observe an approved target for fresh observation and element references. Verify each input in the app before continuing. If background typing fails to reach the field, request foreground input, observe with a screenshot, and target the field using screenshot coordinates. Evidence keeps a selected screenshot in the task. Release returns control. Use page_* for the browser beside the conversation.',
            input: computerInput,
            privateInput: true,
            cancelWithRequest: true,
            call: (input, access) =>
              Effect.gen(function* () {
                const parsed = computerCallOf(input)
                if (parsed === null) return yield* refuse('Give a valid computer operation and its arguments.')
                if (access.taskId === null || access.turnId == null) return yield* refuse('Computer use needs an active task turn.')
                const [task] = yield* sql<{ title: string; projectId: ProjectId }>`
            SELECT t.title, t.project_id FROM tasks t JOIN threads h ON h.task_id = t.id AND h.project_id = t.project_id
            JOIN turn_deliveries d ON d.thread_id = h.id AND d.project_id = t.project_id
            WHERE t.id = ${access.taskId} AND t.project_id = ${access.projectId}
              AND d.id = ${access.turnId} AND d.provider_session_id = ${access.sessionId}
              AND d.state = 'delivered' AND t.state NOT IN ('done', 'abandoned')
          `.pipe(Effect.mapError(() => refuse('Althar could not check the active task.')))
                if (task === undefined) return yield* refuse('Computer use needs an active task turn.')
                const owner = {
                  taskId: access.taskId,
                  sessionId: access.sessionId,
                  threadId: access.threadId,
                  turnId: access.turnId,
                  title: task.title.slice(0, 240) || 'Task',
                }
                if (parsed.op === 'request' && computerEnded !== undefined) owners.set(owner.taskId, owner)
                const answer = yield* computer(owner, parsed).pipe(Effect.mapError(refuse))
                if (parsed.op === 'release') owners.delete(owner.taskId)
                if (answer.picture === undefined) return answer.text
                if (parsed.op === 'evidence') {
                  const id = yield* newId(Ids.threadItem)
                  const picture = yield* keepPicture(
                    { projectId: task.projectId, itemId: id, folders: [] },
                    Buffer.from(answer.picture.data, 'base64'),
                    answer.picture.mimeType,
                    parsed.caption,
                  )
                  if (picture.sha256 === null) return yield* refuse('Althar could not keep that picture.')
                  yield* addItem(
                    { projectId: task.projectId, threadId: access.threadId, sessionId: access.sessionId, deliveryId: access.turnId },
                    'pictures',
                    { pictures: [{ caption: parsed.caption, picture }], source: 'computer' },
                    { id },
                  ).pipe(Effect.mapError(() => refuse('Althar could not attach the picture to the task.')))
                  return `Kept the screenshot in the task conversation. In finish_step evidence use computer_capture: ${id}.`
                }
                return { text: answer.text, image: answer.picture }
              }).pipe(Effect.provideContext(context)),
          },
        ],
      )
      return ComputerTools.of({})
    }),
  )
}
