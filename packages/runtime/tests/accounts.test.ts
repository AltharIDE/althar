import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId } from '@charrette/domain'
import type { FakeAgentOptions } from '@charrette/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { Agents } from '../src/Config'
import { Instance } from '../src/Instance'
import { Limits } from '../src/Limits'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Secrets } from '../src/Secrets'
import { anyOf, SignIns } from '../src/SignIns'
import { fakeAgents, fakeConnectors, items, launches, repository, runtime, until } from './support'

/*
 * Several accounts per agent (ADR-012): the agent's usual folder first, then
 * homes Charrette makes and folders other tools made, each a sign-in of its
 * own. A session runs in its account's home, and a usage limit puts one
 * account out, so work goes on with the agent's next.
 */

const withAccounts = (each: Readonly<Record<string, FakeAgentOptions>> = {}, signedOut: ReadonlyArray<string> = []) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { each, signedOut })))

/** A folder named as given, as another tool would have made for an account. */
const folder = (name: string) => {
  const path = join(mkdtempSync(join(tmpdir(), 'charrette-home-')), name)
  mkdirSync(path)
  return path
}

const refusal = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.map(Effect.flip(effect), (error) => (error as { readonly reason?: string }).reason ?? (error as { readonly _tag: string })._tag)

describe('accounts', () => {
  it.effect(
    'are the agent’s usual folder first, then homes Charrette makes, with the person’s settings linked in, and folders other tools made',
    () =>
      Effect.gen(function* () {
        const accounts = yield* Accounts
        const usualFolder = (yield* (yield* Agents).get('codex')).definition.home.usual({}, '')
        mkdirSync(usualFolder, { recursive: true })
        writeFileSync(join(usualFolder, 'settings.json'), '{}')
        const [usual] = yield* accounts.of('codex')
        assert.deepStrictEqual([usual?.name, usual?.home, usual?.position], ['main', null, 0])

        const work = yield* accounts.add({ agentId: 'codex', name: ' work ' })
        assert.strictEqual(work.name, 'work')
        assert.isNotNull(work.home)
        const linked = join(work.home ?? '', 'settings.json')
        assert.isTrue(lstatSync(linked).isSymbolicLink())
        assert.strictEqual(readlinkSync(linked), join(usualFolder, 'settings.json'))
        assert.deepStrictEqual(accounts.env(work), { FAKE_HOME: work.home })
        assert.deepStrictEqual(accounts.env(usual ?? work), {})

        const client = yield* accounts.add({ agentId: 'codex', name: 'Client', folder: folder('client') })
        assert.strictEqual(client.adoptedFrom, 'a folder you chose')
        assert.deepStrictEqual(
          [
            yield* refusal(accounts.add({ agentId: 'codex', name: 'Again', folder: client.home ?? '' })),
            yield* refusal(accounts.add({ agentId: 'codex', name: 'Usual', folder: usualFolder })),
            yield* refusal(accounts.add({ agentId: 'codex', name: 'Nowhere', folder: join(tmpdir(), 'charrette-no-such-folder') })),
            yield* refusal(accounts.add({ agentId: 'codex', name: '  ' })),
            yield* refusal(accounts.add({ agentId: 'nobody', name: 'x' })),
            yield* refusal(accounts.remove(usual?.id ?? '')),
            yield* refusal(accounts.rename(work.id, '')),
            yield* refusal(accounts.get('acc_missing')),
          ],
          ['taken', 'usual', 'not_a_folder', 'no_name', 'UnknownAgent', 'usual', 'no_name', 'NotFound'],
        )

        yield* accounts.rename(work.id, 'Work plan')
        yield* accounts.rename(work.id, 'Work plan')
        // The order they are in already moves nothing.
        yield* accounts.order('codex', [usual?.id ?? '', work.id, client.id])
        yield* accounts.order('codex', [client.id, usual?.id ?? ''])
        assert.deepStrictEqual(
          (yield* accounts.of('codex')).map((account) => [account.name, account.position]),
          [
            ['Client', 0],
            ['main', 1],
            ['Work plan', 2],
          ],
        )
        yield* accounts.remove(client.id)
        assert.deepStrictEqual(
          (yield* accounts.of('codex')).map((account) => account.name),
          ['main', 'Work plan'],
        )
        assert.strictEqual(yield* accounts.login(work.id), `FAKE_HOME='${work.home}' fake-login codex`)
        assert.strictEqual(yield* accounts.login(usual?.id ?? ''), 'fake-login codex')
        // An agent the registry doesn't know, as a test's `process` agent, runs in its usual folder, and has no sign-in to open.
        const [elsewhere] = yield* accounts.of('process')
        assert.deepStrictEqual(accounts.env(elsewhere ?? work), {})
        assert.strictEqual(yield* refusal(accounts.login(elsewhere?.id ?? '')), 'UnknownAgent')
        assert.deepStrictEqual(yield* accounts.found('process'), [])
        // Who did what is recorded, as the person's.
        const sql = yield* SqlClient.SqlClient
        const facts = yield* sql<{ type: string }>`
        SELECT type FROM record_events WHERE aggregate_type = 'agent_account' ORDER BY sequence`
        assert.deepStrictEqual(
          facts.map((row) => row.type),
          [
            'agent_account.added',
            'agent_account.adopted',
            'agent_account.renamed',
            'agent_account.moved',
            'agent_account.moved',
            'agent_account.moved',
            'agent_account.removed',
          ],
        )
      }).pipe(Effect.provide(withAccounts())),
  )

  it.effect('make no folder of their own where the runtime has nowhere to keep one', () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts
      assert.strictEqual(yield* refusal(accounts.add({ agentId: 'codex', name: 'work' })), 'no_room')
      // A folder that exists is still added.
      assert.strictEqual((yield* accounts.add({ agentId: 'codex', name: 'work', folder: folder('work') })).name, 'work')
    }).pipe(
      Effect.provide(
        Runtime.layer({
          database: ':memory:',
          worktreeRoot: mkdtempSync(join(tmpdir(), 'charrette-worktrees-')),
          appVersion: '0.0.0-test',
          deviceName: 'Test Mac',
          agents: fakeAgents(),
          secrets: Secrets.memory(),
          connectors: fakeConnectors({}),
        }),
      ),
    ),
  )

  it('say an agent is signed in where any account is, else unknown where any can’t tell, else signed out', () => {
    assert.strictEqual(anyOf(['signed_out', 'signed_in']), 'signed_in')
    assert.strictEqual(anyOf(['signed_out', 'unknown']), 'unknown')
    assert.strictEqual(anyOf([]), 'unknown')
    assert.strictEqual(anyOf(['signed_out', 'signed_out']), 'signed_out')
  })

  it.effect('finds the folders account switchers keep, by name, and not ones already added', () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts
      const home = mkdtempSync(join(tmpdir(), 'charrette-person-'))
      for (const made of [
        '.codex-work',
        '.codex-personal',
        '.claude-side',
        '.claude-code-router',
        '.local/share/codex-accounts/accounts/side',
      ])
        mkdirSync(join(home, made), { recursive: true })
      writeFileSync(join(home, '.codex-notes'), 'not a folder')
      const was = process.env.HOME
      process.env.HOME = home
      try {
        const found = yield* accounts.found('codex')
        assert.deepStrictEqual(found.map((place) => [place.name, place.tool]).toSorted(), [
          ['personal', 'codex-profiles'],
          ['side', 'codex-account-switcher'],
          ['work', 'codex-profiles'],
        ])
        assert.deepStrictEqual(
          (yield* accounts.found('claude-code')).map((place) => place.name),
          ['side'],
        )
        assert.deepStrictEqual(yield* accounts.found('opencode'), [])
        const work = yield* accounts.add({ agentId: 'codex', name: 'work', folder: join(home, '.codex-work') })
        assert.strictEqual(work.adoptedFrom, 'codex-profiles')
        assert.notInclude(
          (yield* accounts.found('codex')).map((place) => place.name),
          'work',
        )
      } finally {
        if (was === undefined) delete process.env.HOME
        else process.env.HOME = was
      }
    }).pipe(Effect.provide(withAccounts())),
  )

  it.effect('are each signed in on their own, and a session runs on the first one that can, in its home', () => {
    const away = folder('away')
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const signIns = yield* SignIns
      const limits = yield* Limits
      const [usual] = yield* accounts.of('codex')
      const signedOut = yield* accounts.add({ agentId: 'codex', name: 'Away', folder: away })
      const work = yield* accounts.add({ agentId: 'codex', name: 'Work', folder: folder('work') })
      yield* accounts.order('codex', [signedOut.id, work.id])
      assert.strictEqual((yield* signIns.account(signedOut)).status, 'signed_out')
      assert.strictEqual(yield* signIns.of('codex'), 'signed_in')
      assert.strictEqual((yield* limits.pick({ agentId: 'codex' })).id, work.id)
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', accountId: usual?.id ?? '' })).id, usual?.id)
      assert.strictEqual((yield* limits.named('codex', null, work.id)).agent, 'Fake codex (Work)')
      assert.strictEqual((yield* limits.named('opencode', null, null)).agent, 'Fake opencode')
      // The account signed out doesn't count: the agent isn't out while another can run.
      assert.isTrue((yield* limits.out('codex'))._tag === 'None')
    }).pipe(Effect.provide(withAccounts({}, [away])))
  })

  it.live('put one account out of usage, so a step goes on with the agent’s next account, in its home, and the thread says so', () => {
    const back = Date.now() + 60 * 60 * 1000
    const workFolder = folder('work')
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const projects = yield* Projects
      const plans = yield* Plans
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const [usual] = yield* accounts.of('codex')
      const work = yield* accounts.add({ agentId: 'codex', name: 'work', folder: workFolder })
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Retry the checkout [lead:finish]',
        draft: true,
      })
      const planId = yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: task.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
        end: null,
      })
      yield* plans.start(planId, instance.personId)
      const said = yield* until(
        Effect.map(items(task.threadId), (all) =>
          all.flatMap((item) => (item.kind === 'notice' || item.kind === 'step_result' ? [JSON.stringify(item.content)] : [])),
        ),
        (lines) => lines.some((line) => line.includes('Did the task.')),
        Duration.seconds(20),
      )
      assert.match(said.join('\n'), /Fake codex \(main\) reached its usage limit, until [^.]+\. Fake codex \(work\) takes over/)
      const sessionsOn = yield* sql<{ agentId: string; accountId: string }>`
        SELECT agent_id, account_id FROM provider_sessions WHERE thread_id = ${task.threadId} ORDER BY started_at`
      assert.deepStrictEqual(
        sessionsOn.map((session) => [session.agentId, session.accountId]),
        [
          ['codex', usual?.id],
          ['codex', work.id],
        ],
      )
      assert.deepInclude(launches, { agentId: 'codex', env: { FAKE_HOME: workFolder } })
      // The usual account is out until its reset; the agent isn't, while work can run.
      const limits = yield* Limits
      assert.isTrue((yield* limits.outAccount(usual?.id ?? ''))._tag === 'Some')
      assert.isTrue((yield* limits.out('codex'))._tag === 'None')
    }).pipe(Effect.provide(withAccounts({ 'codex@usual': { outOfUsage: { until: back } } })))
  })
})
