import { type AccessList, indexList, isPermission } from '@althar/access'
import { Api } from '@althar/contracts'
import { Database } from '@althar/persistence-sqlite'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Option } from 'effect'

import { type ApiTag, callAccess, decideCall, locatorField, locatorTable, projectOf } from '../src/callAccess'

const requests = [...(Api as unknown as { readonly requests: ReadonlyMap<string, { readonly payloadSchema: unknown }> }).requests]
const fieldsOf = (schema: unknown): ReadonlyArray<string> => Object.keys((schema as { fields?: object }).fields ?? {})

const hex = (n: number) => n.toString(16).padStart(32, '0')
const ana = `act_${hex(1)}`
const owner = `act_${hex(2)}`
const storefront = `proj_${hex(1)}`
const list: AccessList = {
  catalog: 1,
  home: `home_${hex(1)}`,
  organization: `org_${hex(1)}`,
  revision: 1,
  issuedAt: '2025-11-26T00:00:00.000Z',
  expiresAt: '2025-11-28T00:00:00.000Z',
  baseAccess: 'view',
  membersMayInvite: false,
  membersMayCreateProjects: false,
  teams: [],
  functions: [],
  people: [
    { id: ana, name: 'Ana', role: 'member', teams: [], functions: [], projectFunctions: [], passkeys: [] },
    { id: owner, name: 'Olivia', role: 'owner', teams: [], functions: [], projectFunctions: [], passkeys: [] },
  ],
  serviceAccounts: [],
  projects: [{ id: storefront, team: null, private: false }],
  grants: [],
}
const index = indexList(list)
const now = Date.parse('2025-11-27T00:00:00.000Z')
const person = (id: string) => ({ kind: 'person' as const, id })

describe('what every call needs from a member', () => {
  it('names every call of the API, and nothing else', () => {
    const tags = requests.map(([tag]) => tag).sort()
    assert.deepStrictEqual(Object.keys(callAccess).sort(), tags)
  })

  it('finds each call’s project in a field its payload has, and checks a real permission', () => {
    const wrong: Array<string> = []
    for (const [tag, rpc] of requests) {
      const access = callAccess[tag as ApiTag]
      if (access.kind === 'organization' || access.kind === 'project')
        if (!isPermission(access.permission)) wrong.push(`${tag}: ${access.permission}`)
      if (access.kind !== 'project') continue
      const field = locatorField[access.from]
      if (!fieldsOf(rpc.payloadSchema).includes(field)) wrong.push(`${tag}: no ${field} in its payload`)
    }
    assert.deepStrictEqual(wrong, [])
  })

  it.effect('looks each stored locator up in a table that has the id and the project', () =>
    Effect.gen(function* () {
      for (const [locator, table] of Object.entries(locatorTable)) {
        const found = yield* projectOf(locator as keyof typeof locatorTable, {
          [locatorField[locator as keyof typeof locatorField]]: 'missing',
        })
        assert.isTrue(Option.isNone(found), `${table} answered for an id it doesn't have`)
      }
      assert.deepStrictEqual(yield* projectOf('project', { projectId: storefront }), Option.some(storefront))
      assert.deepStrictEqual(yield* projectOf('task', { taskId: 7 }), Option.none())
      assert.deepStrictEqual(yield* projectOf('terminal', { id: 'term_abcdef' }), Option.none())
      assert.deepStrictEqual(yield* projectOf('thread', null), Option.none())
    }).pipe(Effect.provide(Database.layer({ filename: ':memory:' }))),
  )
})

describe('deciding a member’s call', () => {
  const decide = (actor: string, tag: ApiTag, payload: unknown, at = now) =>
    decideCall(index, person(actor), tag, payload, at).pipe(Effect.provide(Database.layer({ filename: ':memory:' })))

  it.effect('allows the connection’s own calls, and cuts what spans projects to those the member sees', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* decide(ana, 'Status', {}), { allowed: true })
      assert.deepStrictEqual(yield* decide(ana, 'ListProjects', {}), { allowed: true, only: new Set([storefront]) })
    }),
  )

  it.effect('checks a project call against the member’s access there', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* decide(ana, 'GetBoard', { projectId: storefront }), { allowed: true })
      assert.deepStrictEqual(yield* decide(ana, 'RenameProject', { projectId: storefront, name: 'x' }), {
        allowed: false,
        reason: 'not_permitted',
      })
      assert.deepStrictEqual(yield* decide(owner, 'RenameProject', { projectId: storefront, name: 'x' }), { allowed: true })
      assert.deepStrictEqual(yield* decide(ana, 'SeeTask', { taskId: `task_${hex(9)}` }), { allowed: false, reason: 'not_found' })
    }),
  )

  it.effect('checks the home’s own calls against the organization role, and keeps personal ones unshared', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* decide(ana, 'CreatePairingCode', {}), { allowed: false, reason: 'not_permitted' })
      assert.deepStrictEqual(yield* decide(owner, 'CreatePairingCode', {}), { allowed: true })
      assert.deepStrictEqual(yield* decide(owner, 'AddAccount', {}), { allowed: false, reason: 'not_permitted' })
    }),
  )

  it.effect('refuses everything once the list has expired', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* decide(owner, 'Status', {}, Date.parse(list.expiresAt)), { allowed: false, reason: 'list_expired' })
    }),
  )
})
