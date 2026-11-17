import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Database } from '@althar/persistence-sqlite'
import { assert, describe, it } from '@effect/vitest'

/*
 * The store keeps each statement it prepares (persistence-sqlite's
 * Database.ts), more of them than the runtime has: a board's cards run
 * hundreds a read, and with the client's 200 each read prepared most of them
 * again, pushed out by the ones before.
 */

/** Each statement the runtime writes out, as a tagged template or an unsafe one. */
const SITE = /\b\w*[sS]ql(?:<[^`]*?>)?`|\bsql\.unsafe\(/g

describe('the store’s prepared statements', () => {
  it('are kept for more statements than the runtime has', () => {
    const folder = join(import.meta.dirname, '../src')
    const sites = readdirSync(folder, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts'))
      .reduce((sum, name) => sum + (readFileSync(join(folder, name), 'utf8').match(SITE)?.length ?? 0), 0)
    assert.isAbove(sites, 1_000)
    assert.isBelow(sites, Database.PREPARED)
  })
})
