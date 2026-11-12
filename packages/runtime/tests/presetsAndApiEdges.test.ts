import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MessageChannel } from 'node:worker_threads'

import { Api, ApiError, clientProtocol, emitterPort, type PresetParts } from '@althar/contracts'
import type { ActorId, ProjectId } from '@althar/domain'
import { makeFakeService } from '@althar/connectors/testing'
import { holds } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Context, Duration, Effect, Layer, Option } from 'effect'
import { RpcClient } from 'effect/rpc'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'
import { until } from '@althar/testing/effect'

import { connection, services } from '../src/Api'
import { Busy } from '../src/Busy'
import { offScratch } from '../src/cards'
import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Folders } from '../src/Folders'
import { Instance } from '../src/Instance'
import { LeftBehind } from '../src/LeftBehind'
import { notInstalled, outsideEntries } from '../src/lockOutside'
import { Plans } from '../src/Plans'
import { offerPreset, planFromPreset, type PresetPlan, savePreset } from '../src/presets'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { mergeCopyOf } from '../src/reviewCopy'
import { reviewBrief } from '../src/reviewing'
import * as Runtime from '../src/Runtime'
import { Secrets } from '../src/Secrets'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'

import { callTool, fakeAgents, fakeConnectors, HOST, hosted, onTestClock, repository, ROOMY, runtime } from './support'

/*
 * Presets in Settings, and what a task's menu asks of the runtime besides,
 * through the API as the app's window has it: presets listed, saved from a
 * task or its parts, edited, kept to a project or every one, and removed; a
 * preset the coordinator offers only where none of the person's holds those
 * parts; Run it, Keep together, Drop it, Ship, Merge, Fix it and Scratch on a
 * task, and what each says where there is nothing for it to act on. A chat
 * that moves off Scratch says why; a lead's helpers take four of the places
 * at most, and one that waited for a place carries on after a crash; the
 * sweep for what settled work left spares an open task's idle lead and a
 * review after a merge between its turns. Then what a preset does to a plan,
 * and a few readings it leans on: lockfiles' entries from outside a registry,
 * where a review after a merge reads, and what a trusted outside review's
 * lead is told.
 */

const commandId = () => `cmd_${randomBytes(16).toString('hex')}`

/** The runtime serving the API on one end of a channel, and a client on the other; a project open, with a task. */
const connected = Effect.gen(function* () {
  const channel = new MessageChannel()
  yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
  const github = makeFakeService()
  github.addRepository(['meridian', 'api'])
  const context = yield* Layer.build(
    services({
      database: ':memory:',
      worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
      appVersion: '0.0.0-test',
      deviceName: 'Test Mac',
      agents: fakeAgents(),
      secrets: Secrets.memory(),
      connectors: fakeConnectors({ github }),
      accountsRoot: mkdtempSync(join(tmpdir(), 'althar-accounts-')),
      artifactsRoot: mkdtempSync(join(tmpdir(), 'althar-artifacts-')),
      busy: { machine: ROOMY },
      checksAppear: Duration.zero,
    }),
  )
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
  const grant = (path: string) => Context.get(context, Folders).allow(path)
  /** Reads or writes the runtime's store directly, for what no client does. */
  const store = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.provideContext(context as Context.Context<R>))
  const project = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
  const task = yield* client.CreateTask({
    commandId: commandId(),
    projectId: project.id,
    title: 'Retry checkout',
    description: 'Retry the checkout.\nTwice at most.\nThen give up.\nAnd log it.',
  })
  const { personId, coordinatorId } = Context.get(context, Instance)
  return { client, grant, store, project, task, personId, coordinatorId }
})

/** What a call that can't be done says, as the window shows it. */
const refused = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.flip(effect), (error) => {
    assert.instanceOf(error, ApiError)
    return error instanceof ApiError ? error.message : ''
  })

/** Why a call that can't be done was refused, as the window reads it. */
const reasonOf = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.flip(effect), (error) => (error instanceof ApiError ? error.reason : ''))

const LOCAL: PresetParts = {
  workspace: 'local',
  checked: 'before',
  end: 'ready',
  shelf: 'board',
  lead: 'codex/large',
  reviewer: 'claude-code',
  brief: 'Keep it small.',
}

const CAREFUL: PresetParts = { ...LOCAL, workspace: 'worktree', end: 'draft', lead: null, brief: '' }

