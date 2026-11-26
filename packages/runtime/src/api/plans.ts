import {
  type ApiHandlers,
  ApiError,
  workerProblem,
  automaticWorker,
  automaticWorkerUnavailable,
  workerRepositoryLimit,
} from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import { type Crypto, Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../Changes'
import { NotFound } from '../errors'
import { RuntimeConfig } from '../Config'
import { Instance } from '../Instance'
import { Issues } from '../Issues'
import { Projects } from '../Projects'
import { Queries } from '../Queries'
import * as Runtime from '../Runtime'
import { Coordinator } from '../Coordinator'
import { IssueChanges } from '../IssueChanges'
import { IssueDrafts } from '../IssueDrafts'
import { Plans } from '../Plans'
import { Sessions } from '../Sessions'
import { issuesOf, requestOf, type ApiKit } from './kit'

/** What an issue card's Always file at once and Always ask first say: to the coordinator, as the person, and to a task's lead. */
export const text = {
  issuesAtOnce: 'From now on, file and change issues at once, without a card for me first. Keep that as a note.',
  issuesAskFirst: 'From now on, ask me first: each issue, and each change to one, as a card for me to file or apply. Keep that as a note.',
  leadIssuesAtOnce:
    'The person wants issues filed and changed at once from now on: use draft_issue’s file_now and change_issue’s at_once. Each card is the record of it.',
  leadIssuesAskFirst:
    'The person wants to be asked first from now on: each issue, and each change to one, as a card for them to file or apply.',
}

/**
 * A task's plan before and as it starts: starting, holding, changing it, and a draft the coordinator holds.
 * Issues: the drafts and changes the coordinator makes to them, the issues on trackers, and which part of one a task does.
 */
export const plansHandlers = ({ sender, actorId, api, envelope, issueFor }: ApiKit) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<Instance | Crypto.Crypto>()
    const projects = yield* Projects
    const sessions = yield* Sessions
    const queries = yield* Queries
    const plans = yield* Plans
    const issueDrafts = yield* IssueDrafts
    const issueChanges = yield* IssueChanges
    const coordinator = yield* Coordinator
    const instance = yield* Instance
    const sql = yield* SqlClient.SqlClient
    const config = yield* RuntimeConfig
    const issues = yield* Issues
    const pullRequests = yield* Changes
    return {
      StartTask: ({
        commandId,
        projectId,
        title,
        description,
        steps,
        issue: named,
        issues: others,
        end,
        repositories,
        chat,
        taskId,
        workerId,
        artifact,
      }) =>
        api(
          Effect.gen(function* () {
            const all = issuesOf(named, others)
            const issue = all[0]
            const from = yield* issueFor(projectId, issue)
            yield* Effect.forEach(all.slice(1), (one) => issues.read(one, projectId), { concurrency: 4, discard: true })
            const aside = chat === true
            // An artifact has one chat of its own (ADR-104, "Talking to an artifact"): asked again, it is the one open.
            if (aside && artifact !== undefined && artifact.canvasId !== null) {
              const [open] = yield* sql<{ id: string }>`
                  SELECT id FROM tasks WHERE artifact_chat = 1 AND artifact_canvas_id = ${artifact.canvasId}
                    AND project_id = ${projectId} AND state IN ('open', 'draft')
                  ORDER BY created_at DESC LIMIT 1`
              if (open !== undefined) return yield* queries.task(open.id)
            }
            let repositoryLimit: number | undefined
            if (workerId !== undefined) {
              const available = config.workers?.list(projectId) ?? []
              const worker = workerId === 'auto' ? automaticWorker(available, steps) : available.find((one) => one.workerId === workerId)
              const message = aside
                ? 'An aside runs on the home.'
                : workerId === 'auto' && worker === undefined
                  ? automaticWorkerUnavailable
                  : workerProblem(worker, steps)
              if (message !== undefined) return yield* new ApiError({ reason: 'Invalid', message })
              repositoryLimit =
                workerId === 'auto'
                  ? Math.max(
                      1,
                      ...available.filter((one) => workerProblem(one, steps) === undefined).map((one) => workerRepositoryLimit(one, steps)),
                    )
                  : workerRepositoryLimit(worker, steps)
            }

            const created = yield* projects.createTask({
              envelope: yield* envelope('task.create', { projectId, title, description, issue, workerId }, commandId),
              projectId,
              title,
              ...(description === undefined ? {} : { description }),
              draft: true,
              ...(from === undefined ? {} : { issueKey: from.key }),
              ...(repositories === undefined ? {} : { repositories }),
              ...(repositoryLimit === undefined ? {} : { workerRepositoryLimit: repositoryLimit }),
              ...(taskId === undefined ? {} : { taskId }),
              // An aside is made on Scratch, beside the coordinator's conversation, never on the board even for a moment. Its words
              // are the person's, whole, where it was started with them; started with +, they come as its first message.
              ...(aside
                ? {
                    plain: true,
                    shelf: 'scratch' as const,
                    ...(artifact === undefined ? {} : { artifact }),
                    ...(description?.trim() ? { request: description } : {}),
                  }
                : requestOf(title, description, issue)),
            })
            for (const one of all) yield* issues.attach({ projectId: projectId as ProjectId, taskId: created.taskId, issue: one })
            // A task you start yourself is planned like any other, and starts at once; its card shows in the coordinator's thread.
            const projectEnd = aside ? null : yield* pullRequests.endFor(projectId, created.taskId)
            const planId = yield* plans.propose({
              projectId: projectId as ProjectId,
              taskId: created.taskId,
              steps,
              reason: null,
              actorId: actorId,
              startsIn: Duration.zero,
              ...(workerId === undefined ? {} : { held: true }),
              // An aside, as a chat the coordinator starts: nothing of it goes outside the project when it is done; it has its pill
              // rather than a card, and the coordinator hears nothing of it.
              ...(aside
                ? { end: null, here: true, aside: true }
                : {
                    end: end === undefined ? projectEnd : end,
                    // The form sends the ending it shows: another than the project's is the person's choice.
                    ...(end !== undefined && end !== projectEnd ? { endChosen: true } : {}),
                  }),
            })
            yield* plans.start(planId, actorId, workerId)
            return yield* queries.task(created.taskId)
          }),
        ),
      StartPlan: ({ planId, workerId }) => api(Effect.asVoid(plans.start(planId, actorId, workerId))),
      HoldPlan: ({ planId }) => api(plans.hold(planId, actorId)),
      PlacePlan: ({ planId, workerId, chosenAt }) => api(plans.place(planId, workerId, actorId, chosenAt)),
      HoldDraft: ({ threadId, key }) => api(coordinator.holdDraft(threadId, key, actorId)),
      ChangePlan: ({ planId, steps, end, worksIn, toward }) => api(plans.change(planId, steps, actorId, end, worksIn, toward)),
      ChangeIssueDraft: ({ draftId, title, body, labels, priority }) =>
        api(
          issueDrafts.change(
            draftId,
            { title, body, labels, ...(priority === undefined ? {} : { priority: priority ?? 'none' }) },
            actorId,
          ),
        ),
      FileIssueDraft: ({ draftId }) => api(Effect.asVoid(issueDrafts.file(draftId, actorId))),
      DiscardIssueDraft: ({ draftId }) => api(issueDrafts.discard(draftId, actorId)),
      ApplyIssueChanges: ({ changesId }) => api(Effect.asVoid(issueChanges.apply(changesId, actorId))),
      DiscardIssueChanges: ({ changesId }) => api(issueChanges.discard(changesId, actorId)),
      PreferIssueCards: ({ commandId, threadId, atOnce }) =>
        api(
          Effect.gen(function* () {
            // Said to the coordinator as the person said it, from an issue's card: it keeps it as one of the project's notes.
            const [thread] = yield* sql<{ projectId: string; kind: string; taskId: string | null }>`
                SELECT project_id, kind, task_id FROM threads WHERE id = ${threadId}`
            if (thread === undefined) return yield* new NotFound({ kind: 'thread', id: threadId })
            const [home] = yield* sql<{ id: string }>`
                SELECT id FROM threads WHERE project_id = ${thread.projectId} AND kind = 'coordinator' LIMIT 1`
            if (home === undefined) return yield* new NotFound({ kind: 'coordinator thread', id: thread.projectId })
            const body = atOnce ? text.issuesAtOnce : text.issuesAskFirst
            yield* coordinator.say({
              envelope: yield* envelope('thread.send', { threadId: home.id, body, disposition: 'after_current' }, commandId),
              threadId: home.id,
              body,
              disposition: 'after_current',
              sender,
            })
            // A task's lead, where it was said on its card, hears it now: its brief had the notes as they were.
            if (thread.kind === 'task' && thread.taskId !== null) {
              const [open] = yield* sql<{ id: string }>`SELECT id FROM tasks WHERE id = ${thread.taskId} AND state = 'open'`
              if (open !== undefined)
                yield* sessions.send({
                  envelope: yield* Effect.provideContext(
                    Runtime.envelope('thread.send', { threadId, preferIssueCards: atOnce }, undefined, instance.systemId),
                    context,
                  ),
                  threadId,
                  body: atOnce ? text.leadIssuesAtOnce : text.leadIssuesAskFirst,
                  disposition: 'after_current',
                  quiet: true,
                })
            }
          }),
        ),
      // Without an issue named, its first, as the one switch of a runtime before set.
      SetTaskIssuePart: ({ taskId, partOf, issue }) =>
        api(
          Effect.gen(function* () {
            const named = issue ?? (yield* issues.allOfTask(taskId))[0]?.link
            yield* issues.setPart(taskId, partOf, named ?? '')
            // Its open pull request says it in the words trackers read: in the background, as the switch shows it at once.
            yield* pullRequests.issuesChanged(taskId)
          }),
        ),
      ListIssues: ({ projectId }) => api(Effect.map(issues.mine(projectId), (found) => ({ issues: found }))),
    } satisfies Partial<ApiHandlers>
  })
