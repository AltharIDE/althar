import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import { Api, ApiError, clientProtocol, emitterPort, type ProjectWorker } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Context, Duration, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import { RpcClient } from 'effect/rpc'
import { until } from '@althar/testing/effect'

import { connection, services } from '../src/Api'
import type { RuntimeOptions } from '../src/Config'
import { Folders } from '../src/Folders'
import { Secrets } from '../src/Secrets'
import { refusalWords, toolRefusalOf } from '../src/toolRefusal'
import { ToolServer, type ToolAccess } from '../src/ToolServer'
import { ToolRefused } from '../src/toolErrors'
import type { EnrolledWorkerState } from '../src/workerExecution'
import { whereaboutsOf } from '../src/workerLookup'
import { words } from '../src/words'

import { callTool, callToolWhole, fakeAgents, fakeConnectors, repository, ROOMY } from './support'

/*
 * Where a task runs, chosen by the coordinator or a lead at every stage, as the person chooses it on a card (ADR-103):
 * as it is drafted and planned (draft_task, propose_plan), and with change_part while it counts down, is held, or is
 * under way; a held one stays held. A worker is found by its name or id among those the project may use, and where one
 * can't be used the answer says why, never that there are none while one is connected. What refuses a tool reaches its
 * agent in the runtime's own words.
 */

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

const HERMES = 'wrk_67912f4efb3c4687837ecf2c384476f5'
const OTHER = 'wrk_' + '2'.repeat(32)
const AWAY = 'wrk_' + '3'.repeat(32)

const READY = {
  sandbox: { starts: true as const },
  tools: [{ name: 'git', version: '2.43.0' }],
  models: [],
  agents: [
    { providerId: 'codex', starts: true },
    { providerId: 'claude-code', starts: true },
  ],
}

const worker = (workerId: string, name: string, busy = false): ProjectWorker => ({
  workerId,
  name,
  providers: ['codex', 'claude-code'],
  busy,
  readiness: READY,
})

const enrolledOf = (
  workerId: string,
  name: string,
  more: { readonly connected?: boolean; readonly projectIds?: ReadonlyArray<string> } = {},
): EnrolledWorkerState => ({
  workerId,
  name,
  connected: more.connected ?? true,
  busy: false,
  providers: ['codex', 'claude-code'],
  projectIds: more.projectIds ?? [],
})

const connected = (
  workers: RuntimeOptions['workers'],
  more: {
    /** A store on disk, and the project's folder, to open again as a home that restarted does. */
    readonly database?: string
    readonly folder?: string
    readonly countdown?: Duration.Duration
  } = {},
) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      services({
        database: more.database ?? ':memory:',
        worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
        appVersion: '0.0.0-test',
        deviceName: 'Test Mac',
        agents: fakeAgents(),
        secrets: Secrets.memory(),
        connectors: fakeConnectors({}),
        accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
        agentsRoot: mkdtempSync(join(tmpdir(), 'althar-agents-')),
        busy: { machine: ROOMY },
        checksAppear: Duration.zero,
        // Long enough that nothing counting down starts while it is looked at, unless a test says.
        countdown: more.countdown ?? Duration.minutes(5),
        ...(workers === undefined ? {} : { workers }),
      }),
    )
    const channel = new MessageChannel()
    yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
    yield* Effect.forkScoped(
      Layer.launch(
        connection(
          emitterPort(channel.port1, (data) => data),
          { kind: 'window' },
        ),
      ).pipe(Effect.provideContext(context)),
    )
    const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
    const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))
    const project = yield* client.OpenProject({
      commandId: commandId(),
      grant: yield* Context.get(context, Folders).allow(more.folder ?? repository()),
    })
    const { threadId } = yield* client.GetCoordinator({ projectId: project.id })
    const coordinator: ToolAccess = { role: 'coordinator', projectId: project.id, threadId, sessionId: 'none', taskId: null }
    const call = (access: ToolAccess, name: string, args: Record<string, unknown>) =>
      callTool(access, name, args).pipe(Effect.provideContext(context))
    /** The task's card in the coordinator's thread, by its title. */
    const card = (title: string) =>
      Effect.map(client.GetCoordinator({ projectId: project.id }), (snapshot) => {
        const item = snapshot.items.find((one) => one.kind === 'task' && one.content.title === title)
        return item?.kind === 'task' ? item.content : null
      })
    /** Drafts a task and plans it, as the coordinator does; its card once its plan shows. */
    const planned = (title: string, more: Record<string, unknown> = {}) =>
      Effect.gen(function* () {
        const slug = title.toLowerCase().replaceAll(' ', '-')
        yield* call(coordinator, 'draft_task', { title })
        const said = yield* call(coordinator, 'propose_plan', { task: slug, lead: { agent: 'codex' }, ...more })
        const shown = yield* until(card(title), (one) => one?.plan != null)
        return { slug, said, planId: shown?.plan?.id ?? '', taskId: shown?.taskId ?? '' }
      })
    return { client, project, coordinator, call, card, planned, context }
  })