describe('presets, through the API', () => {
  it.live('lists the built-in ones, and saves the person’s own from a task or from parts, kept to its project or every one', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, grant, project, task } = yield* connected
        // Settings lists the built-in ones, each in words, kept to no project.
        const builtIn = yield* client.ListPresets({})
        assert.deepStrictEqual(
          builtIn.map((one) => one.name),
          ['Chat', 'Change', 'Small change', 'Review a PR', 'Prototype'],
        )
        assert.strictEqual(
          builtIn.find((one) => one.name === 'Change')?.about,
          'a worktree, reviewed before it ships, a draft pull request, the coordinator picks its lead',
        )
        assert.isTrue(builtIn.every((one) => one.builtin && one.keptTo === undefined && one.from === undefined))

        // From a task with no plan yet: its parts as they stand and its brief's first lines, kept to its project, its name trimmed.
        assert.deepStrictEqual(
          yield* client.SavePreset({ commandId: commandId(), name: '  Retry work  ', taskId: task.id, projectOnly: true }),
          {
            name: 'Retry work',
          },
        )
        // From the same task for every project; and from parts alone, unnamed, which no task keeps to a project.
        yield* client.SavePreset({ commandId: commandId(), name: 'Anywhere', taskId: task.id })
        // Unnamed, it is called Preset, as the call says.
        assert.deepStrictEqual(yield* client.SavePreset({ commandId: commandId(), name: '   ', parts: LOCAL, projectOnly: true }), {
          name: 'Preset',
        })
        const own = (yield* client.ListPresets({ projectId: project.id })).filter((one) => !one.builtin)
        assert.deepStrictEqual(
          own.map((one) => [one.name, one.projectId, one.keptTo, one.from]),
          [
            ['Retry work', project.id, project.name, project.name],
            ['Anywhere', null, undefined, project.name],
            ['Preset', null, undefined, undefined],
          ],
        )
        assert.deepStrictEqual(own[0]?.parts, {
          workspace: 'worktree',
          checked: 'none',
          end: 'none',
          shelf: 'board',
          lead: null,
          reviewer: null,
          brief: 'Retry the checkout.\nTwice at most.\nThen give up.',
        })
        assert.strictEqual(own[2]?.about, 'Local, reviewed before it ships, a pull request ready for review, led by Large')

        // With neither a task nor parts there is nothing to keep, and a task that went has none either: neither is saved.
        assert.strictEqual(
          yield* refused(client.SavePreset({ commandId: commandId(), name: 'Nothing' })),
          'Say which task, or what parts, to keep.',
        )
        assert.strictEqual(
          yield* refused(client.SavePreset({ commandId: commandId(), name: 'Gone', taskId: 'task_gone' })),
          "That task isn't there any more.",
        )

        // Another project has those for every project, never one kept to the first; Settings, naming none, has them all.
        const other = yield* client.OpenProject({ commandId: commandId(), grant: yield* grant(repository()) })
        assert.deepStrictEqual(
          (yield* client.ListPresets({ projectId: other.id })).filter((one) => !one.builtin).map((one) => one.name),
          ['Anywhere', 'Preset'],
        )
        assert.deepStrictEqual(
          (yield* client.ListPresets({})).filter((one) => !one.builtin).map((one) => one.name),
          ['Retry work', 'Anywhere', 'Preset'],
        )
      }),
    ),
  )

  it.live('edits one of the person’s own as Settings does, never a built-in one, nor onto a name another has in the same place', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, project, task } = yield* connected
        yield* client.SavePreset({ commandId: commandId(), name: 'Quick', taskId: task.id })
        yield* client.SavePreset({ commandId: commandId(), name: 'Careful', parts: CAREFUL })
        const mine = Effect.map(client.ListPresets({}), (all) => all.filter((one) => !one.builtin))
        const [quick, careful] = yield* mine
        const id = quick?.id ?? ''

        // Renamed and its parts changed, it stays where it was kept.
        yield* client.EditPreset({ commandId: commandId(), id, name: '  Quick fix ', parts: LOCAL })
        const [renamed] = yield* mine
        assert.deepInclude(renamed, { id, name: 'Quick fix', parts: LOCAL, projectId: null, from: project.name })
        // Kept to the project of the task it came from; asked again, it stays there; then it is every project's again.
        yield* client.EditPreset({ commandId: commandId(), id, name: 'Quick fix', parts: LOCAL, projectOnly: true })
        assert.deepInclude((yield* mine)[0], { projectId: project.id, keptTo: project.name })
        yield* client.EditPreset({ commandId: commandId(), id, name: 'Quick fix', parts: LOCAL, projectOnly: true })
        assert.deepInclude((yield* mine)[0], { projectId: project.id, keptTo: project.name })
        yield* client.EditPreset({ commandId: commandId(), id, name: 'Quick fix', parts: LOCAL, projectOnly: false })
        assert.strictEqual((yield* mine)[0]?.projectId, null)

        // Another of the person's every-project presets has that name, in any case: refused, and nothing changes.
        assert.strictEqual(
          yield* refused(client.EditPreset({ commandId: commandId(), id, name: 'CAREFUL', parts: CAREFUL })),
          'Another preset is called CAREFUL.',
        )
        assert.strictEqual((yield* mine)[0]?.name, 'Quick fix')
        // Kept to the project, it may share the name of one for every project.
        yield* client.EditPreset({ commandId: commandId(), id, name: 'Careful', parts: LOCAL, projectOnly: true })
        assert.deepStrictEqual(
          (yield* mine).map((one) => [one.name, one.projectId]),
          [
            ['Careful', project.id],
            ['Careful', null],
          ],
        )
        // With its name cleared, it is called Preset.
        yield* client.EditPreset({ commandId: commandId(), id: careful?.id ?? '', name: '  ', parts: CAREFUL })
        assert.strictEqual((yield* mine)[1]?.name, 'Preset')

        // A built-in one stays as it is, as does one that isn't there.
        const chat = (yield* client.ListPresets({}))[0]
        assert.strictEqual(
          yield* refused(client.EditPreset({ commandId: commandId(), id: chat?.id ?? '', name: 'Talk', parts: LOCAL })),
          "That preset isn't there any more.",
        )
        assert.deepStrictEqual((yield* client.ListPresets({}))[0], chat)
        assert.strictEqual(
          yield* reasonOf(client.EditPreset({ commandId: commandId(), id: 'pst_gone', name: 'Gone', parts: LOCAL })),
          'NotFound',
        )
      }),
    ),
  )

  it.live('removes one of the person’s own, never a built-in one, and lists none whose parts it can no longer read', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, store, project, personId } = yield* connected
        yield* client.SavePreset({ commandId: commandId(), name: 'Soon gone', parts: LOCAL })
        yield* client.SavePreset({ commandId: commandId(), name: 'Garbled', parts: CAREFUL })
        // Kept to the project as the coordinator's offer does, from no task: the project it is kept to is the one it can be.
        yield* store(savePreset({ name: 'Here only', parts: CAREFUL, projectId: project.id, fromTaskId: null, actorId: personId }))
        const mine = Effect.map(client.ListPresets({ projectId: project.id }), (all) => all.filter((one) => !one.builtin))
        const before = yield* mine
        assert.deepInclude(before[2], { name: 'Here only', projectId: project.id, keptTo: project.name, from: project.name })

        yield* client.RemovePreset({ commandId: commandId(), id: before[0]?.id ?? '' })
        yield* client.RemovePreset({ commandId: commandId(), id: 'builtin:chat' })
        assert.deepStrictEqual(
          (yield* mine).map((one) => one.name),
          ['Garbled', 'Here only'],
        )
        assert.strictEqual((yield* client.ListPresets({}))[0]?.name, 'Chat')
        // Parts written by another version, which this one can't read, leave it out of the list rather than fail it.
        yield* store(
          Effect.flatMap(SqlClient.SqlClient, (sql) => sql`UPDATE presets SET parts = '{"workspace":"moon"}' WHERE name = 'Garbled'`),
        )
        assert.deepStrictEqual(
          (yield* mine).map((one) => one.name),
          ['Here only'],
        )
      }),
    ),
  )
})

