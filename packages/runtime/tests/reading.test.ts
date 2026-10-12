import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { DocumentRefused, NotFound } from '../src/errors'
import { DOCUMENT_READ, documentText } from '../src/reading'

/** Two worktrees, as a task of two repositories has, and a folder outside them. */
const folders = () => {
  const one = mkdtempSync(join(tmpdir(), 'althar-one-'))
  const two = mkdtempSync(join(tmpdir(), 'althar-two-'))
  const outside = mkdtempSync(join(tmpdir(), 'althar-outside-'))
  mkdirSync(join(two, 'docs'))
  writeFileSync(join(two, 'docs', 'plan.md'), '# Plan\n\nOne line.\n')
  writeFileSync(join(outside, 'secret.md'), '# Secret\n')
  symlinkSync(join(outside, 'secret.md'), join(one, 'leak.md'))
  writeFileSync(join(one, 'huge.md'), Buffer.alloc(DOCUMENT_READ + 1, 'a'))
  mkdirSync(join(one, 'folder.md'))
  return { one, two, outside, worktrees: [one, two] }
}

describe('reading a document an agent wrote', () => {
  it.effect('reads a markdown file inside a worktree, whole or from a worktree’s root', () =>
    Effect.gen(function* () {
      const { two, worktrees } = folders()
      const whole = yield* documentText(join(two, 'docs', 'plan.md'), worktrees)
      assert.deepStrictEqual(whole, { path: join(two, 'docs', 'plan.md'), body: '# Plan\n\nOne line.\n', bytes: 18, lines: 3 })
      // A path from a worktree's root names the first worktree's file, as the window names it.
      assert.instanceOf(yield* Effect.flip(documentText('docs/plan.md', worktrees)), NotFound)
    }),
  )

  it.effect('reads a document by the one path it names, and never another repository’s file of the same name', () =>
    Effect.gen(function* () {
      const { one, two, worktrees } = folders()
      mkdirSync(join(one, 'docs'))
      writeFileSync(join(one, 'docs', 'plan.md'), '# The first repository’s plan\n')
      assert.strictEqual((yield* documentText('docs/plan.md', worktrees)).body, '# The first repository’s plan\n')
      // Gone from the repository it was written in: not found, rather than the other's file of the same name.
      rmSync(join(one, 'docs', 'plan.md'))
      assert.instanceOf(yield* Effect.flip(documentText(join(one, 'docs', 'plan.md'), worktrees)), NotFound)
      assert.instanceOf(yield* Effect.flip(documentText('docs/plan.md', worktrees)), NotFound)
      assert.strictEqual((yield* documentText(join(two, 'docs', 'plan.md'), worktrees)).body, '# Plan\n\nOne line.\n')
    }),
  )

  it.effect('refuses what isn’t markdown, what is outside, links out included, and what is too large', () =>
    Effect.gen(function* () {
      const { outside, worktrees } = folders()
      const reason = (path: string) =>
        Effect.map(Effect.flip(documentText(path, worktrees)), (error) => (error instanceof DocumentRefused ? error.reason : error._tag))
      assert.strictEqual(yield* reason('docs/plan.txt'), 'not_markdown')
      assert.strictEqual(yield* reason(join(outside, 'secret.md')), 'outside')
      assert.strictEqual(yield* reason('leak.md'), 'outside')
      assert.strictEqual(yield* reason('huge.md'), 'too_large')
      assert.strictEqual(yield* reason('folder.md'), 'NotFound')
      assert.instanceOf(yield* Effect.flip(documentText('gone.md', worktrees)), NotFound)
    }),
  )
})
