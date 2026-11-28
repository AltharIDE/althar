import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import type { FakeAgentOptions } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts, SignOutFailed } from '../src/Accounts'
import { Instance } from '../src/Instance'
import { Limits } from '../src/Limits'
import { mergeOffers, Models } from '../src/Models'
import { Projects } from '../src/Projects'
import { applyRules } from '../src/rulesChange'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { usableModels } from '../src/usableModels'
import { repository, runtime, until } from './support'

/*
 * Each of an agent's accounts offers models of its own, as each plan its maker sells does: Codex's usual folder, signed in
 * to a plan offered only Luna and GPT-5.6 Terra, and a Plus account Althar added, offered GPT-6.2 Sol and GPT-6.1 Terra too.
 * The agent's models are what any of its accounts offers, and a step on one runs on an account that offers it.
 */

const LUNA = { id: 'gpt-6-luna', name: 'GPT-6 Luna' }
const TERRA = { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' }
const SOL = { id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol' }
const NEW_TERRA = { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' }

/** What each account's agent offers, by `codex@` and its home's folder name, or `codex@usual`; changed as a test goes. */
const accountsOffering = (): Record<string, FakeAgentOptions> => ({ 'codex@usual': { models: [LUNA, TERRA] } })

const codexOf = Effect.gen(function* () {
  const models = yield* Models
  return yield* until(models.catalog, (all) => all.find((agent) => agent.agentId === 'codex')?.probing === false)
}).pipe(Effect.map((all) => all.find((agent) => agent.agentId === 'codex')))

const ids = (offered: { readonly models: ReadonlyArray<{ readonly id: string }> } | undefined) => offered?.models.map((model) => model.id)

/** A session's settings as Codex says them: on `on`, listing `listed`. */
const offering = (on: { readonly id: string }, listed: ReadonlyArray<{ readonly id: string; readonly name: string }>) =>
  JSON.stringify({
    options: [
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: on.id,
        values: listed.map((model) => model.id),
        choices: listed.map((model) => ({ value: model.id, name: model.name })),
      },
    ],
  })

/** A task, for a session to run on: its thread and its project. */
const taskOf = Effect.gen(function* () {
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const created = yield* projects.createTask({
    envelope: yield* Runtime.envelope('task.create', {}),
    projectId: project.projectId,
    title: 'Retry the checkout',
  })
  return { threadId: created.threadId, projectId: project.projectId }
})
const thread = Effect.map(taskOf, (made) => made.threadId)

/** The usual folder's Codex account and an added Plus one, each asked what it offers: the Plus one Sol too. */
const mainAndPlus = (each: Record<string, FakeAgentOptions>) =>
  Effect.gen(function* () {
    const accounts = yield* Accounts
    const plus = yield* accounts.add({ agentId: 'codex', name: 'Plus' })
    each[`codex@${basename(plus.home ?? '')}`] = { models: [SOL, NEW_TERRA, LUNA] }
    assert.include(ids(yield* codexOf) ?? [], SOL.id)
    const [main] = yield* accounts.of('codex')
    return { main: main!, plus }
  })

describe('the models of an agent with several accounts', () => {
  it.live('are what any of its accounts offers, read again as one is added and removed', () => {
    const each = accountsOffering()
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const models = yield* Models
      assert.deepStrictEqual(ids(yield* codexOf), [LUNA.id, TERRA.id])
      // Added, the Plus account is asked at the next read, in its own home: its models are offered beside the usual one's.
      const plus = yield* accounts.add({ agentId: 'codex', name: 'Plus' })
      each[`codex@${basename(plus.home ?? '')}`] = { models: [SOL, NEW_TERRA, LUNA, TERRA] }
      assert.isTrue((yield* models.catalog).find((agent) => agent.agentId === 'codex')?.probing)
      assert.deepStrictEqual(ids(yield* codexOf), [LUNA.id, TERRA.id, SOL.id, NEW_TERRA.id])
      // Which don't offer each: Sol not the usual one; Luna both do.
      const [main] = yield* accounts.of('codex')
      assert.deepStrictEqual(yield* models.lacking('codex', SOL.id), [main!.id])
      assert.deepStrictEqual(yield* models.lacking('codex', `${SOL.id} ${SOL.name}`), [main!.id])
      assert.deepStrictEqual(yield* models.lacking('codex', LUNA.id), [])
      // Removed, it offers nothing more: Sol isn't listed.
      yield* accounts.remove(plus.id)
      assert.deepStrictEqual(ids(yield* codexOf), [LUNA.id, TERRA.id])
      assert.deepStrictEqual(yield* models.lacking('codex', SOL.id), [main!.id])
    }).pipe(Effect.provide(runtime(':memory:', {}, { each })))
  })

  it.live('run a step on a model on an account that offers it, the usual one first where both do', () => {
    const each = accountsOffering()
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const limits = yield* Limits
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const plus = yield* accounts.add({ agentId: 'codex', name: 'Plus' })
      each[`codex@${basename(plus.home ?? '')}`] = { models: [SOL, NEW_TERRA, LUNA] }
      assert.include(ids(yield* codexOf) ?? [], SOL.id)
      const [main] = yield* accounts.of('codex')
      // As the pickers and the coordinator name it, by its id and name, and as a step does, by its id alone.
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', model: `${SOL.id} ${SOL.name}` })).id, plus.id)
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', model: NEW_TERRA.id })).id, plus.id)
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', model: LUNA.id })).id, main!.id)
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', model: TERRA.id })).id, main!.id)
      // One added and not asked yet may offer it: it isn't passed for Sol, though the usual one is.
      const spare = yield* accounts.add({ agentId: 'codex', name: 'Spare' })
      yield* accounts.order('codex', [spare.id, main!.id, plus.id])
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', model: SOL.id })).id, spare.id)
      yield* accounts.remove(spare.id)
      // A step's session on Sol starts on the Plus account; one on Luna on the usual one, which work tries first.
      const onSol = yield* thread
      yield* sessions.start({ threadId: onSol, agentId: 'codex', model: SOL.id })
      const onLuna = yield* thread
      yield* sessions.start({ threadId: onLuna, agentId: 'codex', model: LUNA.id })
      const ran = yield* sql<{ threadId: string; model: string | null; accountId: string | null }>`
        SELECT thread_id, model, account_id FROM provider_sessions WHERE agent_id = 'codex' ORDER BY started_at`
      assert.deepStrictEqual(
        ran.map((one) => [one.threadId, one.model, one.accountId]),
        [
          [onSol, SOL.id, plus.id],
          [onLuna, LUNA.id, main!.id],
        ],
      )
    }).pipe(Effect.provide(runtime(':memory:', {}, { each })))
  })

  it.live('never take the model a session was put on as one its account offers, until a turn on it goes through', () => {
    // The usual folder's account isn't offered GPT-6.1 Terra any more, but a session put on it lists it all the same.
    const each = accountsOffering()
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const models = yield* Models
      const sql = yield* SqlClient.SqlClient
      assert.deepStrictEqual(ids(yield* codexOf), [LUNA.id, TERRA.id])
      const [main] = yield* accounts.of('codex')
      const { threadId, projectId } = yield* taskOf
      const sessionId = `sess_${'e'.repeat(32)}`
      yield* sql`INSERT INTO provider_sessions ${sql.insert({
        id: sessionId,
        projectId,
        threadId,
        agentId: 'codex',
        accountId: main!.id,
        model: NEW_TERRA.id,
        config: offering(NEW_TERRA, [NEW_TERRA, LUNA, TERRA]),
        state: 'completed',
        startedAt: new Date().toISOString(),
      })}`
      const [codex] = (yield* models.catalog).filter((agent) => agent.agentId === 'codex')
      assert.deepStrictEqual(ids(codex), [LUNA.id, TERRA.id])
      // Nor is it what the agent is said to be on.
      assert.notStrictEqual(codex?.model, NEW_TERRA.id)
      assert.deepStrictEqual(yield* models.lacking('codex', NEW_TERRA.id), [main!.id])
      // A turn on it went through: the account is offered it after all.
      const at = new Date().toISOString()
      yield* sql`INSERT INTO turn_deliveries ${sql.insert({
        id: `turn_${'f'.repeat(32)}`,
        projectId,
        threadId,
        providerSessionId: sessionId,
        controllerGeneration: 1,
        model: NEW_TERRA.id,
        state: 'completed',
        requestedAt: at,
        endedAt: at,
      })}`
      assert.include(ids((yield* models.catalog).find((agent) => agent.agentId === 'codex')) ?? [], NEW_TERRA.id)
    }).pipe(Effect.provide(runtime(':memory:', {}, { each })))
  })

  it.live('are asked afresh of an account signed in again, which may be someone else’s sign-in now', () => {
    const each = accountsOffering()
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const models = yield* Models
      assert.deepStrictEqual(ids(yield* codexOf), [LUNA.id, TERRA.id])
      // Signed in as someone on another plan, the usual folder offers Sol now.
      each['codex@usual'] = { models: [SOL, LUNA] }
      const [main] = yield* accounts.of('codex')
      yield* models.forgetAccount(main!.id)
      assert.deepStrictEqual(ids(yield* codexOf), [SOL.id, LUNA.id])
    }).pipe(Effect.provide(runtime(':memory:', {}, { each })))
  })

  it.live('are asked afresh as the sign-in is checked again, after it was opened in Terminal, where Althar can’t see it end', () => {
    const each = accountsOffering()
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const models = yield* Models
      const [main] = yield* accounts.of('codex')
      assert.deepStrictEqual(ids(yield* codexOf), [LUNA.id, TERRA.id])
      // Opened in Terminal and asked at once, while the old sign-in is still there.
      yield* models.signingIn(main!.id)
      assert.deepStrictEqual(ids(yield* codexOf), [LUNA.id, TERRA.id])
      // The sign-in done, as the window comes back to the front and checks it again: the new one's models.
      each['codex@usual'] = { models: [SOL, LUNA] }
      yield* models.signInChecked(main!.id)
      assert.deepStrictEqual(ids(yield* codexOf), [SOL.id, LUNA.id])
      // An account no sign-in was opened for isn't asked again by a check.
      const plus = yield* accounts.add({ agentId: 'codex', name: 'Plus' })
      each[`codex@${basename(plus.home ?? '')}`] = { models: [NEW_TERRA] }
      assert.include(ids(yield* codexOf) ?? [], NEW_TERRA.id)
      each[`codex@${basename(plus.home ?? '')}`] = { models: [TERRA] }
      yield* models.signInChecked(plus.id)
      assert.include(ids(yield* codexOf) ?? [], NEW_TERRA.id)
    }).pipe(Effect.provide(runtime(':memory:', {}, { each })))
  })

  it('are merged in the accounts’ order, each model’s efforts from the first that knows them', () => {
    const efforts = [{ id: 'high', name: 'High' }]
    const offer = (
      models: ReadonlyArray<{ id: string; efforts?: ReadonlyArray<{ id: string; name: string }> }>,
      images: boolean | null,
    ) => ({
      agentId: 'codex',
      models: models.map((model) => ({ id: model.id, name: model.id, description: null, efforts: model.efforts ?? [], effort: null })),
      model: models[0]?.id ?? null,
      effort: null,
      images,
    })
    const merged = mergeOffers([offer([{ id: 'a' }, { id: 'b' }], null), offer([{ id: 'c' }, { id: 'a', efforts }], true)])
    assert.deepStrictEqual(
      merged?.models.map((model) => [model.id, model.efforts.length]),
      [
        ['a', 1],
        ['b', 0],
        ['c', 0],
      ],
    )
    assert.deepStrictEqual([merged?.model, merged?.images], ['a', true])
    assert.isUndefined(mergeOffers([]))
  })
})

