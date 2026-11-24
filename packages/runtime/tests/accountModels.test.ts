import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import type { FakeAgentOptions } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts, SignOutFailed } from '../src/Accounts'
import { Limits } from '../src/Limits'
import { mergeOffers, Models } from '../src/Models'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
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

/** A task's thread, for a session to run on. */
const thread = Effect.gen(function* () {
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const created = yield* projects.createTask({
    envelope: yield* Runtime.envelope('task.create', {}),
    projectId: project.projectId,
    title: 'Retry the checkout',
  })
  return created.threadId
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

  it.live('never take the model a session was put on as one its account offers', () => {
    // The usual folder's account isn't offered GPT-6.1 Terra any more, but a session put on it lists it all the same.
    const each = accountsOffering()
    return Effect.gen(function* () {
      const accounts = yield* Accounts
      const sessions = yield* Sessions
      const models = yield* Models
      assert.deepStrictEqual(ids(yield* codexOf), [LUNA.id, TERRA.id])
      each['codex@usual'] = { models: [NEW_TERRA, LUNA, TERRA] }
      const threadId = yield* thread
      yield* sessions.start({ threadId, agentId: 'codex', model: NEW_TERRA.id })
      // It is on Terra, and lists it, but offers nothing else new: Terra isn't the account's.
      each['codex@usual'] = { models: [LUNA, TERRA] }
      const sql = yield* SqlClient.SqlClient
      const [main] = yield* accounts.of('codex')
      const [row] = yield* sql<{ accountId: string | null }>`SELECT account_id FROM provider_sessions WHERE thread_id = ${threadId}`
      assert.strictEqual(row?.accountId, main!.id)
      const [codex] = (yield* models.catalog).filter((agent) => agent.agentId === 'codex')
      assert.deepStrictEqual(ids(codex), [LUNA.id, TERRA.id])
      // Nor is it what the agent is said to be on.
      assert.notStrictEqual(codex?.model, NEW_TERRA.id)
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