describe('placing a task on a worker at every stage', () => {
  it.live('places a plan as it is drafted and proposed, by a worker’s name, its id, or the end of its id', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { call, coordinator, card, planned } = yield* connected({
          list: () => [worker(HERMES, 'hermes-box'), worker(OTHER, 'runner-2')],
          open: () => Effect.die('Nothing starts here'),
        })
        // On propose_plan, by name, any case.
        const first = yield* planned('Raise coverage', { runs_on: 'Hermes-Box' })
        assert.include(first.said, 'It runs on hermes-box.')
        const placed = yield* card('Raise coverage')
        assert.strictEqual(placed?.plan?.runsOn, HERMES)
        assert.strictEqual(placed?.phase, 'planned')
        // On draft_task, by its id: the plan that follows runs there.
        assert.include(yield* call(coordinator, 'draft_task', { title: 'Tidy logs', runs_on: HERMES }), 'Its plan runs on hermes-box.')
        yield* call(coordinator, 'propose_plan', { task: 'tidy-logs', lead: { agent: 'codex' } })
        assert.strictEqual((yield* until(card('Tidy logs'), (one) => one?.plan != null))?.plan?.runsOn, HERMES)
        // By the end of its id, as the window names an unnamed one; and any free worker.
        const short = yield* planned('Short id', { runs_on: '222222' })
        assert.include(short.said, 'It runs on runner-2.')
        const any = yield* planned('Any free', { runs_on: 'any free worker' })
        assert.include(any.said, 'It runs on any free worker.')
        assert.strictEqual((yield* card('Any free'))?.plan?.runsOn, 'auto')
      }),
    ),
  )

  it.live('moves a plan counting down or held with change_part, a held one staying held, and holds one a worker can’t take', () =>
    Effect.scoped(
      Effect.gen(function* () {
        let hermesBusy = false
        const { client, call, coordinator, card, planned } = yield* connected({
          list: () => [worker(HERMES, 'hermes-box', hermesBusy), worker(OTHER, 'runner-2')],
          open: () => Effect.die('Nothing starts here'),
        })
        const counting = yield* planned('Counting down')
        // Counting down: placed, and it still counts down.
        assert.strictEqual(
          yield* call(coordinator, 'change_part', { task: counting.slug, part: 'workspace', runs_on: 'hermes-box', why: 'Asked.' }),
          'counting-down runs on hermes-box when its countdown ends.',
        )
        const placed = yield* card('Counting down')
        assert.strictEqual(placed?.plan?.runsOn, HERMES)
        assert.strictEqual(placed?.phase, 'planned')
        assert.isNotNull(placed?.plan?.startsAt)
        // Held: placed by id, and still held; only where it runs changed.
        yield* client.HoldPlan({ commandId: commandId(), planId: counting.planId })
        assert.strictEqual(
          yield* call(coordinator, 'change_part', { task: counting.slug, part: 'workspace', runs_on: OTHER }),
          'counting-down runs on runner-2 once it starts; it stays held until the person starts it.',
        )
        const held = yield* card('Counting down')
        assert.strictEqual(held?.phase, 'held')
        assert.strictEqual(held?.plan?.runsOn, OTHER)
        assert.strictEqual(held?.plan?.id, counting.planId)
        // Back to the home, held still.
        assert.include(yield* call(coordinator, 'change_part', { task: counting.slug, part: 'workspace', runs_on: 'home' }), 'the home')
        assert.isUndefined((yield* card('Counting down'))?.plan?.runsOn)
        assert.strictEqual((yield* card('Counting down'))?.phase, 'held')
        // Held on a worker at work on another task: placed, held still, and the answer says why it can't start there.
        hermesBusy = true
        assert.strictEqual(
          yield* call(coordinator, 'change_part', { task: counting.slug, part: 'workspace', runs_on: 'hermes-box' }),
          'counting-down runs on hermes-box once it starts; it stays held until the person starts it. It can’t start there as it stands: hermes-box is at work on another task.',
        )
        // Counting down onto that busy worker: held for the person rather than started elsewhere, with why.
        const other = yield* planned('Goes busy')
        assert.strictEqual(
          yield* call(coordinator, 'change_part', { task: other.slug, part: 'workspace', runs_on: 'hermes-box' }),
          'goes-busy is placed on hermes-box, which can’t take it now, so it is held for the person rather than starting: hermes-box is at work on another task.',
        )
        assert.strictEqual((yield* card('Goes busy'))?.phase, 'held')
        // Proposed onto it: held at once, and said so.
        const third = yield* planned('Busy from the start', { runs_on: 'hermes-box' })
        assert.include(third.said, "It is placed on hermes-box, which can't take it as it stands: hermes-box is at work on another task.")
        assert.include(third.said, 'So it is held for the person rather than starting')
        assert.strictEqual((yield* card('Busy from the start'))?.phase, 'held')
      }),
    ),
  )

  it.live('lets a lead place a planned task, keeps where a held plan runs as it is planned again, and says what a draft lacks', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, call, coordinator, card, planned } = yield* connected({
          list: () => [worker(HERMES, 'hermes-box')],
          open: () => Effect.die('Nothing starts here'),
        })
        const task = yield* planned('Led elsewhere')
        const lead: ToolAccess = { ...coordinator, role: 'lead', taskId: task.taskId }
        assert.strictEqual(
          yield* call(lead, 'change_part', { part: 'workspace', runs_on: 'hermes-box', why: 'The person asked.' }),
          'led-elsewhere runs on hermes-box when its countdown ends.',
        )
        assert.strictEqual((yield* card('Led elsewhere'))?.plan?.runsOn, HERMES)
        // Held, and planned again by the coordinator without saying where: it stays where it was placed, and held.
        yield* client.HoldPlan({ commandId: commandId(), planId: task.planId })
        assert.include(
          yield* call(coordinator, 'propose_plan', { task: task.slug, lead: { agent: 'codex' }, review: null }),
          'It runs on hermes-box. It stays held until the person starts it',
        )
        const again = yield* until(card('Led elsewhere'), (one) => one?.plan?.id !== task.planId)
        assert.strictEqual(again?.plan?.runsOn, HERMES)
        assert.strictEqual(again?.phase, 'held')
        // A draft with no plan yet is placed by its plan.
        yield* call(coordinator, 'draft_task', { title: 'Not planned' })
        assert.strictEqual(
          yield* call(coordinator, 'change_part', { task: 'not-planned', part: 'workspace', runs_on: 'hermes-box' }),
          'not-planned has no plan yet: propose_plan with runs_on plans it to run there.',
        )
      }),
    ),
  )

  it.live('says why a worker can’t be used, never that there are none while one is connected', () =>
    Effect.scoped(
      Effect.gen(function* () {
        // The project's id, once it is opened: the home's ledger says which projects each worker may work on.
        let projectId = ''
        // hermes-box is connected and on the project, but hasn't said yet what it runs for it, so the project's list lacks it.
        const {
          call,
          coordinator,
          planned,
          project: opened,
        } = yield* connected({
          list: () => [],
          enrolled: () => [
            enrolledOf(HERMES, 'hermes-box', { projectIds: [projectId] }),
            enrolledOf(OTHER, 'runner-2', { projectIds: [] }),
            enrolledOf(AWAY, 'away-box', { connected: false, projectIds: [projectId] }),
          ],
          open: () => Effect.die('Nothing starts here'),
        })
        projectId = opened.id
        const task = yield* planned('Somewhere')
        const runsOn = (where: string) => call(coordinator, 'change_part', { task: task.slug, part: 'workspace', runs_on: where })
        const name = opened.name
        assert.strictEqual(
          yield* runsOn('hermes-box'),
          `hermes-box is connected and may work on ${name}, but hasn’t offered any agent for it yet. Try again in a moment; where it stays so, restarting Althar’s worker on that box has it say again what it runs.`,
        )
        assert.strictEqual(
          yield* runsOn('runner-2'),
          `runner-2 is connected, but isn’t allowed to work on ${name}. The person ticks ${name} under its projects in Settings › Computers; then try again.`,
        )
        assert.strictEqual(
          yield* runsOn(AWAY),
          'away-box isn’t connected to this home now. Once it is back (its card in Settings › Computers says so), try again; or place it on the home or another worker.',
        )
        const nowhere = yield* runsOn('nowhere')
        assert.strictEqual(
          nowhere,
          `No worker is called nowhere. This home’s workers: hermes-box (connected), runner-2 (connected, not on ${name}), away-box (not connected); or the home.`,
        )
        assert.notInclude(nowhere, 'none connected')
        // propose_plan and draft_task say the same, and draft nothing.
        assert.include(yield* call(coordinator, 'draft_task', { title: 'Never made', runs_on: 'runner-2' }), 'isn’t allowed to work on')
        assert.include(yield* call(coordinator, 'list_tasks', {}), 'somewhere')
        assert.notInclude(yield* call(coordinator, 'list_tasks', {}), 'never-made')
      }),
    ),
  )
})

