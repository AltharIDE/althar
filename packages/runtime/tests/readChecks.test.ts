import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import type { CodeHost, Check } from '@althar/connectors'
import { makeFakeService } from '@althar/connectors/testing'
import { ARTIFACT_CAP, LOG_CAP, OUTPUT_CAP, cleanLog, inspectChecks } from '../src/readChecks'

const check: Check = { id: 'run:7:github-actions', name: 'verify', state: 'passed', url: 'https://ci.example/7', summary: null }
const setup = (more: Partial<CodeHost> = {}) => {
  const fake = makeFakeService()
  const repository = fake.addRepository(['meridian', 'api'])
  const host: CodeHost = {
    ...fake,
    checks: () => Effect.succeed([check]),
    checkLog: () => Effect.succeed('one\nFAIL test\nthree\nfour'),
    ...more,
  }
  return { host, repository }
}
const folder = () => mkdtempSync(join(tmpdir(), 'althar-read-checks-'))

describe('bounded CI inspection', () => {
  it.effect('lists checks for the requested branch or commit, including passing jobs', () =>
    Effect.gen(function* () {
      const refs: string[] = []
      const { host, repository } = setup({
        checks: (_, ref) => {
          refs.push(ref)
          return Effect.succeed([check])
        },
      })
      const list = yield* inspectChecks(host, repository, 'main', undefined, {})
      assert.include(list, 'run:7:github-actions | verify')
      assert.include(list, 'passed')
      yield* inspectChecks(host, repository, 'abc123', undefined, {})
      assert.deepEqual(refs, ['main', 'abc123'])
    }),
  )
  it.effect('reads tails, ranges and literal grep with context', () =>
    Effect.gen(function* () {
      const { host, repository } = setup()
      const read = (asked: Parameters<typeof inspectChecks>[4]) =>
        inspectChecks(host, repository, 'sha', undefined, { check: 'verify', ...asked })
      const tail = yield* read({ tail: 2 })
      assert.include(tail, '3: three\n4: four')
      assert.notInclude(tail, '1: one')
      assert.include(yield* read({ from_line: 2, to_line: 3 }), '2: FAIL test\n3: three')
      assert.include(yield* read({ grep: 'fail', context: 1 }), '1: one\n2: FAIL test\n3: three')
      assert.include(yield* read({ grep: '(a+)+$' }), 'No matches.')
    }),
  )
  it('strips timestamps, ANSI and group markers while retaining step headings', () => {
    assert.equal(cleanLog('2026-10-31T12:00:00.123Z ##[group]Test\n\x1b[31mFAIL\x1b[0m\n##[endgroup]'), '## Test\nFAIL\n')
  })
  it.effect('saves a full cleaned log into scratch and refuses to overwrite it', () =>
    Effect.gen(function* () {
      const { host, repository } = setup()
      const root = folder()
      execFileSync('git', ['init', '-q'], { cwd: root })
      const result = yield* inspectChecks(host, repository, 'sha', root, { check: check.id, save: true })
      const path = result.replace('Saved full cleaned log: ', '')
      assert.equal(readFileSync(join(root, path), 'utf8'), 'one\nFAIL test\nthree\nfour')
      assert.equal(execFileSync('git', ['check-ignore', path], { cwd: root, encoding: 'utf8' }).trim(), path)
      assert.include(
        (yield* Effect.flip(inspectChecks(host, repository, 'sha', root, { check: check.id, save: true }))).message,
        "Couldn't save",
      )
    }),
  )
  it.effect('lists and downloads small artifacts as bytes, without extraction', () =>
    Effect.gen(function* () {
      const bytes = new Uint8Array([80, 75, 0, 255])
      const { host, repository } = setup({
        checkArtifacts: () => Effect.succeed([{ id: '42', name: '../../coverage', size: bytes.length }]),
        checkArtifact: (_, id, cap) => {
          assert.equal(id, '42')
          assert.equal(cap, ARTIFACT_CAP)
          return Effect.succeed(bytes)
        },
      })
      const root = folder()
      assert.include(yield* inspectChecks(host, repository, 'sha', root, { check: 'verify', artifacts: true }), 'coverage')
      const result = yield* inspectChecks(host, repository, 'sha', root, { check: 'verify', artifact: '42' })
      assert.deepEqual([...readFileSync(join(root, result.split(': ').at(-1)!))], [...bytes])
    }),
  )
  it.effect('caps declared and actual artifact sizes, full logs and context output', () =>
    Effect.gen(function* () {
      let downloads = 0
      const { host, repository } = setup({
        checkLog: () => Effect.succeed('x'.repeat(LOG_CAP + 1)),
        checkArtifacts: () => Effect.succeed([{ id: '1', name: 'big', size: ARTIFACT_CAP + 1 }]),
        checkArtifact: () => {
          downloads++
          return Effect.succeed(new Uint8Array(ARTIFACT_CAP + 1))
        },
      })
      assert.include(yield* inspectChecks(host, repository, 'sha', folder(), { check: 'verify', save: true }), '16 MiB')
      assert.include(yield* inspectChecks(host, repository, 'sha', folder(), { check: 'verify', artifact: 'big' }), '5 MiB')
      assert.equal(downloads, 0)
      const actual = { ...host, checkArtifacts: () => Effect.succeed([{ id: '1', name: 'big', size: 1 }]) }
      assert.include(yield* inspectChecks(actual, repository, 'sha', folder(), { check: 'verify', artifact: 'big' }), '5 MiB')
      assert.equal(downloads, 1)
    }),
  )
  it.effect('caps a huge line and rejects symlink scratch directories', () =>
    Effect.gen(function* () {
      const { host, repository } = setup({ checkLog: () => Effect.succeed('界'.repeat(OUTPUT_CAP)) })
      const result = yield* inspectChecks(host, repository, 'sha', undefined, { check: 'verify' })
      assert.isAtMost(Buffer.byteLength(result), OUTPUT_CAP)
      assert.include(result, 'capped')
      const root = folder()
      symlinkSync(folder(), join(root, '.althar'))
      assert.include((yield* Effect.flip(inspectChecks(host, repository, 'sha', root, { check: 'verify', save: true }))).message, 'symlink')
    }),
  )
  it.effect('reads annotations and plainly reports checks without logs', () =>
    Effect.gen(function* () {
      const { host, repository } = setup({
        checkLog: () => Effect.succeed(null),
        checkAnnotations: () => Effect.succeed([{ path: 'a.ts', line: 4, message: 'Bad type' }]),
      })
      assert.include(yield* inspectChecks(host, repository, 'sha', undefined, { check: 'verify' }), 'keeps no log')
      assert.include(yield* inspectChecks(host, repository, 'sha', undefined, { check: 'verify', annotations: true }), 'Bad type')
    }),
  )
})