describe('a preset a task’s card offers', () => {
  /** Tasks planned with these steps by whoever proposed them, each started: the newest last. */
  const started = (
    { client, store, project }: Effect.Success<typeof connected>,
    proposer: ActorId,
    steps: ReadonlyArray<{ key: 'implement' | 'review'; agentId: string; model: string | null; skipped: boolean }>,
    titles: ReadonlyArray<string>,
    end: 'draft' | 'ready' | null = null,
  ) =>
    Effect.forEach(titles, (title) =>
      Effect.gen(function* () {
        const one = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title })
        yield* store(
          Effect.gen(function* () {
            const plans = yield* Plans
            yield* plans.propose({
              projectId: project.id as ProjectId,
              taskId: one.id,
              steps,
              reason: null,
              actorId: proposer,
              held: true,
              end,
            })
            // Started, without running it: the offer looks at started plans.
            const sql = yield* SqlClient.SqlClient
            yield* sql`UPDATE task_plans SET state = 'accepted' WHERE task_id = ${one.id}`
          }),
        )
        return one.id
      }),
    )
  const CODEX_ALONE = [{ key: 'implement', agentId: 'codex', model: 'large', skipped: false }] as const
  const offerOn = (made: Effect.Success<typeof connected>, taskId: string) =>
    Effect.gen(function* () {
      yield* made.store(
        offerPreset({ projectId: made.project.id as ProjectId, taskId, personId: made.personId, actorId: made.coordinatorId }),
      )
      const coordinator = yield* made.client.GetCoordinator({ projectId: made.project.id })
      const card = coordinator.items.find((item) => item.kind === 'task' && item.content.taskId === taskId)
      return card?.kind === 'task' ? card.content.presetOffer : undefined
    })

  it.live('never counts the coordinator’s plans, however alike, and offers the person’s own parts the third time', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const made = yield* connected
        // The coordinator planned three alike, and the person changed none: nothing of theirs to keep.
        const theirs = yield* started(made, made.coordinatorId, CODEX_ALONE, ['Bump a', 'Bump b', 'Bump c'])
        assert.isUndefined(yield* offerOn(made, theirs[2] ?? ''))
        // The person set them up twice: not yet; the third time, by a name in plain words.
        const mine = yield* started(made, made.personId, CODEX_ALONE, ['Fix a', 'Fix b'])
        assert.isUndefined(yield* offerOn(made, mine[1] ?? ''))
        const [third] = yield* started(made, made.personId, CODEX_ALONE, ['Fix c'])
        const offer = yield* offerOn(made, third ?? '')
        assert.deepInclude(offer, { name: 'No review, no PR' })
        assert.deepInclude(offer?.parts, { workspace: 'worktree', checked: 'none', end: 'none', lead: 'codex/large' })

        // Kept from it, by the name the person gave: the card says so, and Undo offers it again.
        yield* made.client.SavePreset({ commandId: commandId(), name: 'Codex alone', parts: offer?.parts, taskId: third })
        const kept = yield* offerOn(made, third ?? '')
        assert.strictEqual(kept?.kept?.name, 'Codex alone')
        yield* made.client.RemovePreset({ commandId: commandId(), id: kept?.kept?.id ?? '' })
        assert.isUndefined((yield* offerOn(made, third ?? ''))?.kept)

        // Not to be offered again: the card stops, and a fourth alike isn't offered them.
        yield* made.client.DeclinePresetOffer({ commandId: commandId(), taskId: third ?? '' })
        assert.isUndefined(yield* offerOn(made, third ?? ''))
        const [fourth] = yield* started(made, made.personId, CODEX_ALONE, ['Fix d'])
        assert.isUndefined(yield* offerOn(made, fourth ?? ''))
      }),
    ),
  )

  it.live('names the built-in preset parts nearly are, and offers none for parts a preset has', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const made = yield* connected
        // Prototype as it is: nothing new to keep.
        const opus = [{ key: 'implement', agentId: 'claude-code', model: 'claude-opus-5-5', skipped: false }] as const
        const prototypes = yield* started(made, made.personId, opus, ['Try a', 'Try b', 'Try c'])
        assert.isUndefined(yield* offerOn(made, prototypes[2] ?? ''))
        // Prototype but for its pull request: it says so, rather than offer another.
        const near = yield* started(made, made.personId, opus, ['Ship a', 'Ship b', 'Ship c'], 'ready')
        assert.deepInclude((yield* offerOn(made, near[2] ?? ''))?.near, {
          preset: 'Prototype',
          differs: 'ending in a pull request ready for review',
        })
        // One of the person’s holds these parts, led by the same model: nothing to offer.
        yield* made.client.SavePreset({
          commandId: commandId(),
          name: 'Sonnet alone',
          parts: { workspace: 'worktree', checked: 'none', end: 'none', shelf: 'board', lead: 'codex/small', reviewer: null, brief: '' },
        })
        const small = [{ key: 'implement', agentId: 'codex', model: 'small', skipped: false }] as const
        const held = yield* started(made, made.personId, small, ['Tidy a', 'Tidy b', 'Tidy c'])
        assert.isUndefined(yield* offerOn(made, held[2] ?? ''))
      }),
    ),
  )
})

