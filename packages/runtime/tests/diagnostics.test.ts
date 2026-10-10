import { assert, describe, it } from '@effect/vitest'
import { diagnosticOf } from '../src/diagnostics'

describe('execution diagnostics', () => {
  it('retains incremental evidence without duplicating cumulative snapshots', () => {
    const first = diagnosticOf({ kind: 'execute', rawInput: {}, outputText: ['fixture started'] })
    const second = diagnosticOf({
      kind: 'execute',
      rawInput: {},
      previous: first,
      outputText: ['fixture started\nAssertionError: wrong account'],
    })
    const last = diagnosticOf({ kind: 'execute', rawInput: {}, previous: second, rawOutput: { exitCode: 1 } })
    assert.strictEqual(last?.text, 'fixture started\nAssertionError: wrong account\nexit code: 1')
  })

  it('keeps actual assertion evidence and filters credentials before bounding', () => {
    const result = diagnosticOf({
      kind: 'execute',
      rawInput: { command: 'bun test' },
      rawOutput: {
        stderr:
          'expected account B, received account A\nAPI_KEY=sk-private-secret123\nAuthorization: Bearer abcdefghij\nhttps://alice:password@example.com',
      },
    })
    assert.include(result?.text ?? '', 'expected account B, received account A')
    assert.notInclude(result?.text ?? '', 'sk-private')
    assert.notInclude(result?.text ?? '', 'abcdefghij')
    assert.notInclude(result?.text ?? '', 'alice:password')
    assert.isTrue(result?.redacted)
  })
  it('excludes read tool and shell file bodies, unknown object fields and resource contents', () => {
    for (const kind of ['read', 'edit', 'other']) assert.isUndefined(diagnosticOf({ kind, rawInput: {}, rawOutput: 'private body' }))
    assert.isUndefined(diagnosticOf({ kind: 'execute', rawInput: { command: 'cat credentials.json' }, rawOutput: 'private body' }))
    assert.isUndefined(diagnosticOf({ kind: 'execute', rawInput: {}, rawOutput: { fileBody: 'private body' } }))
  })
  it('keeps bounded head and tail and accepts ACP text-only diagnostics', () => {
    const result = diagnosticOf({
      kind: 'execute',
      rawInput: { command: 'npm test' },
      outputText: ['setup\n' + 'x'.repeat(20_000) + '\nAssertionError: expected account B, received account A'],
    })
    assert.isTrue(result?.truncated)
    assert.isBelow(result?.text.length ?? 0, 8_100)
    assert.include(result?.text ?? '', 'setup')
    assert.include(result?.text ?? '', 'expected account B, received account A')
  })
})
