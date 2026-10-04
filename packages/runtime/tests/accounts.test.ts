import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId } from '@charrette/domain'
import type { FakeAgentOptions } from '@charrette/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts, SignOutFailed } from '../src/Accounts'
import { Agents, RuntimeConfig } from '../src/Config'
import { Instance } from '../src/Instance'
import { Limits } from '../src/Limits'
import { Plans } from '../src/Plans'
import { Policies } from '../src/Policies'
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

/** Which agent and account each session on a thread ran on, in order. */
const sessionsOn = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ agentId: string; accountId: string }>`
      SELECT agent_id, account_id FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at`
    return rows.map((row) => [row.agentId, row.accountId])
  })

/** A task planned for Codex alone, started, until its lead is done: what its thread said, and where. */
const ranOnCodex = (projectId?: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const instance = yield* Instance
    const project =
      projectId ?? (yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })).projectId
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project,
      title: 'Retry the checkout [lead:finish]',
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: project as ProjectId,
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
    return { projectId: project, threadId: task.threadId, said: said.join('\n') }
  })

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
        // A folder another tool made stays, signed in, that tool's.
        yield* accounts.remove(client.id)
        assert.isTrue(existsSync(client.home ?? ''))
        assert.deepStrictEqual(
          (yield* accounts.of('codex')).map((account) => account.name),
          ['main', 'Work plan'],
        )
        // One Charrette made is signed out with the agent's own tool, in its home, and its folder goes.
        const spare = yield* accounts.add({ agentId: 'codex', name: 'spare' })
        writeFileSync(join(spare.home ?? '', 'auth.json'), '{}')
        const signedOut = join(mkdtempSync(join(tmpdir(), 'charrette-signed-out-')), 'homes')
        process.env.FAKE_SIGNED_OUT = signedOut
        try {
          yield* accounts.remove(spare.id)
        } finally {
          delete process.env.FAKE_SIGNED_OUT
        }
        assert.isFalse(existsSync(spare.home ?? ''))
        assert.strictEqual(readFileSync(signedOut, 'utf8'), `${spare.home}\n`)
        // Where the agent doesn't sign it out, it and its folder stay, and the person is given the line to run.
        const kept = yield* accounts.add({ agentId: 'codex', name: 'kept' })
        const stale = yield* accounts.add({ agentId: 'codex', name: 'stale' })
        process.env.FAKE_SIGN_OUT_FAILS = '1'
        try {
          const failed = yield* Effect.flip(accounts.remove(kept.id))
          assert.deepStrictEqual(failed, new SignOutFailed({ line: `FAKE_HOME='${kept.home}' fake-logout` }))
          // Removed anyway, as when the agent's tool is gone: the folder goes all the same.
          yield* accounts.remove(stale.id, { anyway: true })
          assert.isFalse(existsSync(stale.home ?? ''))
        } finally {
          delete process.env.FAKE_SIGN_OUT_FAILS
        }
        assert.isTrue(existsSync(kept.home ?? ''))
        assert.include(
          (yield* accounts.of('codex')).map((account) => account.name),
          'kept',
        )
        // A record whose home were the accounts folder itself never has it deleted.
        const root = (yield* RuntimeConfig).accountsRoot ?? ''
        yield* (yield* SqlClient.SqlClient)`UPDATE agent_accounts SET home = ${root} WHERE id = ${kept.id}`
        yield* accounts.remove(kept.id)
        assert.isTrue(existsSync(root))
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
            'agent_account.added',
            'agent_account.removed',
            'agent_account.added',
            'agent_account.added',
            'agent_account.removed',
            'agent_account.removed',
          ],
        )
      }).pipe(Effect.provide(withAccounts())),
  )

  it.effect('share with a home Charrette made what isn’t the account’s own, brought up to date as a session starts', () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts
      // As OpenCode's data folder: its sign-in stays the account's, other tools' data is shared.
      const usualFolder = (yield* (yield* Agents).get('opencode')).definition.home.usual({}, '')
      mkdirSync(join(usualFolder, 'mise'), { recursive: true })
      writeFileSync(join(usualFolder, 'auth.json'), '{}')
      const own = yield* accounts.add({ agentId: 'opencode', name: 'second' })
      const home = own.home ?? ''
      assert.isTrue(lstatSync(join(home, 'mise')).isSymbolicLink())
      assert.isFalse(existsSync(join(home, 'auth.json')))
      // What came to the usual folder since is linked as a session starts.
      mkdirSync(join(usualFolder, 'pnpm'))
      yield* accounts.prepare(own)
      yield* accounts.prepare(own)
      assert.strictEqual(readlinkSync(join(home, 'pnpm')), join(usualFolder, 'pnpm'))
      // A folder another tool made is left as it is.
      const adopted = yield* accounts.add({ agentId: 'opencode', name: 'third', folder: folder('third') })
      yield* accounts.prepare(adopted)
      assert.isFalse(existsSync(join(adopted.home ?? '', 'pnpm')))
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

  it.live('put one account out of usage, and by default the project doesn’t rotate: another agent takes the step over, on a plan', () => {
    const back = Date.now() + 60 * 60 * 1000
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const limits = yield* Limits
      const [usual] = yield* accounts.of('codex')
      yield* accounts.add({ agentId: 'codex', name: 'work', folder: folder('work') })
      const ran = yield* ranOnCodex()
      assert.match(ran.said, /Fake codex \(main\) reached its usage limit, until [^.]+\. Fake claude-code takes over/)
      assert.deepStrictEqual(
        (yield* sessionsOn(ran.threadId)).map(([agentId]) => agentId),
        ['codex', 'claude-code'],
      )
      assert.isFalse(yield* limits.rotates(ran.projectId))
      // Without rotation, work there stays on the agent's first account: Codex is out while it is, and new work doesn't slip to the next.
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', projectId: ran.projectId })).name, 'main')
      assert.isTrue((yield* limits.out('codex', ran.projectId))._tag === 'Some')
      assert.isTrue((yield* limits.outAccount(usual?.id ?? ''))._tag === 'Some')
      // Nor is Codex free there to take other work over.
      assert.strictEqual(yield* limits.free(['claude-code', 'opencode'], [], ran.projectId), undefined)
    }).pipe(Effect.provide(withAccounts({ 'codex@usual': { outOfUsage: { until: back } } })))
  })

  it.live('go on with the agent’s next account, in its home, where the project turned that on, among the accounts it allows', () => {
    const back = Date.now() + 60 * 60 * 1000
    const workFolder = folder('work')
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const policies = yield* Policies
      const instance = yield* Instance
      const projects = yield* Projects
      const limits = yield* Limits
      const [usual] = yield* accounts.of('codex')
      const work = yield* accounts.add({ agentId: 'codex', name: 'work', folder: workFolder })
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      yield* policies.setAccounts(project.projectId, { rotate: true }, instance.personId)
      // Saying it again makes no new revision.
      yield* policies.setAccounts(project.projectId, { rotate: true }, instance.personId)
      const ran = yield* ranOnCodex(project.projectId)
      assert.match(ran.said, /Fake codex \(main\) reached its usage limit, until [^.]+\. Fake codex \(work\) takes over/)
      assert.deepStrictEqual(yield* sessionsOn(ran.threadId), [
        ['codex', usual?.id],
        ['codex', work.id],
      ])
      assert.deepInclude(launches, { agentId: 'codex', env: { FAKE_HOME: workFolder } })
      // The usual account is out until its reset; the agent isn't, while work can run.
      assert.isTrue((yield* limits.out('codex', project.projectId))._tag === 'None')

      // The conversation stays on its account where the project rotates; where it doesn't, work goes back to the first.
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', projectId: project.projectId, threadId: ran.threadId })).id, work.id)
      yield* policies.setAccounts(project.projectId, { rotate: false }, instance.personId)
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', projectId: project.projectId, threadId: ran.threadId })).id, usual?.id)
      // A project left with none of an agent's accounts, as when the one it named is gone, has all of them back.
      yield* policies.setAccounts(project.projectId, { rotate: true, only: { codex: ['acc_gone'] } }, instance.personId)
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', projectId: project.projectId })).id, work.id)

      // Limited to the usual account, the project has no other: Codex is out there, and a new step goes to another agent.
      yield* policies.setAccounts(project.projectId, { rotate: true, only: { codex: [usual?.id ?? ''] } }, instance.personId)
      assert.isTrue((yield* limits.out('codex', project.projectId))._tag === 'Some')
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', projectId: project.projectId })).id, usual?.id)
      const limited = yield* ranOnCodex(project.projectId)
      assert.match(limited.said, /Fake codex reached its usage limit, until [^.]+\. Fake claude-code takes over/)
      assert.deepStrictEqual(
        (yield* sessionsOn(limited.threadId)).map(([agentId]) => agentId),
        ['claude-code'],
      )
      const sql = yield* SqlClient.SqlClient
      const revisions = yield* sql<{
        revision: number
      }>`SELECT revision FROM policies WHERE project_id = ${project.projectId} ORDER BY revision`
      assert.deepStrictEqual(
        revisions.map((row) => row.revision),
        [1, 2, 3, 4, 5],
      )
    }).pipe(Effect.provide(withAccounts({ 'codex@usual': { outOfUsage: { until: back } } })))
  })
})
