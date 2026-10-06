import type { ProjectId } from '@althar/domain'
import { Cause, Clock, Duration, Effect, Option, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents, RuntimeConfig } from './Config'
import { envelope } from './envelope'
import { Instance } from './Instance'
import { Live } from './Live'
import { treeCpus } from './processTree'
import { Sessions } from './Sessions'
import { makeStallWatch, spanOf, type StallAction } from './stallWatch'
import { addItem } from './threads'

/*
 * Turns that stall, agents that go round in circles, and work that goes on
 * too long (stallWatch.ts reckons them): Althar looks at every running turn as
 * often as `every`, and acts. A stalled turn is stopped and its agent told to
 * carry on; stalled again, the agent is started afresh on the thread; and
 * again, the person is asked. An agent repeating itself is stopped and told to
 * try another way, then the person is asked. Each thing Althar does says so
 * in the thread.
 *
 * Asking the person is `onGiveUp`'s: a step needs them, as a call. Elsewhere,
 * such as the coordinator's thread, the agent is stopped and the thread says
 * why; there is no budget there, since nothing there runs on its own for long.
 */

export type GiveUp = Extract<StallAction, { _tag: 'GiveUp' }>

/** What a thread says, as each role's agent is started again, when Althar stops it. */
const STARTING_AGAIN: Readonly<Record<string, string>> = {
  task: 'Start the lead again to carry on; it picks up from the thread.',
  coordinator: 'Say something to start the coordinator again; it picks up from the thread.',
  step: 'The review waits; Althar starts the reviewer again when the task resumes.',
}

/** What the agent is told when its turn stalled. */
export const carryingOn = (action: Extract<StallAction, { _tag: 'CarryOn' }>) =>
  [
    `Your last turn showed no sign of work for ${spanOf(action.quietFor)}, so Althar stopped it.`,
    ...(action.tool === null
      ? []
      : [
          `${action.tool.command === null ? action.tool.title : `\`${action.tool.command}\``} was still running. A command that waits for input or doesn't end on its own, such as a watcher, a server or an interactive prompt, holds the turn up: run it so it ends, or in the background.`,
        ]),
    'Carry on with the task from where it stands.',
  ].join(' ')

/** What the agent is told when it repeats itself. */
export const redirecting = (action: Extract<StallAction, { _tag: 'Redirect' }>) =>
  `You ran \`${action.repeated}\` ${action.times} times in a row, and it came out the same each time, so Althar stopped your turn. Running it again won't change that. Try another way; if you can't get further, say what is in the way.`

/**
 * Watches every running turn for as long as the scope lasts. `fresh` starts
 * a thread's budget again, as a step that starts does.
 */
