import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { ConnectorFailed, type CodeHost, type Check } from '@althar/connectors'
import { makeFakeService } from '@althar/connectors/testing'
import { ARTIFACT_CAP, LOG_CAP, OUTPUT_CAP, bounded, cleanLog, inspectChecks, saveCI } from '../src/readChecks'

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
  it.effect('retains the final failure and reports the returned lines in an oversized default tail', () =>
    Effect.gen(function* () {
      const log = Array.from({ length: 200 }, (_, i) => `line ${i + 1} ${'界'.repeat(100)}`).join('\n') + '\nFINAL FAILURE'
      const { host, repository } = setup({ checkLog: () => Effect.succeed(log) })
      const tail = yield* inspectChecks(host, repository, 'sha', undefined, { check: 'verify' })
      assert.isAtMost(Buffer.byteLength(tail), OUTPUT_CAP)
      assert.isTrue(tail.endsWith('201: FINAL FAILURE'))
      const first = Number(tail.match(/Returned lines (\d+) to 201/)?.[1])
      assert.isAbove(first, 2)
      assert.include(tail, `\n${first}: line ${first}`)
      assert.include(tail, 'earlier text omitted')
      assert.equal(yield* inspectChecks(host, repository, 'sha', undefined, { check: 'verify', grep: '' }), tail)
    }),
  )
  it.effect('reports a streamed log size limit without suggesting a retry', () =>
    Effect.gen(function* () {
      const { host, repository } = setup({
        checkLog: () =>
          Effect.fail(new ConnectorFailed({ product: 'github', reason: 'rejected', message: 'Response size cap', sizeLimit: LOG_CAP })),
      })
      const result = yield* inspectChecks(host, repository, 'sha', undefined, { check: 'verify' })
      assert.include(result, 'Log exceeds the 16 MiB size cap')
      assert.notInclude(result, 'may read it in a while')
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
        `already saved at ${path}`,
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
      const { host, repository } = setup({ checkLog: () => Effect.succeed('界'.repeat(OUTPUT_CAP) + 'FINAL FAILURE') })
      const result = yield* inspectChecks(host, repository, 'sha', undefined, { check: 'verify' })
      assert.isAtMost(Buffer.byteLength(result), OUTPUT_CAP)
      assert.include(result, 'capped')
      assert.isTrue(result.endsWith('FINAL FAILURE'))
      assert.include(result, '[line start omitted]')
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

describe('bounded CI inspection, at its edges', () => {
  it.effect('lists what the host leaves out as not reported, a duration where it says both ends, and none as none', () =>
    Effect.gen(function* () {
      const timed: Check = {
        ...check,
        id: 'run:8',
        name: 'lint',
        workflow: 'ci',
        startedAt: '2026-11-04T10:00:00Z',
        completedAt: '2026-11-04T10:01:30Z',
      }
      const { host, repository } = setup({ checks: () => Effect.succeed([{ ...check, url: null }, timed]) })
      const list = yield* inspectChecks(host, repository, 'main', undefined, {})
      assert.include(list, 'run:7:github-actions | verify | workflow: not reported | passed | duration: not reported | no URL')
      assert.include(list, 'run:8 | lint | workflow: ci | passed | duration: 90s | https://ci.example/7')
      const none = setup({ checks: () => Effect.succeed([]) })
      assert.strictEqual(
        yield* inspectChecks(none.host, none.repository, 'main', undefined, {}),
        "Checks on main (up to the host's listing limit):\nNo checks.",
      )
    }),
  )

  it.effect('asks for one check by a name two share, or one that isn’t there', () =>
    Effect.gen(function* () {
      const { host, repository } = setup({ checks: () => Effect.succeed([check, { ...check, id: 'run:9' }]) })
      for (const named of ['verify', 'missing'])
        assert.strictEqual(
          yield* inspectChecks(host, repository, 'sha', undefined, { check: named }),
          'Name one check by its unique id from read_checks; that name is missing or ambiguous.',
        )
    }),
  )

  it.effect('says what a host can’t give: annotations, artifacts, a download, a log saved without a worktree', () =>
    Effect.gen(function* () {
      // The fake host has neither annotations nor artifacts.
      const { host: bare, repository } = setup()
      const read = (asked: Parameters<typeof inspectChecks>[4], on: CodeHost = bare, workspace?: string) =>
        inspectChecks(on, repository, 'sha', workspace, { check: 'verify', ...asked })
      assert.strictEqual(yield* read({ annotations: true }), 'Annotations are not available on this host.')
      assert.strictEqual(yield* read({ artifacts: true }), 'Artifacts are not available on this host.')
      assert.strictEqual(yield* read({ save: true }), 'Saving a log needs a worktree.')
      const listed: CodeHost = {
        ...bare,
        checkArtifacts: () =>
          Effect.succeed([
            { id: '1', name: 'coverage', size: 4 },
            { id: '2', name: 'coverage', size: 4 },
          ]),
      }
      assert.strictEqual(yield* read({ artifact: 'coverage' }, listed), 'Name one artifact by its unique id from the artifact listing.')
      assert.strictEqual(
        yield* read({ artifact: '1' }, listed, folder()),
        'Artifact download is unavailable without a worktree and host support.',
      )
      assert.strictEqual(
        yield* read({ artifact: '1' }, { ...listed, checkArtifact: () => Effect.succeed(new Uint8Array(1)) }),
        'Artifact download is unavailable without a worktree and host support.',
      )
    }),
  )

  it.effect('refuses a search longer than 500 characters, and reads a context of none as none', () =>
    Effect.gen(function* () {
      const { host, repository } = setup()
      const read = (asked: Parameters<typeof inspectChecks>[4]) =>
        inspectChecks(host, repository, 'sha', undefined, { check: 'verify', ...asked })
      assert.strictEqual(yield* read({ grep: 'x'.repeat(501) }), 'Search text exceeds 500 characters.')
      const alone = yield* read({ grep: 'FAIL', context: 0 })
      assert.include(alone, '2: FAIL test')
      assert.notInclude(alone, '1: one')
      assert.notInclude(alone, '3: three')
    }),
  )

  it('caps output over 32 KiB, saying so', () => {
    assert.strictEqual(bounded('short'), 'short')
    const capped = bounded('x'.repeat(OUTPUT_CAP + 1))
    assert.isAtMost(Buffer.byteLength(capped), OUTPUT_CAP)
    assert.isTrue(capped.endsWith('[Output capped at 32 KiB; narrow the range or search.]'))
  })

  it.effect('keeps a scratch folder made before, and refuses a .gitignore there that ignores less than all of it', () =>
    Effect.gen(function* () {
      const root = folder()
      const first = yield* saveCI(root, 'one', 'log', Buffer.from('one'))
      assert.strictEqual(readFileSync(join(root, first), 'utf8'), 'one')
      // Made already, the folder is used as it is.
      const second = yield* saveCI(root, 'two', 'log', Buffer.from('two'))
      assert.strictEqual(readFileSync(join(root, second), 'utf8'), 'two')
      const tampered = folder()
      mkdirSync(join(tampered, '.althar', 'ci'), { recursive: true })
      writeFileSync(join(tampered, '.althar', 'ci', '.gitignore'), '*.log\n')
      assert.include((yield* Effect.flip(saveCI(tampered, 'three', 'log', Buffer.from('three')))).message, 'must contain only *')
      // Not a file where one is to be written: what went wrong is said.
      const taken = folder()
      const target = (yield* saveCI(taken, 'four', 'log', Buffer.from('four'))).replace('.log', '.zip')
      mkdirSync(join(taken, target))
      assert.include((yield* Effect.flip(saveCI(taken, 'four', 'zip', Buffer.from('four')))).message, "Couldn't save CI output")
    }),
  )
})
