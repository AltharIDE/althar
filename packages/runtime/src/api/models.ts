import { createHash } from 'node:crypto'

import type { ApiHandlers } from '@althar/contracts'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { agentCatalogHandlers } from '../AgentCatalog'
import { Accounts } from '../Accounts'
import { Agents } from '../Config'
import { modelRooms } from '../modelRooms'
import { Issues } from '../Issues'
import { Limits } from '../Limits'
import { Models } from '../Models'
import { Installs } from '../Installs'
import { FastLane } from '../fastLane'
import { Tasks } from '../Tasks'
import { Sessions } from '../Sessions'
import { SignIns } from '../SignIns'
import type { ApiKit } from './kit'

/**
 * Which agent and model work, and how hard: a thread's agent, model and effort, defaults, blocked models, Auto's model moves, model rooms.
 * Agents themselves: installing one, the ACP catalog and connections.
 */
export const modelsHandlers = ({ sender, api, envelope, keptFor, imagesSaid, filesFor, filesSaid, commentsFor, commentsSaid }: ApiKit) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const signIns = yield* SignIns
    const accounts = yield* Accounts
    const limits = yield* Limits
    const installs = yield* Installs
    const models = yield* Models
    const fastLane = yield* FastLane
    const tasks = yield* Tasks
    const sql = yield* SqlClient.SqlClient
    const agents = yield* Agents
    const issues = yield* Issues
    return {
      ...(yield* agentCatalogHandlers),
      SwitchAgent: ({ commandId, threadId, agentId, model, effort, body, images, files, dictated, comments }) =>
        api(
          Effect.gen(function* () {
            // Its images and files are read and kept first, outside any transaction; one that can't be sent refuses the switch.
            const kept = body === undefined || images === undefined || images.length === 0 ? [] : yield* keptFor(threadId, images)
            const copied = body === undefined ? [] : yield* filesFor(threadId, files)
            const commented = body === undefined ? [] : yield* commentsFor(threadId, comments)
            // What the person said with it is said to the thread, under a command of its own.
            const message =
              body === undefined
                ? undefined
                : {
                    // Its own command id, made from the switch's, so a retry of the switch is a retry of it too.
                    envelope: yield* envelope(
                      'thread.send',
                      {
                        threadId,
                        body,
                        disposition: 'after_current',
                        ...imagesSaid(kept),
                        ...filesSaid(copied),
                        ...commentsSaid(commented),
                        ...(dictated === true ? { dictated } : {}),
                      },
                      `cmd_${createHash('sha256').update(`${commandId}\u0000said`).digest('hex').slice(0, 32)}`,
                    ),
                    body,
                    sender,
                    ...(kept.length === 0 ? {} : { images: kept }),
                    ...(copied.length === 0 ? {} : { files: copied }),
                    ...(commented.length === 0 ? {} : { comments: commented }),
                    ...(dictated === true ? { dictated: true } : {}),
                  }
            // Written to again with the switch, a task kept for later is back, as when it is sent on its own.
            if (message !== undefined) {
              const [thread] = yield* sql<{ taskId: string | null }>`SELECT task_id FROM threads WHERE id = ${threadId} AND kind = 'task'`
              if (thread?.taskId != null) yield* tasks.bringBack(thread.taskId)
            }
            const sessionId = yield* sessions.switchAgent({
              threadId,
              agentId,
              ...(model === undefined ? {} : { model }),
              ...(effort === undefined ? {} : { effort }),
              ...(message === undefined ? {} : { message }),
              // The person's switch: its first turn goes on at once (ADR-037).
              byPerson: sender.kind === 'window' || sender.kind === 'paired_device',
            })
            // Links in what the person said unfurl on their message, as when it is sent on its own.
            if (message !== undefined) yield* Effect.forkDetach(issues.unfurlInput(message.envelope.commandId))
            return sessionId
          }),
        ),
      SetModel: ({ threadId, agentId, model }) =>
        api(Effect.asVoid(sessions.chooseLead({ threadId, ...(agentId === undefined ? {} : { agentId }), model }))),
      SetEffort: ({ threadId, agentId, effort }) =>
        api(Effect.asVoid(sessions.chooseLead({ threadId, ...(agentId === undefined ? {} : { agentId }), effort }))),
      SetAgent: ({ threadId, agentId }) => api(Effect.asVoid(sessions.chooseLead({ threadId, agentId }))),
      GetModels: () => api(models.catalog),
      SetDefaultEffort: ({ agentId, model, effort }) => api(models.setDefaultEffort({ agentId, model, effort })),
      SetModelBlocked: ({ agentId, model, blocked }) => api(models.setModelBlocked({ agentId, model, blocked })),
      KeepTheModel: ({ itemId }) => api(fastLane.keepTheModel(itemId)),
      UndoTheModelMove: ({ itemId }) => api(fastLane.undoTheModelMove(itemId)),
      GetModelRooms: ({ projectId }) =>
        api(
          modelRooms(projectId).pipe(
            Effect.provideService(Agents, agents),
            Effect.provideService(Models, models),
            Effect.provideService(SignIns, signIns),
            Effect.provideService(Installs, installs),
            Effect.provideService(Limits, limits),
            Effect.provideService(Accounts, accounts),
          ),
        ),
      // Done once the copy is ready; its version and its models are asked again, as it is a new one.
      InstallAgent: ({ agentId }) =>
        api(
          Effect.gen(function* () {
            const entry = yield* agents.get(agentId)
            yield* installs.install(entry.definition)
            yield* models.forget(agentId)
          }),
        ),
    } satisfies Partial<ApiHandlers>
  })