export const watchStalls = <R>(onGiveUp: (giveUp: GiveUp) => Effect.Effect<boolean, never, R>) =>
  Effect.gen(function* () {
    const live = yield* Live
    const sessions = yield* Sessions
    const agents = yield* Agents
    const instance = yield* Instance
    const options = (yield* RuntimeConfig).stalls ?? {}
    const every = options.every ?? Duration.seconds(30)
    const cancelGrace = options.cancelGrace ?? Duration.minutes(1)
    const watch = makeStallWatch({
      quiet: Duration.toMillis(options.quiet ?? Duration.minutes(10)),
      quietInTool: Duration.toMillis(options.quietInTool ?? Duration.minutes(20)),
      cancelGrace: Duration.toMillis(cancelGrace),
      asleepAfter: Duration.toMillis(options.asleepAfter ?? Duration.sum(every, Duration.minutes(1))),
      work: Duration.toMillis(options.work ?? Duration.hours(6)),
      turns: options.turns ?? 40,
      busyShare: 0.05,
    })
    const cpuOf = options.cpuOf ?? treeCpus

    const nameOf = (agentId: string) => agents.list.find((entry) => entry.definition.id === agentId)?.definition.name ?? agentId

    /** The thread, and the agent on it now. */
    const placeOf = (threadId: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [thread] = yield* sql<{ projectId: ProjectId; kind: string }>`SELECT project_id, kind FROM threads WHERE id = ${threadId}`
        const [session] = yield* sql<{ agentId: string; model: string | null; effort: string | null }>`
          SELECT agent_id, model, effort FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at DESC LIMIT 1`
        return thread === undefined || session === undefined ? undefined : { ...thread, ...session, name: nameOf(session.agentId) }
      })

    const say = (projectId: ProjectId, threadId: string, title: string, description?: string) =>
      addItem({ projectId, threadId }, 'notice', {
        source: 'runtime',
        severity: 'warning',
        title,
        about: 'stall',
        ...(description === undefined ? {} : { description }),
      })

    /** Tells the agent something of Althar's, then stops its turn so it hears it now. */
    const stopAndTell = (threadId: string, body: string) =>
      Effect.gen(function* () {
        yield* sessions.send({
          envelope: yield* envelope('thread.send', { threadId, stalled: true }, undefined, instance.systemId),
          threadId,
          body,
          quiet: true,
        })
        // An agent that doesn't stop is started afresh once the grace is over, so this waits no longer than that.
        yield* Effect.ignore(sessions.interrupt(threadId).pipe(Effect.timeout(Duration.sum(cancelGrace, cancelGrace))))
      })

    const giveUp = (action: GiveUp, place: NonNullable<Effect.Success<ReturnType<typeof placeOf>>>) =>
      Effect.gen(function* () {
        const asked = yield* onGiveUp(action)
        // Outside a step, work isn't held to a budget.
        if (!asked && action.why === 'over_budget') return
        // Stalled even after a fresh start, it may be stuck for good: it is stopped.
        if (action.why === 'stalled') {
          if (!asked)
            yield* say(
              place.projectId,
              action.threadId,
              `${place.name} showed no sign of work again after Althar started it afresh, so Althar stopped it.`,
              STARTING_AGAIN[place.kind],
            )
          return yield* Effect.ignore(sessions.stop(action.threadId))
        }
        // One that loops or ran long is working: only its turn stops, so it keeps what it knows for whatever comes next.
        if (!asked)
          yield* say(
            place.projectId,
            action.threadId,
            `${place.name} kept repeating \`${action.detail ?? ''}\`, so Althar stopped its turn.`,
            'Say what to do instead, and it carries on from there.',
          )
        const stopped = yield* sessions.interrupt(action.threadId).pipe(Effect.timeoutOption(cancelGrace), Effect.option)
        if (Option.isNone(stopped) || Option.isNone(stopped.value)) yield* Effect.ignore(sessions.stop(action.threadId))
      })

    const act = (action: StallAction) =>
      Effect.gen(function* () {
        const place = yield* placeOf(action.threadId)
        if (place === undefined) return
        switch (action._tag) {
          case 'CarryOn': {
            const running =
              action.tool === null
                ? ''
                : ` while running ${action.tool.command === null ? action.tool.title : `\`${action.tool.command}\``}`
            yield* say(
              place.projectId,
              action.threadId,
              `${place.name} showed no sign of work for ${spanOf(action.quietFor)}${running}, so Althar stopped its turn and told it to carry on.`,
            )
            return yield* stopAndTell(action.threadId, carryingOn(action))
          }
          case 'Redirect':
            yield* say(
              place.projectId,
              action.threadId,
              `${place.name} ran \`${action.repeated}\` ${action.times} times in a row to the same end, so Althar stopped its turn and told it to try another way.`,
            )
            return yield* stopAndTell(action.threadId, redirecting(action))
          case 'Restart': {
            const restarted = yield* Effect.exit(
              sessions.switchAgent({
                threadId: action.threadId,
                agentId: place.agentId,
                ...(place.model === null ? {} : { model: place.model }),
                ...(place.effort === null ? {} : { effort: place.effort }),
                said:
                  action.why === 'ignored_stop'
                    ? `${place.name} didn't stop its turn when asked, so Althar started it afresh.`
                    : `${place.name} showed no sign of work again, so Althar started it afresh.`,
                about: 'stall',
              }),
            )
            // One that can't start again leaves the person to decide.
            if (restarted._tag === 'Failure')
              yield* giveUp({ _tag: 'GiveUp', threadId: action.threadId, why: 'stalled', detail: null, tried: ['carried_on'] }, place)
            return
          }
          case 'GiveUp':
            return yield* giveUp(action, place)
        }
      }).pipe(Effect.catchCause((cause) => Effect.logWarning(`Could not act on a stalled turn (${action._tag})`, Cause.pretty(cause))))

    const events = yield* live.subscribe
    yield* Effect.forkScoped(
      Stream.runForEach(events, (event) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          for (const action of watch.observe(event, now)) yield* Effect.forkScoped(act(action))
        }),
      ),
    )
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          yield* Effect.sleep(every)
          // Each turn's agent process, and what they've all used, from one listing.
          const pids = new Map<string, number>()
          for (const threadId of watch.turning()) {
            const running = yield* sessions.running(threadId)
            if (Option.isSome(running) && running.value.pid !== null) pids.set(threadId, running.value.pid)
          }
          const used = yield* cpuOf([...pids.values()])
          const now = yield* Clock.currentTimeMillis
          const cpu = (threadId: string) => {
            const pid = pids.get(threadId)
            return pid === undefined ? null : (used.get(pid) ?? null)
          }
          for (const action of watch.look(now, cpu)) yield* Effect.forkScoped(act(action))
        }),
      ),
    )
    return {
      /** Work on the thread starts afresh, as a step does: its budget is whole again. */
      fresh: (threadId: string) => Effect.map(Clock.currentTimeMillis, (now) => watch.fresh(threadId, now)),
    }
  })