describe('a task’s menu, through the API, with nothing for it to act on', () => {
  it.live('says Run it has nothing to run on a task that reviews no pull request, however far the person trusts it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, task } = yield* connected
        const nothing = 'This task reviews no pull request, so there’s nothing to run.'
        assert.strictEqual(yield* refused(client.RunIt({ commandId: commandId(), taskId: task.id })), nothing)
        assert.strictEqual(yield* refused(client.RunIt({ commandId: commandId(), taskId: task.id, how: 'safe' })), nothing)
      }),
    ),
  )

  it.live('refuses to keep together or drop a change the task doesn’t have, into its first change or one named', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, task } = yield* connected
        // In the tools' own words, as a refusal and not a failure.
        assert.strictEqual(yield* reasonOf(client.JoinChanges({ commandId: commandId(), taskId: task.id, change: 'web' })), 'ToolRefused')
        assert.match(
          yield* refused(client.JoinChanges({ commandId: commandId(), taskId: task.id, change: 'web' })),
          /^The task has no change “web” here/,
        )
        assert.strictEqual(
          yield* reasonOf(client.JoinChanges({ commandId: commandId(), taskId: task.id, change: 'web', into: 'api' })),
          'ToolRefused',
        )
        assert.strictEqual(yield* reasonOf(client.DropChange({ commandId: commandId(), taskId: task.id, change: 'web' })), 'ToolRefused')
      }),
    ),
  )

  it.live('puts a task on Scratch and back on the board, says so of one that went, and stops no helper it never started', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, store, task } = yield* connected
        const shelf = store(
          Effect.flatMap(SqlClient.SqlClient, (sql) => sql<{ shelf: string | null }>`SELECT shelf FROM tasks WHERE id = ${task.id}`),
        )
        yield* client.ShelveTask({ commandId: commandId(), taskId: task.id, shelf: 'scratch' })
        assert.strictEqual((yield* shelf)[0]?.shelf, 'scratch')
        yield* client.ShelveTask({ commandId: commandId(), taskId: task.id, shelf: null })
        assert.isNull((yield* shelf)[0]?.shelf ?? null)
        assert.strictEqual(
          yield* refused(client.ShelveTask({ commandId: commandId(), taskId: 'task_gone', shelf: 'scratch' })),
          "That task isn't there any more.",
        )
        // A helper it never started: nothing stops, and its thread says nothing of one.
        const before = (yield* client.GetThread({ threadId: task.threadId })).items.length
        yield* client.StopHelper({ commandId: commandId(), taskId: task.id, helper: 'thr_none' })
        assert.strictEqual((yield* client.GetThread({ threadId: task.threadId })).items.length, before)
      }),
    ),
  )

  it.live('moves a task with nothing at work to Local at once, works toward its default branch or one that exists, and drops no move', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, task } = yield* connected
        assert.deepStrictEqual(
          yield* client.MoveTask({
            commandId: commandId(),
            taskId: task.id,
            to: 'checkout',
            change: null,
            consent: { branch: null, head: 'a'.repeat(40) },
          }),
          { kind: 'moved' },
        )
        assert.deepStrictEqual(yield* client.MoveTask({ commandId: commandId(), taskId: task.id, to: 'worktree' }), { kind: 'moved' })
        assert.strictEqual(
          yield* refused(client.MoveTask({ commandId: commandId(), taskId: 'task_gone', to: 'checkout' })),
          "That task isn't there any more.",
        )
        // Nothing waits to move, so there is nothing to call off.
        yield* client.DropMove({ commandId: commandId(), taskId: task.id })
        assert.deepStrictEqual(yield* client.WorkToward({ commandId: commandId(), taskId: task.id, toward: null }), [])
        assert.match(
          yield* refused(client.WorkToward({ commandId: commandId(), taskId: task.id, toward: 'release' })),
          /has no branch release, on its remote or here\.$/,
        )
      }),
    ),
  )

  it.live('ships nothing where nothing waits, a change named or not, and merges nothing where no pull request is open', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, task } = yield* connected
        assert.strictEqual(yield* refused(client.Ship({ commandId: commandId(), taskId: task.id })), 'Nothing waits to ship.')
        assert.strictEqual(
          yield* refused(client.Ship({ commandId: commandId(), taskId: task.id, change: 'api' })),
          'Nothing waits to ship.',
        )
        // Merged at the head the person saw: there's no pull request to merge.
        assert.strictEqual(yield* reasonOf(client.Merge({ commandId: commandId(), taskId: task.id, head: 'a'.repeat(40) })), 'NotFound')
        // Review and merge, or Merge now, with nothing waiting and nothing open: nothing goes up, and the task stays as it was.
        yield* client.Merge({ commandId: commandId(), taskId: task.id, head: 'a'.repeat(40), how: 'review' })
        yield* client.Merge({
          commandId: commandId(),
          taskId: task.id,
          head: 'a'.repeat(40),
          how: 'now',
          url: `${HOST}/meridian/api/pull/1`,
        })
        const [after] = (yield* client.ListTasks({ projectId: task.projectId })).tasks
        assert.deepInclude(after, { id: task.id, state: task.state, branch: task.branch })
      }),
    ),
  )

  it.live('Fix it sends what a review after a merge found to the lead, of the pull request named or the latest', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, store, project, task } = yield* connected
        const at = new Date().toISOString()
        const found = (number: number) =>
          Effect.flatMap(
            SqlClient.SqlClient,
            (sql) =>
              sql`INSERT INTO merge_reviews ${sql.insert({
                url: `${HOST}/meridian/api/pull/${number}`,
                taskId: task.id,
                projectId: project.id,
                number,
                state: 'found',
                findings: JSON.stringify([{ severity: 'major', file: 'src/retry.ts', line: 4, claim: 'It retries forever.' }]),
                createdAt: at,
                updatedAt: at,
              })}`,
          )
        yield* store(found(1))
        yield* store(found(2))
        const states = store(
          Effect.flatMap(
            SqlClient.SqlClient,
            (sql) => sql<{ number: number; state: string }>`SELECT number, state FROM merge_reviews ORDER BY number`,
          ),
        )
        // Named, that one is fixed; not named, the latest waiting.
        yield* client.FixAfterMerge({ commandId: commandId(), taskId: task.id, url: `${HOST}/meridian/api/pull/1` })
        assert.deepStrictEqual(
          (yield* states).map((one) => [one.number, one.state]),
          [
            [1, 'fixing'],
            [2, 'found'],
          ],
        )
        yield* client.FixAfterMerge({ commandId: commandId(), taskId: task.id })
        assert.deepStrictEqual(
          (yield* states).map((one) => one.state),
          ['fixing', 'fixing'],
        )
        const thread = yield* until(client.GetThread({ threadId: task.threadId }), (one) =>
          one.items.some((item) => item.kind === 'notice' && String(item.content.title).includes('after #2 merged')),
        )
        assert.deepStrictEqual(
          thread.items
            .flatMap((item) => (item.kind === 'notice' ? [item.content.title] : []))
            .filter((title) => title.startsWith('Fix it')),
          [
            'Fix it: the lead takes the 1 finding after #1 merged, and its fix goes out after it.',
            'Fix it: the lead takes the 1 finding after #2 merged, and its fix goes out after it.',
          ],
        )
        // With none left found, there is nothing to fix.
        assert.strictEqual(
          yield* refused(client.FixAfterMerge({ commandId: commandId(), taskId: task.id })),
          'No review after a merge waits on you here.',
        )
      }),
    ),
  )
})

