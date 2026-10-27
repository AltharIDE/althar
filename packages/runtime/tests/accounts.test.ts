import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId } from '@althar/domain'
import type { FakeAgentOptions } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts, SignOutFailed } from '../src/Accounts'
import { type AgentEntry, Agents, RuntimeConfig, type RuntimeOptions } from '../src/Config'
import { Instance } from '../src/Instance'
import { Limits } from '../src/Limits'
import { Models } from '../src/Models'
import { Plans } from '../src/Plans'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Secrets } from '../src/Secrets'
import { anyOf, SignIns } from '../src/SignIns'
import { usableModels } from '../src/usableModels'
import { fakeAgents, fakeConnectors, items, launches, repository, runtime, until } from './support'

/*
 * Several accounts per agent (ADR-012): the agent's usual folder first, then
 * homes Althar makes and folders other tools made, each a sign-in of its
 * own. A session runs in its account's home, and a usage limit puts one
 * account out, so work goes on with the agent's next.
 */

const withAccounts = (
  each: Readonly<Record<string, FakeAgentOptions>> = {},
  signedOut: ReadonlyArray<string> = [],
  onDevice?: RuntimeOptions['onDevice'],
) => Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { each, signedOut, ...(onDevice === undefined ? {} : { onDevice }) })))

/** A folder named as given, as another tool would have made for an account. */
const folder = (name: string) => {
  const path = join(mkdtempSync(join(tmpdir(), 'althar-home-')), name)
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

/** The fake agents, with one that signs in only inside Althar: no command of its own to run in a terminal. */
const insideOnly = (agentId: string) =>
  Layer.effect(
    Agents,
    Effect.gen(function* () {
      const agents = yield* Agents
      const inside = (entry: AgentEntry): AgentEntry =>
        entry.definition.id === agentId
          ? { ...entry, definition: { ...entry.definition, signIn: { ...entry.definition.signIn, login: '' } } }
          : entry
      return Agents.of({ list: agents.list.map(inside), get: (id) => Effect.map(agents.get(id), inside) })
    }),
  ).pipe(Layer.provide(fakeAgents()))

describe('accounts', () => {
  it.effect('keep an agent whose sign-in every folder shares to its usual account, and the window offers no other', () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts
      const refused = yield* Effect.flip(accounts.add({ agentId: 'opencode', name: 'Work' }))
      assert.deepInclude(refused, { _tag: 'AccountRefused', reason: 'one' })
      assert.deepStrictEqual(
        (yield* accounts.of('opencode')).map((account) => account.home),
        [null],
      )
      // Another agent adds accounts as before.
      assert.isNotNull((yield* accounts.add({ agentId: 'codex', name: 'Work' })).home)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { oneAccount: ['opencode'] }))))),
  )

  it.effect('opens no terminal to sign in an agent that signs in only inside Althar, as Antigravity does', () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts
      const [usual] = yield* accounts.of('codex')
      if (usual === undefined) throw new Error('Codex has its usual account')
      assert.deepInclude(yield* Effect.flip(accounts.login(usual.id)), { _tag: 'AccountRefused', reason: 'no_terminal' })
      // Another still signs in in a terminal.
      const [claude] = yield* accounts.of('claude-code')
      if (claude === undefined) throw new Error('Claude Code has its usual account')
      assert.include(yield* accounts.login(claude.id), 'fake-login claude-code')
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { agents: insideOnly('codex') }))))),
  )

  it.effect('gives the usual Claude account one persistent home when sessions run in a Flatpak', () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts
      const config = yield* RuntimeConfig
      const definition = (yield* (yield* Agents).get('claude-code')).definition
      const usual = definition.home.usual({}, '')
      mkdirSync(usual, { recursive: true })
      writeFileSync(join(usual, 'settings.json'), '{}')
      const [account] = yield* accounts.of('claude-code')
      if (account === undefined) return assert.fail('Claude Code has its usual account')

      yield* accounts.prepare(account)
      const home = join(config.accountsRoot ?? '', 'claude-usual')
      assert.deepStrictEqual(accounts.env(account), { FAKE_HOME: home })
      assert.isTrue(lstatSync(home).isDirectory())
      assert.isTrue(lstatSync(join(home, 'settings.json')).isSymbolicLink())
      // The line to sign in names that same home: what the person runs signs
      // the account in where its sessions will read the sign-in.
      assert.strictEqual(yield* accounts.login(account.id), `FAKE_HOME='${home}' fake-login claude-code`)
    }).pipe(Effect.provide(withAccounts({}, [], { reachable: false, where: () => null, run: (spec) => spec }))),
  )

  it.effect(
    'are the agent’s usual folder first, then homes Althar makes, with the person’s settings linked in, and folders other tools made',
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
            yield* refusal(accounts.add({ agentId: 'codex', name: 'Nowhere', folder: join(tmpdir(), 'althar-no-such-folder') })),
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
        // One Althar made is signed out with the agent's own tool, in its home, and its folder goes.
        const spare = yield* accounts.add({ agentId: 'codex', name: 'spare' })
        writeFileSync(join(spare.home ?? '', 'auth.json'), '{}')
        const signedOut = join(mkdtempSync(join(tmpdir(), 'althar-signed-out-')), 'homes')
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

  it.effect('share with a home Althar made what isn’t the account’s own, brought up to date as a session starts', () =>
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
          worktreeRoot: mkdtempSync(join(tmpdir(), 'althar-worktrees-')),
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
      const home = mkdtempSync(join(tmpdir(), 'althar-person-'))
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
      const wasProfile = process.env.USERPROFILE
      // The home Node gives: HOME, and on Windows USERPROFILE.
      process.env.HOME = home
      process.env.USERPROFILE = home
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
        if (wasProfile === undefined) delete process.env.USERPROFILE
        else process.env.USERPROFILE = wasProfile
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

  it.live('offer no model of an agent whose only account a project allows is signed out', () => {
    const away = folder('away')
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const policies = yield* Policies
      const instance = yield* Instance
      const projects = yield* Projects
      const models = yield* Models
      const signedOut = yield* accounts.add({ agentId: 'codex', name: 'Away', folder: away })
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
      yield* until(models.catalog, (all) => all.every((agent) => !agent.probing))
      const routesOn = Effect.map(usableModels(project.projectId), (usable) =>
        usable.flatMap((model) => model.routes.map((route) => route.agentId)),
      )
      assert.include(yield* routesOn, 'codex')
      // Its usual account is signed in, but the project runs Codex only on the one that isn't.
      yield* policies.setAccounts(project.projectId, { rotate: true, only: { codex: [signedOut.id] } }, instance.personId)
      assert.notInclude(yield* routesOn, 'codex')
      assert.include(yield* routesOn, 'claude-code')
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
      assert.match(ran.said, /Fake codex \(main\) ran out of usage [^,]+, until [^.]+\. Fake claude-code takes the work over/)
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
      assert.match(ran.said, /Fake codex \(main\) ran out of usage [^,]+, until [^.]+\. Fake codex \(work\) takes the work over/)
      assert.deepStrictEqual(yield* sessionsOn(ran.threadId), [
        ['codex', usual?.id],
        ['codex', work.id],
      ])
      // Codex's last launch, its second account's session, is in that account's home.
      assert.deepStrictEqual(launches.filter(({ agentId }) => agentId === 'codex').at(-1)?.env, { FAKE_HOME: workFolder })
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
      assert.match(limited.said, /Fake codex ran out of usage [^,]+, until [^.]+\. Fake claude-code takes the work over/)
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