describe('a task started at once, or drafted, on a worker', () => {
  it.live('starts a task begun at once, or planned, on the worker an agent names, for the coordinator and for a lead', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const opened: Array<string> = []
        const { call, coordinator, context } = yield* connected(
          {
            list: () => [worker(HERMES, 'hermes-box')],
            open: (request) => Effect.sync(() => opened.push(request.workerId)).pipe(Effect.andThen(Effect.die('Seen opening the worker'))),
          },
          { countdown: Duration.seconds(1) },
        )
        const sql = Context.get(context, SqlClient.SqlClient)
        // The coordinator's starts at once, there, and still says nothing of it goes up when it is done.
        const said = yield* call(coordinator, 'start_task', {
          title: 'Look on the box',
          description: 'Check what is there.',
          lead: { agent: 'codex' },
          runs_on: 'hermes-box',
        })
        assert.notInclude(said, 'held')
        assert.include(said, 'nothing goes outside the project when it is done')
        yield* until(
          Effect.sync(() => opened.length),
          (count) => count > 0,
        )
        assert.deepStrictEqual([...new Set(opened)], [HERMES])
        // A lead's goes through its countdown, then starts on the worker too.
        opened.length = 0
        yield* call(coordinator, 'draft_task', { title: 'Its parent' })
        const [parent] = yield* sql<{ id: string }>`SELECT id FROM tasks WHERE slug = 'its-parent'`
        const lead: ToolAccess = { ...coordinator, role: 'lead', taskId: parent?.id ?? '' }
        const fromLead = yield* call(lead, 'start_task', { title: 'Lead looks on the box', lead: { agent: 'codex' }, runs_on: HERMES })
        assert.include(fromLead, 'It runs on hermes-box.')
        yield* until(
          Effect.sync(() => opened.length),
          (count) => count > 0,
        )
        assert.deepStrictEqual([...new Set(opened)], [HERMES])
        // A plan the coordinator placed as it proposed it starts there too, when its countdown ends, and never on the home.
        opened.length = 0
        yield* call(coordinator, 'draft_task', { title: 'Planned for the box' })
        assert.include(
          yield* call(coordinator, 'propose_plan', { task: 'planned-for-the-box', lead: { agent: 'codex' }, runs_on: 'hermes-box' }),
          'It runs on hermes-box.',
        )
        yield* until(
          Effect.sync(() => opened.length),
          (count) => count > 0,
        )
        assert.deepStrictEqual([...new Set(opened)], [HERMES])
      }),
    ),
  )
  it.live('keeps a draft’s worker through a restart, for its first plan, and leaves a later plan where the person put it', () =>
    Effect.gen(function* () {
      const database = join(mkdtempSync(join(tmpdir(), 'althar-store-')), 'althar.db')
      const folder = repository()
      const workers = { list: () => [worker(HERMES, 'hermes-box')], open: () => Effect.die('Nothing starts here') }
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { call, coordinator } = yield* connected(workers, { database, folder })
          assert.include(
            yield* call(coordinator, 'draft_task', { title: 'Across a restart', runs_on: 'hermes-box' }),
            'Its plan runs on hermes-box.',
          )
        }),
      )
      // The home restarted between the draft and its plan: the plan still runs where the draft said.
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { client, call, coordinator, card } = yield* connected(workers, { database, folder })
          assert.include(
            yield* call(coordinator, 'propose_plan', { task: 'across-a-restart', lead: { agent: 'codex' } }),
            'It runs on hermes-box.',
          )
          const first = yield* until(card('Across a restart'), (one) => one?.plan != null)
          assert.strictEqual(first?.plan?.runsOn, HERMES)
          // The person moves it home on its card; planned again, it stays there rather than going back to the draft's worker.
          yield* client.PlacePlan({ commandId: commandId(), planId: first?.plan?.id ?? '', workerId: null })
          yield* call(coordinator, 'propose_plan', { task: 'across-a-restart', lead: { agent: 'codex' }, review: null })
          const again = yield* until(card('Across a restart'), (one) => one?.plan != null && one.plan.id !== first?.plan?.id)
          assert.isUndefined(again?.plan?.runsOn)
        }),
      )
    }),
  )
})

