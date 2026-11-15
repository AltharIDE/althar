import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { configuredHome } from '../src/configuration'
import { parseOptions } from '../src/options'
import { temporary } from './support'

const fixture = () => {
  const root = temporary()
  const options = parseOptions(['init', '--profile', join(root, 'profile'), '--worktrees', join(root, 'volume')], {}, root)
  return { root, options }
}

describe('persistent host configuration', () => {
  it.live('reuses the stored worktree location and never replaces a missing disk with an empty directory', () =>
    Effect.gen(function* () {
      const { options } = fixture()
      const initial = yield* configuredHome(options, true)
      const stored = readFileSync(join(options.profile, 'host.json'), 'utf8')
      const defaults = { ...options, worktreesExplicit: false, worktrees: join(options.profile, 'worktrees') }
      assert.strictEqual((yield* configuredHome(defaults)).worktrees, initial.worktrees)
      yield* configuredHome(defaults, true)
      assert.strictEqual(readFileSync(join(options.profile, 'host.json'), 'utf8'), stored)
      renameSync(options.worktrees, `${options.worktrees}.offline`)
      assert.strictEqual((yield* Effect.flip(configuredHome(defaults))).code, 'NotInitialized')
      assert.isFalse(existsSync(options.worktrees))
      assert.isFalse(existsSync(defaults.worktrees))
    }),
  )

  it.live('requires an explicit migration before moving worktrees and fails closed on damaged configuration', () =>
    Effect.gen(function* () {
      const { root, options } = fixture()
      yield* configuredHome(options, true)
      const other = join(root, 'other')
      mkdirSync(other, { mode: 0o700 })
      assert.strictEqual((yield* Effect.flip(configuredHome({ ...options, worktrees: other }))).code, 'InvalidConfig')
      for (const data of [
        '{',
        JSON.stringify({ version: 2 }),
        JSON.stringify({ version: 1, worktrees: '../relative' }),
        JSON.stringify({ version: 1, worktrees: '/bad\npath' }),
      ]) {
        writeFileSync(join(options.profile, 'host.json'), data)
        assert.strictEqual((yield* Effect.flip(configuredHome(options))).code, 'InvalidConfig')
      }
    }),
  )

  it.live('does not silently initialize an unconfigured profile on serve', () =>
    Effect.gen(function* () {
      const { options } = fixture()
      mkdirSync(options.profile, { mode: 0o700 })
      assert.strictEqual((yield* Effect.flip(configuredHome(options))).code, 'NotInitialized')
      assert.isFalse(existsSync(join(options.profile, 'host.json')))
    }),
  )
})
