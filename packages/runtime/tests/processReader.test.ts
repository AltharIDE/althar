import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { vi } from 'vitest'

/*
 * The Mac reader (processReader.ts) built where it can be: a first ask says
 * there is none while it builds, and a later one gives its path. Where it
 * can't be built, as on CI's Linux, every ask says so. A command it can't
 * run at all is no output rather than a failure.
 */

describe('the process reader on a Mac', () => {
  it.live('builds once where it can, says it has none where it can’t, and reads nothing from a path that isn’t there', () =>
    Effect.gen(function* () {
      // A module of its own: what another test built, or tried to, isn't this one's.
      vi.resetModules()
      const reader = yield* Effect.promise(() => import('../src/processReader'))
      const missing = join(tmpdir(), `althar-no-reader-${process.pid}`)
      assert.isNull(yield* Effect.promise(() => reader.runReader(missing)))
      // A path Node can't even hand to a command, as a NUL is: no output, not a thrown error.
      assert.isNull(yield* Effect.promise(() => reader.runReader('\0')))
      const folder = mkdtempSync(join(tmpdir(), 'althar-reader-'))
      const built = yield* Effect.promise(() => reader.buildReader(folder))
      assert.isTrue(built === null || existsSync(built))
      assert.strictEqual(reader.processReader(), built)
    }),
  )
})
