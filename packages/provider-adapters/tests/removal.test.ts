import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit, Logger } from 'effect'

import { cleanUp, RemoveFailed, removeFully } from '../src/removal'

/** A folder with a file and a folder in it, in a temporary folder of its own. */
const filled = () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-removal-'))
  const folder = join(root, 'work')
  mkdirSync(join(folder, 'inside'), { recursive: true })
  writeFileSync(join(folder, 'inside', 'file'), 'kept a while')
  return { root, folder }
}

/**
 * A folder something in it can't be removed from, as Windows holds one a moment after a process: here a folder in it
 * that can't be written to. `release` lets it go, for the test's own clearing up.
 */
const held = () => {
  const { root, folder } = filled()
  const locked = join(folder, 'inside')
  chmodSync(locked, 0o555)
  return { root, folder, release: () => chmodSync(locked, 0o755) }
}

/** What was logged while `effect` ran, at which level. */
const logged = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const lines: Array<{ readonly level: string; readonly message: string }> = []
    const logger = Logger.make(({ logLevel, message }) => void lines.push({ level: logLevel, message: String(message) }))
    const exit = yield* Effect.exit(effect.pipe(Effect.provide(Logger.layer([logger]))))
    return { exit, lines }
  })

/** A folder can't be held from its owner on Windows, and nothing is held from root. */
const holds = process.platform !== 'win32' && process.getuid?.() !== 0

describe('removing', () => {
  it.live('removes a folder and everything in it, a file, and nothing where nothing is', () =>
    Effect.gen(function* () {
      const { root, folder } = filled()
      yield* removeFully(folder)
      assert.isFalse(existsSync(folder))
      const file = join(root, 'file')
      writeFileSync(file, '')
      yield* cleanUp(file, 'a file kept a while')
      assert.isFalse(existsSync(file))
      yield* removeFully(join(root, 'never-there'))
      yield* removeFully(root)
    }),
  )

  it.live.skipIf(!holds)('says what stayed where the removal is the work', () =>
    Effect.gen(function* () {
      const { root, folder, release } = held()
      const exit = yield* Effect.exit(removeFully(folder))
      release()
      yield* removeFully(root)
      assert.isTrue(Exit.isFailure(exit))
      const failure = Exit.isFailure(exit) ? exit.cause.reasons[0] : undefined
      const error = failure?._tag === 'Fail' ? failure.error : undefined
      assert.instanceOf(error, RemoveFailed)
      assert.strictEqual(error?.path, folder)
    }),
  )

  it.live.skipIf(!holds)('never fails cleaning up after work: what stays is logged as a warning, with what it was for, and left', () =>
    Effect.gen(function* () {
      const { root, folder, release } = held()
      const { exit, lines } = yield* logged(cleanUp(folder, 'where an agent was asked its models'))
      const stayed = existsSync(join(folder, 'inside', 'file'))
      release()
      yield* removeFully(root)
      assert.isTrue(Exit.isSuccess(exit))
      assert.isTrue(stayed)
      assert.lengthOf(lines, 1)
      assert.strictEqual(lines[0]?.level, 'Warn')
      assert.include(lines[0]?.message, `Could not remove ${folder}, where an agent was asked its models`)
    }),
  )
})