describe('a chat on Scratch, moving to the board', () => {
  it.live('says it has a pull request, or drafted a review, once it has one since it was put there', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, store, project, task, personId } = yield* connected
        yield* client.ConnectToken({ commandId: commandId(), product: 'github', webUrl: HOST, token: 'ghp_x' })
        const draft = yield* client.CreateTask({ commandId: commandId(), projectId: project.id, title: 'Review #12' })
        for (const one of [task, draft]) yield* client.ShelveTask({ commandId: commandId(), taskId: one.id, shelf: 'scratch' })
        // Since: after it was shelved, by the store's clock.
        const since = new Date(Date.now() + 60_000).toISOString()
        const hex = () => randomBytes(16).toString('hex')
        yield* store(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const [connection] = yield* sql<{ id: string }>`SELECT id FROM connections LIMIT 1`
            yield* sql`INSERT INTO external_links ${sql.insert({
              id: `xlink_${hex()}`,
              projectId: project.id,
              taskId: task.id,
              connectionId: connection?.id ?? null,
              product: 'github',
              kind: 'change',
              externalId: '7',
              ref: 'meridian/api#7',
              key: 'meridian/api#7',
              url: `${HOST}/meridian/api/pull/7`,
              createdAt: since,
              updatedAt: since,
            })}`
            yield* sql`INSERT INTO review_drafts ${sql.insert({
              id: `rdr_${hex()}`,
              projectId: project.id,
              taskId: draft.id,
              threadId: draft.threadId,
              connectionId: connection?.id ?? '',
              product: 'github',
              repository: 'meridian/api',
              number: 12,
              url: `${HOST}/meridian/api/pull/12`,
              title: 'Retry the checkout',
              author: 'ana',
              outside: 0,
              headCommit: 'a'.repeat(40),
              suggested: 'comment',
              summary: 'Fine.',
              state: 'pending',
              draftedByActorId: personId,
              createdAt: since,
              updatedAt: since,
            })}`
          }),
        )
        yield* store(offScratch(task.id))
        yield* store(offScratch(draft.id))
        const said = (threadId: string) =>
          Effect.map(client.GetThread({ threadId }), (thread) =>
            thread.items.flatMap((item) =>
              item.kind === 'notice' && item.content.title.startsWith('On the board') ? [item.content.title] : [],
            ),
          )
        assert.deepStrictEqual(yield* said(task.threadId), ['On the board now: it has a pull request.'])
        assert.deepStrictEqual(yield* said(draft.threadId), ['On the board now: it drafted a review.'])
        const shelves = yield* store(
          Effect.flatMap(
            SqlClient.SqlClient,
            (sql) => sql<{ shelf: string | null }>`SELECT shelf FROM tasks WHERE project_id = ${project.id}`,
          ),
        )
        assert.isTrue(shelves.every((one) => one.shelf === null))
      }),
    ),
  )
})