describe('a worker, as an agent names it (workerLookup.ts)', () => {
  const platform = (list: ReadonlyArray<ProjectWorker>, enrolled?: ReadonlyArray<EnrolledWorkerState> | null) => ({
    list: () => list,
    ...(enrolled === undefined ? {} : { enrolled: () => enrolled }),
    open: () => Effect.die('unused'),
  })

  it('finds the home, any free worker, and a worker by its name, id, window name or the end of its id', () => {
    const workers = platform([worker(HERMES, 'hermes-box'), { workerId: OTHER, providers: ['codex'], busy: false }])
    for (const home of ['home', 'This Mac', ' here ', 'local'])
      assert.deepStrictEqual(whereaboutsOf(workers, 'p', home, 'p'), { kind: 'home' })
    for (const any of ['auto', 'Any free worker', 'any']) assert.deepStrictEqual(whereaboutsOf(workers, 'p', any, 'p'), { kind: 'any' })
    const found = (said: string) => {
      const where = whereaboutsOf(workers, 'p', said, 'p')
      return where.kind === 'worker' ? where.worker.workerId : where.kind
    }
    assert.strictEqual(found('hermes-box'), HERMES)
    assert.strictEqual(found('  HERMES-BOX '), HERMES)
    assert.strictEqual(found(HERMES), HERMES)
    assert.strictEqual(found('4476f5'), HERMES)
    assert.strictEqual(found('Linux worker 222222'), OTHER)
    assert.strictEqual(found('222'), 'refused')
  })

  it('names what there is where nobody has that name: none only where the home has no workers', () => {
    const said = (workers: ReturnType<typeof platform> | undefined) => {
      const where = whereaboutsOf(workers, 'p', 'ghost', 'althar')
      return where.kind === 'refused' ? where.message : where.kind
    }
    assert.strictEqual(
      said(undefined),
      'No worker is called ghost: this home has no workers. Place it on the home, or add a worker in Settings › Computers.',
    )
    assert.strictEqual(
      said(platform([worker(HERMES, 'hermes-box')])),
      'No worker is called ghost. This home’s workers: hermes-box; or the home.',
    )
    assert.strictEqual(
      said(platform([worker(HERMES, 'hermes-box')], [enrolledOf(HERMES, 'hermes-box', { projectIds: ['p'] })])),
      'No worker is called ghost. This home’s workers: hermes-box; or the home.',
    )
  })

  it('judges whether a worker may work on the project by the home’s grant, even one whose agents run for any project', () => {
    const wildcard = { ...enrolledOf(OTHER, 'any-box'), anyProject: true }
    const answer = (enrolled: EnrolledWorkerState, said: string) => {
      const where = whereaboutsOf(platform([], [enrolled]), 'p', said, 'althar')
      return where.kind === 'refused' ? where.message : where.kind
    }
    // Not granted this project: the home won't run it there, so it is said to be off it, by name and in the roster.
    assert.include(answer(wildcard, 'any-box'), 'any-box is connected, but isn’t allowed to work on althar.')
    assert.include(answer(wildcard, 'ghost'), 'any-box (connected, not on althar)')
    // Granted it, it may: it hasn't offered its agents for it yet.
    const grantedOne = { ...wildcard, projectIds: ['p'] }
    assert.include(answer(grantedOne, 'any-box'), 'any-box is connected and may work on althar, but hasn’t offered any agent for it yet.')
    assert.include(answer(grantedOne, 'ghost'), 'any-box (connected)')
    assert.notInclude(answer(grantedOne, 'ghost'), 'not on')
  })

  it('takes an exact id over any other name, and refuses a name or end of id that more than one worker answers to', () => {
    const where = (list: ReadonlyArray<ProjectWorker>, said: string, enrolled?: ReadonlyArray<EnrolledWorkerState>) => {
      const found = whereaboutsOf(platform(list, enrolled), 'p', said, 'althar')
      return found.kind === 'worker' ? found.worker.workerId : found.kind === 'refused' ? found.message : found.kind
    }
    // A worker named with another's id, listed first, doesn't take a placement addressed to that id.
    assert.strictEqual(where([worker(HERMES, OTHER), worker(OTHER, 'runner-2')], OTHER), OTHER)
    // Two workers of the same name: neither is picked, and both ids are given to choose by.
    assert.strictEqual(
      where([worker(HERMES, 'box'), worker(OTHER, 'Box')], 'box'),
      `More than one worker answers to box: box (${HERMES}), Box (${OTHER}). Name the one you mean by its id.`,
    )
    assert.strictEqual(where([worker(HERMES, 'box'), worker(OTHER, 'Box')], OTHER), OTHER)
    // Nor two whose ids end alike, nor one in the project's list and one only in the home's ledger.
    const ending = ['wrk_' + 'a'.repeat(26) + '123456', 'wrk_' + 'b'.repeat(26) + '123456']
    assert.include(
      where(
        ending.map((id, at) => worker(id, `w${at}`)),
        '123456',
      ),
      'More than one worker answers to 123456',
    )
    assert.include(
      where([worker(HERMES, 'box')], 'box', [
        enrolledOf(HERMES, 'box', { projectIds: ['p'] }),
        enrolledOf(AWAY, 'box', { connected: false }),
      ]),
      `${HERMES}`,
    )
    assert.include(
      where([worker(HERMES, 'box')], 'box', [
        enrolledOf(HERMES, 'box', { projectIds: ['p'] }),
        enrolledOf(AWAY, 'box', { connected: false }),
      ]),
      'More than one worker answers to box',
    )
  })
})