describe('a step handed over or moved', () => {
  it.live('is offered and handed to an account that offers its model, never one known not to', () => {
    const each = accountsOffering()
    return Effect.gen(function* () {
      const limits = yield* Limits
      const { main, plus } = yield* mainAndPlus(each)
      const { projectId } = yield* taskOf
      // The person's choices, as a usage limit asks them: the usual account runs its own default rather than Sol.
      const offered = yield* limits.choices({ accountId: null, projectId, planned: { agentId: 'codex', model: SOL.id } })
      assert.deepInclude(offered, { agentId: 'codex', accountId: main.id, model: null })
      assert.deepInclude(offered, { agentId: 'codex', accountId: plus.id, model: SOL.id })
      // Handed over by itself, Sol goes with the account that offers it.
      const free = yield* limits.free({ besides: ['claude-code', 'opencode'], projectId, planned: { agentId: 'codex', model: SOL.id } })
      assert.deepInclude(free, { agentId: 'codex', model: SOL.id, accountId: plus.id })
      // An account given that doesn't offer it, as a choice read before it said: the step goes to one that does.
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', accountId: main.id, model: SOL.id })).id, plus.id)
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', accountId: main.id, model: LUNA.id })).id, main.id)
    }).pipe(Effect.provide(runtime(':memory:', {}, { each })))
  })

  it.live('is refused, and its model not listed, where the project keeps out the only account that offers it', () => {
    const each = accountsOffering()
    return Effect.gen(function* () {
      const limits = yield* Limits
      const { main } = yield* mainAndPlus(each)
      const { projectId, threadId } = yield* taskOf
      yield* applyRules(projectId, { onlyAccounts: { codex: [main.id] } }, (yield* Instance).personId)
      const refused = yield* Effect.flip(limits.pick({ agentId: 'codex', projectId, model: SOL.id }))
      assert.deepInclude(refused, { _tag: 'NotFound', kind: 'offered_model' })
      // Named with the account, as a stand-in or a choice kept from before is: refused all the same.
      assert.deepInclude(yield* Effect.flip(limits.pick({ agentId: 'codex', projectId, accountId: main.id, model: SOL.id })), {
        _tag: 'NotFound',
        kind: 'offered_model',
      })
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', projectId, accountId: main.id, model: LUNA.id })).id, main.id)
      const listed = yield* usableModels(projectId)
      assert.isFalse(listed.some((model) => model.routes.some((route) => route.agentId === 'codex' && route.model === SOL.id)))
      assert.isTrue(listed.some((model) => model.routes.some((route) => route.agentId === 'codex' && route.model === LUNA.id)))
      // Where no account is known to offer it, as an agent's older list leaves a model out, it runs as before.
      assert.strictEqual((yield* limits.pick({ agentId: 'codex', projectId, model: 'gpt-0-unlisted' })).id, main.id)
      // The person's message waits for a lead started on that model: refused before any session, the thread says why, and the
      // start can be tried again, so the message isn't left on its way to no one.
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId, body: 'Use Sol.' })
      const unstarted = yield* Effect.flip(sessions.start({ threadId, agentId: 'codex', model: SOL.id, waitsAside: true }))
      assert.deepInclude(unstarted, { _tag: 'NotFound', kind: 'offered_model' })
      assert.lengthOf(yield* sql`SELECT id FROM provider_sessions WHERE thread_id = ${threadId}`, 0)
      const [said] = yield* sql<{ description: string; agentId: string; model: string }>`
        SELECT json_extract(content, '$.description') AS description, json_extract(content, '$.startFailed.agentId') AS agent_id,
          json_extract(content, '$.startFailed.model') AS model
        FROM thread_items WHERE thread_id = ${threadId} AND kind = 'notice' AND json_extract(content, '$.startFailed') IS NOT NULL`
      assert.deepStrictEqual(said, {
        description:
          'No account this project uses offers that model. Allow the account that does in the project’s settings, or pick another model.',
        agentId: 'codex',
        model: SOL.id,
      })
      assert.isTrue(yield* sessions.retryable(threadId))
    }).pipe(Effect.provide(runtime(':memory:', {}, { each })))
  })
})

