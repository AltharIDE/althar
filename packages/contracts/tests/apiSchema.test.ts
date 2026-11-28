import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'

import { apiSchema } from '../scripts/apiSchema'
import { SOCKET_CALLS } from '../src/Api'

type Wire = { readonly rpcs: Readonly<Record<string, { readonly socket: boolean }>> } & Readonly<Record<string, unknown>>

const committed: Wire = JSON.parse(readFileSync(join(import.meta.dirname, '../api.schema.json'), 'utf8'))

const REVIEW =
  'The wire changed. Run `bun run snapshot` in packages/contracts and review the diff of api.schema.json: ' +
  'a changed snapshot is a change to what crosses between a home and its clients, which a reviewer approves. ' +
  'Mind the clients already out there (docs/decisions/foundations.md, "Clients of another version").'

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** What differs between two snapshots, by call and by definition, so the failure names what changed. */
const differences = (before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>, at = ''): Array<string> =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].toSorted().flatMap((key) => {
    const was = before[key]
    const is = after[key]
    if (was === undefined) return [`${at}${key} added`]
    if (is === undefined) return [`${at}${key} removed`]
    if (JSON.stringify(was) === JSON.stringify(is)) return []
    const nested = at === '' && (key === 'rpcs' || key === '$defs')
    return nested && record(was) && record(is) ? differences(was, is, `${key}.`) : [`${at}${key} changed`]
  })

describe('the wire', () => {
  it('is as api.schema.json has it', () => {
    const now = JSON.parse(JSON.stringify(apiSchema()))
    assert.deepStrictEqual(differences(committed, now), [], REVIEW)
  })

  it('lets a socket make the calls the snapshot says, and no others', () => {
    const allowed = Object.entries(committed.rpcs).flatMap(([tag, rpc]) => (rpc.socket ? [tag] : []))
    assert.deepStrictEqual([...SOCKET_CALLS].toSorted(), allowed.toSorted(), REVIEW)
  })
})