describe('what a failed tool tells its agent (toolRefusal.ts)', () => {
  class SqlBroke extends Schema.TaggedError<SqlBroke>()('SqlBroke', { message: Schema.String }) {}
  class Silent extends Schema.TaggedError<Silent>()('Silent', {}) {}

  it('says the runtime’s own words: an ApiError’s, a refusal’s, an error’s own message, secrets taken out', () => {
    const invalid = new ApiError({
      reason: 'Invalid',
      message: 'Only a task under way moves. One not started yet runs where its plan places it, and one that ended stays where it ran.',
    })
    assert.strictEqual(words(invalid, (id) => id).message, invalid.message)
    assert.strictEqual(refusalWords(invalid), invalid.message)
    assert.notInclude(refusalWords(invalid), 'ApiError')
    assert.strictEqual(refusalWords(new ToolRefused({ message: 'Name the task.' })), 'Name the task.')
    assert.strictEqual(
      refusalWords(new SqlBroke({ message: 'database is locked' })),
      'Althar could not do that: database is locked. Try again, or tell the person.',
    )
    assert.strictEqual(
      refusalWords(new Error('token ghp_abcdefghijklmnopqrstuvwxyz rejected'), 'Althar could not run the setup'),
      'Althar could not run the setup: token [REDACTED] rejected. Try again, or tell the person.',
    )
    assert.strictEqual(
      refusalWords(new Silent()),
      'Althar could not do that, and what it did is in its log. Try again, or tell the person.',
    )
    const refused = new ToolRefused({ message: 'As it was.' })
    assert.strictEqual(toolRefusalOf(refused), refused)
    assert.strictEqual(toolRefusalOf(invalid).message, invalid.message)
  })

  it.live('reaches the agent from any tool whose failure the tool itself didn’t word', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { coordinator, context } = yield* connected(undefined)
        const invalid = new ApiError({ reason: 'Invalid', message: 'This task has started already, so where it runs can’t change now.' })
        // A credential in a recognised error's words, or in a tool's own refusal, is taken out before the agent reads it.
        const leaky = new ApiError({ reason: 'Invalid', message: 'The host said: token ghp_abcdefghijklmnopqrstuvwxyz is bad.' })
        const refusedLeaky = new ToolRefused({ message: 'Connect with Bearer sk-abcdefghijklmnop0123 again.' })
        yield* Context.get(context, ToolServer).serve('coordinator', [
          { name: 'fails_in_runtime', description: 'Fails.', input: { type: 'object' }, call: () => Effect.fail(invalid as never) },
          { name: 'fails_silently', description: 'Fails.', input: { type: 'object' }, call: () => Effect.die('gone') },
          { name: 'fails_leaking', description: 'Fails.', input: { type: 'object' }, call: () => Effect.fail(leaky as never) },
          { name: 'refuses_leaking', description: 'Fails.', input: { type: 'object' }, call: () => Effect.fail(refusedLeaky) },
          {
            name: 'refuses_naming_a_file',
            description: 'Fails.',
            input: { type: 'object' },
            call: () => Effect.fail(new ToolRefused({ message: '../../etc/passwd:1 isn’t in the pull request’s code.' })),
          },
        ])
        const said = (name: string) => callToolWhole(coordinator, name, {}).pipe(Effect.provideContext(context))
        const failed = yield* said('fails_in_runtime')
        assert.isTrue(failed.isError)
        assert.deepStrictEqual(failed.content, [{ type: 'text', text: invalid.message }])
        assert.deepStrictEqual((yield* said('fails_silently')).content, [
          { type: 'text', text: 'Althar could not do that, and what it did is in its log. Try again, or tell the person.' },
        ])
        assert.deepStrictEqual((yield* said('fails_leaking')).content, [{ type: 'text', text: 'The host said: token [REDACTED] is bad.' }])
        assert.deepStrictEqual((yield* said('refuses_leaking')).content, [{ type: 'text', text: 'Connect with Bearer [REDACTED] again.' }])
        // Words Althar wrote that name a file and line keep them: only what has a credential's shape comes out.
        assert.deepStrictEqual((yield* said('refuses_naming_a_file')).content, [
          { type: 'text', text: '../../etc/passwd:1 isn’t in the pull request’s code.' },
        ])
        // A guard's refusal, which answers before the tool runs, is taken out of too.
        const toolServer = Context.get(context, ToolServer)
        yield* toolServer.serve('coordinator', [
          { name: 'guarded_leaking', description: 'Guarded.', input: { type: 'object' }, call: () => Effect.succeed('ran') },
        ])
        yield* toolServer.guard('coordinator', (tool) =>
          Effect.succeed(tool.name === 'guarded_leaking' ? 'A helper named ghp_abcdefghijklmnopqrstuvwxyz is still at work.' : null),
        )
        assert.deepStrictEqual((yield* said('guarded_leaking')).content, [
          { type: 'text', text: 'A helper named [REDACTED] is still at work.' },
        ])
      }),
    ),
  )

  it.live('reaches the agent from an errand tool whose store fails, with why', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { coordinator, context } = yield* connected(undefined)
        // The errands' table gone from under it: a typed failure inside a real errand tool, not a refusal of its own.
        yield* Context.get(context, SqlClient.SqlClient)`ALTER TABLE errands RENAME TO errands_gone`
        const said = yield* callTool(coordinator, 'read_errands', {}).pipe(Effect.provideContext(context))
        assert.match(said, /^Althar could not keep or read the errand: .+ Try again, or tell the person\.$/su)
      }),
    ),
  )
})