describe('an aside, started by the person', () => {
  it.live('sits on Scratch with no card in the coordinator’s conversation, opens with their words, and is noted there once it leaves', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, store, project } = yield* connected
        const words = 'Why does the retry back off twice?\n\nIt feels slow when Stripe is down.'
        const aside = yield* client.StartTask({
          commandId: commandId(),
          projectId: project.id,
          title: 'Why does the retry back off twice?',
          description: words,
          steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
          chat: true,
        })
        const thread = yield* client.GetThread({ threadId: aside.threadId })
        assert.isTrue(thread.task.scratch)
        assert.strictEqual(thread.task.request, words)
        const coordinator = () => client.GetCoordinator({ projectId: project.id })
        const cards = (yield* coordinator()).items.filter((item) => item.kind === 'task')
        assert.isFalse(cards.some((item) => item.kind === 'task' && item.content.taskId === aside.id))
        // Nothing of it goes outside the project when it is done: it is quick, as a chat the coordinator starts.
        const [kind] = yield* store(
          Effect.flatMap(
            SqlClient.SqlClient,
            (sql) =>
              sql<{ plain: number; here: number | null }>`
                SELECT (SELECT count(*) FROM workspaces w WHERE w.task_id = k.id AND w.branched_at IS NOT NULL) = 0 AS plain,
                  (SELECT json_extract(p.parameters, '$.here') FROM task_plans p WHERE p.task_id = k.id) AS here
                FROM tasks k WHERE k.id = ${aside.id}`,
          ),
        )
        assert.deepStrictEqual(kind, { plain: 1, here: 1 })
        // Moved to the board, by the person or by itself, the coordinator's conversation says so in a line.
        yield* client.ShelveTask({ commandId: commandId(), taskId: aside.id, shelf: null })
        const lines = (yield* coordinator()).items.flatMap((item) =>
          item.kind === 'notice' && item.content.title.startsWith('An aside') ? [item.content.title] : [],
        )
        assert.deepStrictEqual(lines, ['An aside became a task: Why does the retry back off twice?'])
      }),
    ),
  )
})

describe('a lead’s helpers, among the agents at work', () => {
  it.live(
    'hold a place each while their turns run, four of a task’s at once with the fifth waiting for one, which carries on after a crash',
    () => {
      const { working, bare } = hosted()
      const github = makeFakeService({ pushUrl: () => bare })
      github.addRepository(['meridian', 'api'])
      const place = holds()
      const file = join(mkdtempSync(join(tmpdir(), 'althar-helpers-')), 'althar.sqlite')
      const launch = () =>
        Queries.layer.pipe(
          Layer.provideMerge(runtime(file, { holds: place }, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
        )
      const helpersOf = (taskId: string) =>
        Effect.flatMap(
          SqlClient.SqlClient,
          (sql) => sql<{ threadId: string; state: string }>`
            SELECT thread_id, state FROM helpers WHERE task_id = ${taskId} ORDER BY started_at, rowid`,
        )
      const turning = (threadIds: ReadonlyArray<string>) =>
        until(
          Effect.forEach(threadIds, (threadId) =>
            Effect.flatMap(Sessions, (sessions) =>
              Effect.map(sessions.running(threadId), (live) => Option.isSome(live) && live.value.turnRunning),
            ),
          ),
          (all) => all.every(Boolean),
        )
      const placed = Effect.flatMap(Busy, (busy) =>
        Effect.map(busy.now, (now) => now.holders.flatMap((holder) => (holder.helper === undefined ? [] : [holder.helper]))),
      )
      const waits = (threadId: string) =>
        Effect.flatMap(
          SqlClient.SqlClient,
          (sql) => sql<{ since: string | null }>`SELECT waits_for_place AS since FROM threads WHERE id = ${threadId}`,
        )
      return Effect.gen(function* () {
        const { taskId, four, fifth, since } = yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const sessions = yield* Sessions
          const instance = yield* Instance
          // A task whose lead made its change and is idle now.
          yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
          const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
          const coordinator = yield* Coordinator
          const threadId = yield* coordinator.thread(project.projectId)
          const body = 'Add a retry. [coordinator:plan] [coordinator:plan-no-review] [lead:finish] [lead:edit]'
          yield* coordinator.say({
            envelope: yield* Runtime.envelope('thread.send', { body }),
            threadId,
            body,
            disposition: 'after_current',
          })
          const cards = Effect.map(Effect.orDie((yield* Queries).coordinator(project.projectId)), (snapshot) =>
            snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : [])),
          )
          const [card] = yield* until(cards, (all) => all[0]?.phase === 'ready' && all[0].change !== null)
          const task = card ?? assert.fail('no card')
          yield* until(sessions.busy(task.threadId), (busy) => !busy)
          const [lead] = yield* sql<{ id: string }>`
            SELECT id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at DESC LIMIT 1`
          const access: ToolAccess = {
            role: 'lead',
            projectId: project.projectId,
            threadId: task.threadId,
            sessionId: lead?.id ?? '',
            taskId: task.taskId,
          }

          // Four helpers, each in a copy of its own, held at work: each holds a place of its own while its turn runs.
          for (const name of ['One', 'Two', 'Three', 'Four'])
            yield* callTool(access, 'start_helper', { name, brief: 'Look around. [lead:slowly]', in_copy: true })
          const four = (yield* until(helpersOf(task.taskId), (rows) => rows.length === 4)).map((one) => one.threadId)
          yield* turning(four)
          assert.sameMembers(yield* placed, four)

          // A fifth waits for a place, however many are free: a task's helpers take four at most at once.
          yield* callTool(access, 'start_helper', { name: 'Five', brief: 'Look around. [lead:slowly]', in_copy: true })
          const fifth = (yield* until(helpersOf(task.taskId), (rows) => rows.length === 5))[4]?.threadId ?? ''
          const [waited] = yield* until(waits(fifth), (rows) => rows[0]?.since != null)
          assert.notInclude(yield* placed, fifth)

          // The sweep for what settled work left leaves the idle lead of a task still open.
          yield* (yield* LeftBehind).sweep
          assert.isTrue(Option.isSome(yield* sessions.running(task.threadId)))
          return { taskId: task.taskId, four, fifth, since: waited?.since ?? '' }
        }).pipe(Effect.provide(launch()))

        // Althar was killed meanwhile, so the fifth's thread still says since when it waits, and nothing recorded an end.
        const db = new DatabaseSync(file)
        db.prepare('UPDATE threads SET waits_for_place = ? WHERE id = ?').run(since, fifth)
        db.exec('UPDATE runtime_instances SET ended_at = NULL WHERE rowid = (SELECT max(rowid) FROM runtime_instances)')
        db.close()
        // It starts again, and still four of the task's helpers are at work at once: whichever have a place first, the fifth, which
        // waited longest, among them where it takes one before the four ask again. None of their work is lost: all five report.
        yield* Effect.gen(function* () {
          const all = [...four, fifth]
          const turns = Effect.forEach(all, (threadId) =>
            Effect.flatMap(Sessions, (sessions) =>
              Effect.map(sessions.running(threadId), (live) => Option.isSome(live) && live.value.turnRunning),
            ),
          )
          yield* until(turns, (now) => now.filter(Boolean).length === 4)
          assert.lengthOf(yield* placed, 4)
          place.open('[lead:slowly]')
          const done = yield* until(helpersOf(taskId), (rows) => rows.every((one) => one.state === 'done'))
          assert.lengthOf(done, 5)
        }).pipe(Effect.provide(launch()))
      })
    },
  )
})

