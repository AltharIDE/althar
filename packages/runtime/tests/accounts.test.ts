import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Ids, newId, type ProjectId } from '@althar/domain'
import { agents, type SignInCheck } from '@althar/provider-adapters'
import { fakeAgent, type FakeAgentOptions } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
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
import { anyOf, latestRefusals, SignIns } from '../src/SignIns'
import { usableModels } from '../src/usableModels'
import { definition, fakeAgents, fakeConnectors, items, launches, repository, runtime, task, until } from './support'

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
    )
    return { projectId: project, taskId: task.taskId, threadId: task.threadId, said: said.join('\n') }
  })

/** The fake agents, with one of them changed. */
const changed = (agentId: string, change: (definition: AgentEntry['definition']) => AgentEntry['definition']) =>
  Layer.effect(
    Agents,
    Effect.gen(function* () {
      const agents = yield* Agents
      const one = (entry: AgentEntry): AgentEntry =>
        entry.definition.id === agentId ? { ...entry, definition: change(entry.definition) } : entry
      return Agents.of({ list: agents.list.map(one), get: (id) => Effect.map(agents.get(id), one) })
    }),
  ).pipe(Layer.provide(fakeAgents()))

/** The fake agents, with one that signs in only inside Althar: no command of its own to run in a terminal. */
const insideOnly = (agentId: string) => changed(agentId, (definition) => ({ ...definition, signIn: { ...definition.signIn, login: '' } }))