describe('an account that couldn’t say what it offers', () => {
  it.live('offers what its latest session did, beside another account that said', () => {
    const each = accountsOffering()
    const signedOut: Array<string> = []
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const sql = yield* SqlClient.SqlClient
      assert.deepStrictEqual(ids(yield* codexOf), [LUNA.id, TERRA.id])
      const plus = yield* accounts.add({ agentId: 'codex', name: 'Plus' })
      // Its asking can't go through, as with its sign-in being checked; a session on it offered Sol earlier.
      signedOut.push(plus.home ?? '')
      const { threadId, projectId } = yield* taskOf
      yield* sql`INSERT INTO provider_sessions ${sql.insert({
        id: `sess_${'d'.repeat(32)}`,
        projectId,
        threadId,
        agentId: 'codex',
        accountId: plus.id,
        model: LUNA.id,
        config: offering(LUNA, [LUNA, SOL]),
        state: 'completed',
        startedAt: new Date().toISOString(),
      })}`
      assert.deepStrictEqual(ids(yield* codexOf), [LUNA.id, TERRA.id, SOL.id])
    }).pipe(Effect.provide(runtime(':memory:', {}, { each, signedOut })))
  })
})

describe('the usual folder’s account', () => {
  it.live('is signed out with the agent’s own command, in the usual folder, and stays, to sign in again', () =>
    Effect.gen(function* () {
      const accounts = yield* Accounts
      const [main] = yield* accounts.of('codex')
      const signedOut = join(mkdtempSync(join(tmpdir(), 'althar-signed-out-')), 'homes')
      process.env.FAKE_SIGNED_OUT = signedOut
      try {
        yield* accounts.signOut(main!.id)
      } finally {
        delete process.env.FAKE_SIGNED_OUT
      }
      // No home of Althar's: the agent's own, where its own command reads its sign-in too.
      assert.strictEqual(readFileSync(signedOut, 'utf8'), '\n')
      assert.deepStrictEqual(
        (yield* accounts.of('codex')).map((account) => account.id),
        [main!.id],
      )
      // Where the agent didn't sign it out, the line that does.
      process.env.FAKE_SIGN_OUT_FAILS = '1'
      try {
        assert.deepStrictEqual(yield* Effect.flip(accounts.signOut(main!.id)), new SignOutFailed({ line: 'fake-logout', staying: true }))
      } finally {
        delete process.env.FAKE_SIGN_OUT_FAILS
      }
    }).pipe(Effect.provide(runtime())),
  )
})