describe('a review after a merge, between its turns', () => {
  it.effect(
    'is spared by the sweep for what settled work left, though its task settled and it has been idle past the sweep’s while',
    () => {
      const { working, bare } = hosted()
      const github = makeFakeService({ pushUrl: () => bare })
      github.addRepository(['meridian', 'api'])
      const git = (cwd: string, ...args: Array<string>) => execFileSync('git', args, { cwd }).toString().trim()
      git(working, 'config', 'user.name', 'Fake')
      git(working, 'config', 'user.email', 'fake@althar.test')
      const place = holds()
      return Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const sessions = yield* Sessions
        const instance = yield* Instance
        // A small change, its pull request open, reviewed only once it merges: by a reviewer that works until it is stopped.
        yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
        const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
        const coordinator = yield* Coordinator
        const threadId = yield* coordinator.thread(project.projectId)
        const body = 'Add a retry. [coordinator:plan] [coordinator:plan-small] [lead:finish] [lead:edit] [review:wait]'
        yield* coordinator.say({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body, disposition: 'after_current' })
        const cards = Effect.map(Effect.orDie((yield* Queries).coordinator(project.projectId)), (snapshot) =>
          snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : [])),
        )
        const [card] = yield* until(cards, (all) => all[0]?.change != null && all[0].change.state === 'open')
        const taskId = card?.taskId ?? assert.fail('no card')
        // The host squashes it into main, and Althar hears it merged: the task settles, and its reviewer reads what merged.
        const clone = mkdtempSync(join(tmpdir(), 'althar-merge-'))
        execFileSync('git', ['clone', '-q', bare, clone])
        git(clone, '-c', 'user.name=Host', '-c', 'user.email=host@althar.test', 'merge', '-q', '--squash', 'origin/althar/add-a-retry')
        git(clone, '-c', 'user.name=Host', '-c', 'user.email=host@althar.test', 'commit', '-q', '-m', 'Squashed')
        git(clone, 'push', '-q', 'origin', 'main')
        github.mergeByHand(1)
        yield* (yield* Changes).refresh(taskId)
        const review = sql<{ state: string }>`SELECT state FROM merge_reviews WHERE task_id = ${taskId}`
        yield* until(review, (rows) => rows[0]?.state === 'running')
        const [thread] = yield* until(
          sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'step' AND node_key = 'merge_review'`,
          (rows) => rows.length === 1,
        )
        const reviewer = thread?.id ?? ''
        const live = Effect.map(sessions.running(reviewer), (one) => (Option.isSome(one) ? { turning: one.value.turnRunning } : null))
        yield* until(live, (one) => one?.turning === true)
        yield* until(sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${taskId}`, (rows) => rows[0]?.state === 'done')

        // Its turn stopped, it waits between turns, its review still under way.
        yield* sessions.interrupt(reviewer)
        yield* until(live, (one) => one?.turning === false)
        // Idle longer than the sweep lets an agent on a settled task be, a minute: it is spared all the same.
        yield* TestClock.adjust(Duration.seconds(61))
        yield* (yield* LeftBehind).sweep
        assert.deepStrictEqual(yield* live, { turning: false })
        assert.strictEqual((yield* review)[0]?.state, 'running')
        place.open('[review:wait]')
      }).pipe(
        Effect.provide(
          Queries.layer.pipe(
            Layer.provideMerge(
              runtime(':memory:', { holds: place }, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) }),
            ),
          ),
        ),
        onTestClock,
      )
    },
  )
})

