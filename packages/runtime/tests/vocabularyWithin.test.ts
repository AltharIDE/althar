import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { branchedWords } from '../src/firstWrite'
import { vocabulary } from '../src/vocabulary'
import { repository } from './support'

/*
 * The project's words, as dictation is primed with them, where a project is
 * a folder inside its repository, and where a source file is binary; and
 * where a task's work is, in words, on one branch or several.
 */

const commitAll = (path: string) => {
  execFileSync('git', ['add', '.'], { cwd: path })
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', 'commit', '-q', '-m', 'Code'], { cwd: path })
}

describe('a project’s words', () => {
  it.effect('are only its folder’s, where the project is a folder inside its repository, and none of a binary file', () =>
    Effect.gen(function* () {
      const path = repository()
      mkdirSync(join(path, 'packages', 'refunds'), { recursive: true })
      mkdirSync(join(path, 'packages', 'charges'), { recursive: true })
      writeFileSync(
        join(path, 'packages', 'refunds', 'ledger.ts'),
        'export const settleRefundLedger = (refundBatch: number) => refundBatch\n',
      )
      writeFileSync(join(path, 'packages', 'charges', 'charge.ts'), 'export const captureChargeIntent = () => 1\n')
      // A source file that is binary inside says nothing.
      writeFileSync(
        join(path, 'packages', 'refunds', 'blob.ts'),
        Buffer.from([0x65, 0x78, 0x00, 0x6d, 0x61, 0x6b, 0x65, 0x42, 0x6c, 0x6f, 0x62]),
      )
      commitAll(path)
      const words = yield* vocabulary('meridian', [{ name: 'api', path, within: 'packages/refunds' }])
      assert.includeMembers([...words], ['settleRefundLedger', 'refundBatch'])
      assert.notInclude([...words], 'captureChargeIntent')
      assert.notInclude([...words], 'makeBlob')
    }),
  )
})

describe('where a task’s work is', () => {
  it('is its branch, said once where its repositories share it, or each of them', () => {
    assert.strictEqual(branchedWords(['althar/retry', 'althar/retry']), 'on its branch althar/retry')
    assert.strictEqual(branchedWords(['althar/retry', 'althar/retry-web']), 'on its branches althar/retry, althar/retry-web')
  })
})
