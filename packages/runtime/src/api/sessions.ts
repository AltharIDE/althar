import type { ApiHandlers } from '@althar/contracts'
import type { Commands, Ledger } from '@althar/persistence-sqlite'
import { type Crypto, Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { pauseGoal } from '../threadGoals'
import { Automations } from '../Automations'
import { Changes } from '../Changes'
import { RetryRefused } from '../errors'
import type { Instance } from '../Instance'
import { Permissions } from '../Permissions'
import { Questions } from '../Questions'
import { Busy } from '../Busy'
import * as Runtime from '../Runtime'
import { Coordinator } from '../Coordinator'
import { Runs } from '../Runs'
import { Tasks } from '../Tasks'
import { Sessions } from '../Sessions'
import { cancelWaitingTurn } from '../upNextMoves'
import type { ApiKit } from './kit'

/**
 * A thread's agent session and its turns: starting and stopping it, interrupting, trying again, compacting, undoing a turn.
 * The answers the person gives an agent: permissions, questions, a stuck step, a held step, a checkout.
 */
export const sessionsHandlers = ({ sender, actorId, api, envelope }: ApiKit) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<Instance | Crypto.Crypto>()
    const sessions = yield* Sessions
    const permissions = yield* Permissions
    const questions = yield* Questions
    const runs = yield* Runs
    const tasks = yield* Tasks
    const coordinator = yield* Coordinator
    const sql = yield* SqlClient.SqlClient
    // What writes a project's notes needs, as the services have it.
    const store = yield* Effect.context<SqlClient.SqlClient | Ledger | Commands | Crypto.Crypto>()
    const pullRequests = yield* Changes
    const busy = yield* Busy
    const automations = yield* Automations
    return {
      StartSession: ({ threadId, agentId, model, effort }) =>
        api(sessions.start({ threadId, agentId, ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) })),
      // Interrupted by the person, a conflict its lead was resolving is theirs (ADR-030): handed over first, so the turn's end doesn't ask the lead again.
      // A lead between turns, a turn Althar asked of it waiting for a place up next: that turn is let go (stop_task with turn).
      Interrupt: ({ threadId }) =>
        api(
          Effect.gen(function* () {
            yield* Effect.provideContext(pauseGoal(threadId), store)
            const live = yield* sessions.running(threadId)
            if (Option.isNone(live) || !live.value.turnRunning) {
              const [task] = yield* sql<{ taskId: string | null }>`SELECT task_id FROM threads WHERE id = ${threadId}`
              if (task?.taskId != null && (yield* cancelWaitingTurn(busy, sessions, sql)(task.taskId)) > 0) return
            }
            yield* pullRequests.leadStopped({ threadId }, 'interrupted')
            yield* sessions.interrupt(threadId, 'person', true)
          }),
        ),
      TryAgain: ({ threadId }) =>
        api(
          Effect.gen(function* () {
            if (!(yield* sessions.tryAgain(threadId))) return yield* new RetryRefused()
          }),
        ),
      CompactContext: ({ commandId, threadId }) =>
        api(Effect.flatMap(envelope('thread.compact', { threadId }, commandId), (made) => sessions.compact({ envelope: made, threadId }))),
      // Stopped by the person, a conflict its lead was resolving is theirs (ADR-030): the lead isn't started again for it.
      StopSession: ({ threadId }) =>
        api(
          Effect.andThen(
            Effect.provideContext(pauseGoal(threadId), store),
            Effect.andThen(sessions.stop(threadId), pullRequests.leadStopped({ threadId })),
          ),
        ),
      UndoTurn: ({ commandId, itemId }) =>
        api(Effect.flatMap(envelope('thread.undo_turn', { itemId }, commandId), (said) => sessions.undoTurn({ envelope: said, itemId }))),
      AnswerStuck: ({ commandId, attentionId, answer }) =>
        api(
          Effect.gen(function* () {
            yield* runs.answerStuck({
              envelope: yield* envelope('attention.answer_stuck', { attentionId, answer }, commandId),
              attentionId,
              answer,
              sender,
            })
          }),
        ),
      AnswerCheckout: ({ commandId, attentionId, answer }) =>
        api(
          Effect.flatMap(envelope('attention.answer_checkout', { attentionId, answer }, commandId), (said) =>
            runs.answerCheckout({ envelope: said, attentionId, answer }),
          ),
        ),
      HandOverHeld: ({ commandId, taskId, agentId, accountId, model }) => {
        const answer = {
          kind: 'retry' as const,
          agentId,
          ...(accountId === undefined ? {} : { accountId }),
          ...(model === undefined ? {} : { model }),
        }
        return api(
          Effect.flatMap(envelope('task.hand_over_held', { taskId, answer }, commandId), (said) =>
            runs.handOverHeld({ envelope: said, taskId, answer }),
          ),
        )
      },
      AnswerQuestion: ({ commandId, attentionId, answers }) =>
        api(
          Effect.gen(function* () {
            const said = yield* envelope('attention.answer_question', { attentionId, answers }, commandId)
            const [on] = yield* sql<{ kind: string | null; automationId: string | null; state: string }>`
                SELECT t.kind, q.state, json_extract(q.payload, '$.automationId') AS automation_id FROM attention_requests q
                LEFT JOIN threads t ON t.id = json_extract(q.payload, '$.threadId')
                WHERE q.id = ${attentionId}`
            // A task's lead or reviewer carries on with the answer once it has a place among the agents at work here (Runs).
            const answer =
              on?.kind === 'coordinator'
                ? Effect.gen(function* () {
                    // Althar asked, not the coordinator: "run it" runs the automation, which takes the question back, and says
                    // why where it still can't; any other answer closes it.
                    if (on.automationId !== null) {
                      // A call already closed, here or by a run that started since, starts nothing. The run that "Run it now"
                      // starts is the record of that answer, and takes the call back; "Leave it" answers it.
                      if (on.state !== 'open') return
                      if (answers.next?.values.includes('run') === true) return yield* automations.runNow(on.automationId, actorId)
                      yield* questions.answer({ envelope: said, attentionId, answers })
                      return
                    }
                    const answered = yield* questions.answer({ envelope: said, attentionId, answers })
                    if (answered.told) return
                    // The coordinator that asked has gone: the answer is told to the one on its thread next.
                    yield* coordinator.say({
                      envelope: yield* Effect.provideContext(
                        Runtime.envelope('thread.send', { threadId: answered.threadId, answered: attentionId }),
                        context,
                      ),
                      threadId: answered.threadId,
                      body: answered.body,
                      disposition: 'after_current',
                      quiet: true,
                    })
                  })
                : runs.answer({ envelope: said, attentionId, answers })
            // A task's question is answered in the task's turn: stopping it comes first, and the question is withdrawn, or
            // after, and the agent the answer started stops.
            const [asked] = yield* sql<{ taskId: string | null }>`SELECT task_id FROM attention_requests WHERE id = ${attentionId}`
            yield* asked === undefined || asked.taskId === null ? answer : tasks.inTurn(asked.taskId, answer)
          }),
        ),
      Answer: ({ commandId, attentionId, decision, reason, always }) =>
        api(
          Effect.gen(function* () {
            yield* permissions.answer({
              envelope: yield* envelope('attention.answer', { attentionId, decision, reason, always }, commandId),
              attentionId,
              decision,
              ...(reason === undefined ? {} : { reason }),
              ...(always === undefined ? {} : { always }),
            })
          }),
        ),
    } satisfies Partial<ApiHandlers>
  })