describe('a preset’s parts, on a plan', () => {
  const LEAD = { key: 'implement' as const, agentId: 'codex', model: 'large', skipped: false }
  const REVIEW = { key: 'review' as const, agentId: 'claude-code', model: 'small', skipped: false }
  const parts = (change: Partial<PresetParts>): PresetParts => ({ ...CAREFUL, reviewer: null, ...change })
  /** A plan as the coordinator proposed it, before the preset. */
  const proposed = (plan: PresetPlan): PresetPlan => plan

  it('takes the preset’s lead and reviewer, a reviewer named by its agent alone on its own model, and Local as the checkout', () => {
    assert.deepStrictEqual(
      planFromPreset(
        proposed({ steps: [LEAD], end: 'none', here: true }),
        parts({ workspace: 'local', lead: 'claude-code/default', reviewer: 'opencode' }),
      ),
      {
        steps: [
          { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
          { key: 'review', agentId: 'opencode', model: null, skipped: false },
        ],
        end: 'draft',
        worksIn: 'checkout',
      },
    )
  })

  it('never reviews with the lead’s own model: it skips a review it needs and can’t name, to add back, and keeps the plan’s own', () => {
    assert.deepStrictEqual(planFromPreset(proposed({ steps: [LEAD] }), parts({})).steps[1], {
      key: 'review',
      agentId: 'claude-code',
      model: null,
      skipped: true,
    })
    assert.deepStrictEqual(planFromPreset(proposed({ steps: [] }), parts({ checked: 'after', workspace: 'copy' })), {
      steps: [{ key: 'review', agentId: 'claude-code', model: null, skipped: true }],
      end: 'draft',
      reviewAfterMerge: true,
      here: true,
    })
    assert.deepStrictEqual(planFromPreset(proposed({ steps: [LEAD, REVIEW] }), parts({})).steps[1], { ...REVIEW, skipped: false })
  })

  it('leaves no review row where nothing checks it, one it had included, and adds none where it has none', () => {
    assert.deepStrictEqual(planFromPreset(proposed({ steps: [LEAD, REVIEW] }), parts({ checked: 'none' })).steps, [LEAD])
    assert.deepStrictEqual(planFromPreset(proposed({ steps: [LEAD], worksIn: 'checkout' }), parts({ checked: 'none' })), {
      steps: [LEAD],
      end: 'draft',
      worksIn: 'worktree',
    })
  })
})

describe('a lockfile’s entries from outside a registry, at their edges', () => {
  it('reads none from a package-lock.json with no packages, and takes an entry’s own name over its folder’s', () => {
    assert.deepStrictEqual(outsideEntries('package-lock.json', 'null'), [])
    assert.deepStrictEqual(outsideEntries('package-lock.json', '{"lockfileVersion":3}'), [])
    const npm = JSON.stringify({ packages: { 'node_modules/pad': { name: 'left-pad', resolved: 'github:acme/left-pad#abc' } } })
    assert.deepStrictEqual(outsideEntries('package-lock.json', npm), [{ name: 'left-pad', from: 'github:acme/left-pad#abc' }])
  })

  it('reads where a yarn entry with no resolved line comes from in its header, and a pnpm one from its git repository', () => {
    const yarn = ['left-pad@github:acme/left-pad#abc:', '  version "1.0.0"'].join('\n')
    assert.deepStrictEqual(outsideEntries('yarn.lock', yarn), [{ name: 'left-pad', from: 'github:acme/left-pad#abc' }])
    // A git URL keeps its scheme's colon: only the header's own last one goes.
    const git = ['"is-odd@git+https://github.com/acme/is-odd.git#def":', '  version "2.0.0"'].join('\n')
    assert.deepStrictEqual(outsideEntries('yarn.lock', git), [{ name: 'is-odd', from: 'git+https://github.com/acme/is-odd.git#def' }])
    const pnpm = [
      'packages:',
      '',
      '  left-pad@1.0.0:',
      '    resolution: {repo: https://github.com/acme/left-pad, commit: abc, type: git}',
    ].join('\n')
    assert.deepStrictEqual(outsideEntries('pnpm-lock.yaml', pnpm), [{ name: 'left-pad', from: 'git+https://github.com/acme/left-pad' }])
  })

  it('finds what pnpm installed in its own store, a scoped package by its store name', () => {
    const copy = mkdtempSync(join(tmpdir(), 'althar-lock-'))
    writeFileSync(
      join(copy, 'package-lock.json'),
      JSON.stringify({
        packages: {
          'node_modules/@acme/ui': { resolved: 'https://files.example.com/ui-1.0.0.tgz' },
          'node_modules/left-pad': { resolved: 'github:acme/left-pad#abc' },
        },
      }),
    )
    mkdirSync(join(copy, 'node_modules', '.pnpm', '@acme+ui@1.0.0'), { recursive: true })
    assert.deepStrictEqual(notInstalled(copy, 'package-lock.json'), [{ name: 'left-pad', from: 'github:acme/left-pad#abc' }])
  })
})

describe('a review after a merge, and an outside review trusted fully', () => {
  it('reads a merged pull request the host gave no number in a copy named for the merge', () => {
    const worktree = join(tmpdir(), 'meridian', 'retry-checkout', 'api')
    assert.strictEqual(mergeCopyOf(worktree, null), join(tmpdir(), 'meridian', '.review', 'retry-checkout-after-merge', 'api'))
  })

  it('tells the lead of an outside review the person trusted fully that it runs as the team’s code', () => {
    const brief = reviewBrief({
      cwd: '/tmp/review',
      trust: 'full',
      review: {
        repository: ['meridian', 'api'],
        number: 12,
        url: `${HOST}/meridian/api/pull/12`,
        title: 'Retry the checkout',
        author: 'stranger',
        member: false,
        fork: ['stranger', 'api'],
        outside: true,
        head: 'a'.repeat(40),
        base: 'main',
        baseCommit: 'b'.repeat(40),
        additions: 1,
        deletions: 0,
        changedFiles: 1,
        words: { noun: 'pull request', short: 'PR', prefix: '#' },
      },
    })
    assert.include(brief.join('\n'), 'Its code is trusted: the person said Trust fully, so it is set up as the team’s code is')
  })
})