/** The fake agents, with one at this version, whose versions before 2 sign in with a line of their own, as OpenCode 1.x does. */
const atVersion = (agentId: string, version: string) =>
  changed(agentId, (definition) => ({
    ...definition,
    version: () => ({ command: 'bun', args: ['-e', `console.log(${JSON.stringify(version)})`] }),
    signIn: { ...definition.signIn, loginBefore: { major: 2, line: 'old-login' } },
  }))

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

  it.effect("puts the person's skills in a home whose own `skills` folder would keep them out", () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts
      const config = yield* RuntimeConfig
      const definition = (yield* (yield* Agents).get('claude-code')).definition
      const usual = definition.home.usual({}, '')
      // The usual folder is the whole file's: the person's skills in it are this test's alone.
      yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(join(usual, 'skills'), { recursive: true, force: true })))
      mkdirSync(join(usual, 'skills', 'mine'), { recursive: true })
      const [account] = yield* accounts.of('claude-code')
      if (account === undefined) return assert.fail('Claude Code has its usual account')
      // What Claude Code made itself there, for what it syncs from an account: it stays.
      const home = join(config.accountsRoot ?? '', 'claude-usual')
      mkdirSync(join(home, 'skills', 'synced'), { recursive: true })

      yield* accounts.prepare(account)
      assert.isFalse(lstatSync(join(home, 'skills')).isSymbolicLink())
      assert.isTrue(lstatSync(join(home, 'skills', 'synced')).isDirectory())
      assert.isTrue(lstatSync(join(home, 'skills', 'mine')).isSymbolicLink())
      // Again, as every session does, with one more since.
      mkdirSync(join(usual, 'skills', 'more'))
      yield* accounts.prepare(account)
      assert.isTrue(lstatSync(join(home, 'skills', 'more')).isSymbolicLink())
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(
          Layer.provideMerge(runtime(':memory:', {}, { onDevice: { reachable: true, where: () => null, run: (spec) => spec } })),
        ),
      ),
    ),
  )

  it.effect('gives an older version installed the line of its own, as OpenCode 1.x signs in without --standalone', () =>
    Effect.gen(function* () {
      const [claude] = yield* (yield* Accounts).of('claude-code')
      assert.strictEqual(yield* (yield* Accounts).login(claude?.id ?? ''), 'old-login')
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { agents: atVersion('claude-code', '1.4.2') }))))),
  )

  it.effect('gives the current line to the version it was written for, and to one that doesn’t say', () =>
    Effect.gen(function* () {
      const [claude] = yield* (yield* Accounts).of('claude-code')
      assert.include(yield* (yield* Accounts).login(claude?.id ?? ''), 'fake-login claude-code')
    }).pipe(
      Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { agents: atVersion('claude-code', 'unknown') })))),
    ),
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
      // The usual folder lasts the run: what an earlier run of this test left there goes first.
      rmSync(join(usualFolder, 'pnpm'), { recursive: true, force: true })
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

  it('tells which provider within an agent refused its sign-in, from its latest turns', () => {
    const providerOf = agents.opencode.signIn.providers?.of ?? (() => undefined)
    const turn = (model: string, endedAt: string, errorClass: string | null) => ({ model, endedAt, errorClass })
    // Newest first: Go was refused twice, Anthropic went through after a refusal, and a model with no provider says nothing.
    const latest = latestRefusals(
      [
        turn('opencode-go/deepseek-v4.1-flash', '2026-11-02T20:43:44.187Z', 'auth_required'),
        turn('anthropic/claude-sonnet-5-5', '2026-11-02T20:30:00.000Z', null),
        turn('opencode-go/gemini-4-argon', '2026-11-02T20:43:19.132Z', 'auth_required'),
        turn('anthropic/claude-sonnet-5-5', '2026-11-02T19:00:00.000Z', 'auth_required'),
        turn('sonnet', '2026-11-02T18:00:00.000Z', 'auth_required'),
      ],
      providerOf,
    )
    assert.deepStrictEqual(
      [...latest],
      [
        ['opencode-go', '2026-11-02T20:43:44.187Z'],
        ['anthropic', null],
      ],
    )
  })

  it.live('says which of a provider agent’s providers refused, and lets one go when its sign-in changes or a later turn works', () => {
    const base = definition('opencode')
    const withProviders = {
      ...base,
      signIn: {
        ...base.signIn,
        providers: {
          read: () => [],
          of: (model: string) => (model.includes('/') ? model.slice(0, model.indexOf('/')) : undefined),
        },
      },
    }
    const layer = Queries.layer.pipe(
      Layer.provideMerge(
        runtime(
          ':memory:',
          {},
          {
            agents: Layer.succeed(
              Agents,
              Agents.from([{ definition: withProviders, transport: () => ({ _tag: 'InProcess', agent: fakeAgent() }) }]),
            ),
          },
        ),
      ),
    )
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const signIns = yield* SignIns
      const sql = yield* SqlClient.SqlClient
      const { project, task: created } = yield* task('Ask the provider')
      const [account] = yield* accounts.of('opencode')
      if (account === undefined) return assert.fail('OpenCode has its usual account')
      const sessionId = yield* newId(Ids.providerSession)
      yield* sql`INSERT INTO provider_sessions ${sql.insert({
        id: sessionId,
        projectId: project.projectId,
        threadId: created.threadId,
        agentId: 'opencode',
        accountId: account.id,
        state: 'active',
        startedAt: new Date().toISOString(),
      })}`
      const turn = (state: 'completed' | 'failed', errorClass: string | null, endedAt: string, model = 'opencode-go/glm-5.3') =>
        Effect.gen(function* () {
          const id = yield* newId(Ids.turnDelivery)
          yield* sql`INSERT INTO turn_deliveries ${sql.insert({
            id,
            projectId: project.projectId,
            threadId: created.threadId,
            providerSessionId: sessionId,
            controllerGeneration: 1,
            state,
            origin: 'person',
            model,
            errorClass,
            endedAt,
            requestedAt: endedAt,
          })}`
        })
      const listed: ReadonlyArray<NonNullable<SignInCheck['providers']>[number]> = [
        { id: 'opencode-go', name: 'OpenCode Go', connections: 'key' },
      ]
      const check = (providers = listed) => ({ status: 'signed_in' as const, paidBy: 'key' as const, providers })
      // Nothing refused yet: the provider is there, with nothing to say.
      assert.deepStrictEqual(yield* signIns.providers(account, check()), [{ id: 'opencode-go', name: 'OpenCode Go', refusedAt: null }])
      // Its latest turn was refused: said, and kept as it says on the next look.
      yield* turn('failed', 'auth_required', '2026-11-02T20:43:44.187Z')
      const refused = [{ id: 'opencode-go', name: 'OpenCode Go', refusedAt: '2026-11-02T20:43:44.187Z' }]
      assert.deepStrictEqual(yield* signIns.providers(account, check()), refused)
      assert.deepStrictEqual(yield* signIns.providers(account, check()), refused)
      // The sign-in it listed changed meanwhile: what was refused is put right.
      assert.deepStrictEqual(yield* signIns.providers(account, check([{ ...listed[0]!, connections: 'key, oauth' }])), [
        { id: 'opencode-go', name: 'OpenCode Go', refusedAt: null },
      ])
      // A later turn that went through lets the refusal go.
      yield* turn('completed', null, '2026-11-02T21:00:00.000Z')
      assert.deepStrictEqual(yield* signIns.providers(account, check()), [{ id: 'opencode-go', name: 'OpenCode Go', refusedAt: null }])
      // Refused again, and gone from what the status lists: still one to sign in to, by its id.
      yield* turn('failed', 'auth_required', '2026-11-02T21:30:00.000Z')
      assert.deepStrictEqual(yield* signIns.providers(account, check([])), [
        { id: 'opencode-go', name: 'opencode-go', refusedAt: '2026-11-02T21:30:00.000Z' },
      ])
      // The agent itself says the provider needs signing in again (OpenCode's needs_auth): refused, from when it first said so.
      const needing = check([{ ...listed[0]!, connections: 'key, oauth', needsSignIn: true as const }])
      const [first] = (yield* signIns.providers(account, needing)) ?? []
      assert.isNotNull(first?.refusedAt)
      assert.strictEqual(((yield* signIns.providers(account, needing)) ?? [])[0]?.refusedAt, first?.refusedAt)
      // Signed in again, it no longer says so: put right.
      assert.isNull(((yield* signIns.providers(account, check([{ ...listed[0]!, connections: 'key, oauth' }]))) ?? [])[0]?.refusedAt)
      // An agent with one sign-in, not one per provider, says nothing of providers.
      const [codex] = yield* accounts.of('codex')
      if (codex === undefined) return assert.fail('Codex has its usual account')
      assert.isUndefined(yield* signIns.providers(codex, check()))
    }).pipe(Effect.provide(layer))
  })

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
      assert.strictEqual(yield* limits.free({ besides: ['claude-code', 'opencode'], projectId: ran.projectId }), undefined)
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
      // Codex's last launch, its second account's session, is in that account's home, with whose work it is beside it.
      // Beside what git's guard adds to a lead's (pushGuard.ts).
      const launched = Object.entries(launches.filter(({ agentId }) => agentId === 'codex').at(-1)?.env ?? {}).filter(
        ([key]) => !/^(GIT_CONFIG_|ALTHAR_(GUARD_PASS|GUARD_REPOSITORIES|GUARD_REMOTES|TASK_BRANCH|DEFAULT_BRANCHES)$)/.test(key),
      )
      assert.deepStrictEqual(Object.fromEntries(launched), {
        FAKE_HOME: workFolder,
        ALTHAR_WORK: `task:${ran.taskId}`,
      })
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
