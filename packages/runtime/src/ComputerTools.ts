import { Ids, type ProjectId, newId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Duration, Effect, Layer, Schedule } from 'effect'
import { SqlClient } from 'effect/sql'

import { Artifacts } from './Artifacts'
import { RuntimeConfig } from './Config'
import { ToolRefused, ToolServer } from './ToolServer'
import { type ComputerOwner, computerCallOf, computerCallProblem, computerInput } from './computerBridge'
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
              'Use this computer’s apps as a person would. Start with status, then request access with a short reason saying what you will do: the person allows this computer once for the turn, every app and window, foreground input, and the primary display where it can be shared. Request again later in the turn to find windows opened since; it doesn’t ask again. Launch opens any installed app by its name ("Akiflow"), bundle id or path, or by an app id from the list, whether it is running or not, and brings back its window: the windows it returns have ids to observe. Observe a window for its elements and, with screenshot, a picture; observe "desktop" for a picture of the whole primary display (the Dock, the menu bar, Spotlight, dialogs), whose pixels are the coordinates for input to "desktop". Every input acts on the latest observation of its target: click an element or a point, type, key (one key such as ["return"], or a chord such as ["cmd","space"]), scroll or drag; then observe again to check what happened. Keys and typing to "desktop" go to the app in front; while Althar’s window is in front only cmd+space (Spotlight) and cmd+tab reach it, so bring the app forward first: launch it, click it in the Dock, or open it from Spotlight. If background input to a window doesn’t land, send it with foreground: true. Get past what a person would, within this grant: close what’s new and onboarding screens, dismiss prompts and banners, open menus. Leave passwords and secure fields to the person. An app another task is using stays with it until its turn ends; input to the whole display waits while another task holds an app, and once sent, holds every app until this turn ends. Evidence keeps a selected screenshot in the task. Release returns control. Use page_* for the browser beside the conversation.',
            input: computerInput,
            privateInput: true,
            cancelWithRequest: true,
            call: (input, access) =>
              Effect.gen(function* () {
                const parsed = computerCallOf(input)
                if (parsed === null) return yield* refuse(computerCallProblem(input))
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
