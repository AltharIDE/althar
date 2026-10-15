import { assert, describe, it } from '@effect/vitest'

import { DIAGNOSTIC_KEPT, diagnosticIn, diagnosticOf } from '../src/diagnostics'

const failed = (over: Partial<Parameters<typeof diagnosticOf>[0]>) =>
  diagnosticOf({ command: 'bun test', printed: '', error: null, exit: null, rawOutput: undefined, ...over })

describe('what a failed command printed', () => {
  it('is what it printed, what the tool said of the failure, and its exit code', () => {
    assert.deepStrictEqual(failed({ printed: '\u001b[31mFAIL\u001b[0m a.test.ts\n', error: 'Command failed', exit: 2 }), {
      text: 'FAIL a.test.ts\nCommand failed\nexit code: 2',
      truncated: false,
      redacted: false,
    })
    // What one part says again of another is said once.
    assert.strictEqual(
      failed({ printed: 'AssertionError: expected B\n  at a.test.ts:3', error: 'AssertionError: expected B' })?.text,
      'AssertionError: expected B\n  at a.test.ts:3',
    )
    assert.strictEqual(failed({ rawOutput: { stdout: 'same', stderr: 'same' } })?.text, 'same')
  })

  it('reads the output fields of what came back only where nothing was printed, and never a whole object', () => {
    assert.strictEqual(
      failed({ rawOutput: { stdout: 'ran 3', stderr: 'AssertionError: expected B', exit_code: 1, fileBody: 'private body' } })?.text,
      'ran 3\nAssertionError: expected B\nexit code: 1',
    )
    assert.strictEqual(failed({ rawOutput: 'plain words' })?.text, 'plain words')
    assert.strictEqual(
      failed({ printed: 'what the terminal said', rawOutput: { stderr: 'said again, differently' } })?.text,
      'what the terminal said',
    )
    assert.isUndefined(failed({ rawOutput: { fileBody: 'private body' } }))
    assert.isUndefined(failed({ printed: '  \n', error: '' }))
  })

  it('takes out what looks like a credential before it is cut to size', () => {
    const result = failed({
      printed: [
        'expected account B, received account A',
        'API_KEY=sk-private-secret123',
        'Authorization: Bearer abcdefghij',
        'cloning https://alice:password@example.com/repo.git',
        'token ghp_abcdefghijklmnop1234',
        '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
      ].join('\n'),
    })
    for (const secret of ['sk-private', 'abcdefghij', 'alice:password', 'ghp_', 'MIIabc']) assert.notInclude(result?.text, secret)
    assert.include(result?.text, 'expected account B, received account A')
    assert.isTrue(result?.redacted)
  })

  it('reads a long output in time that grows with its length, not its square', () => {
    // A run of letters with no name in it (minified code, base64) once took minutes at 256 KB, and seconds at these sizes;
    // they stay within what is read for credentials, so the reading itself is timed.
    for (const printed of ['a'.repeat(60_000), `token${'a'.repeat(60_000)}`, `http://${'a:'.repeat(30_000)}`, 'sk-'.repeat(20_000)]) {
      const started = performance.now()
      assert.isDefined(failed({ printed }))
      assert.isBelow(performance.now() - started, 1_000)
    }
  })

  it('takes credentials out of a long output where it is kept, at its start and its end', () => {
    const result = failed({ printed: `API_KEY=sk-head-secret123\n${'x\n'.repeat(100_000)}"token": "tail-secret"\nFAIL` })
    assert.isTrue(result?.truncated)
    assert.isTrue(result?.redacted)
    assert.isTrue(result?.text.startsWith('API_KEY=[REDACTED]\n'))
    assert.isTrue(result?.text.endsWith('"token": [REDACTED]\nFAIL'))
    assert.strictEqual(failed({ printed: 'mysql --password=hunter2 -h db' })?.text, 'mysql --password=[REDACTED] -h db')
    assert.deepStrictEqual(failed({ printed: 'expected: 3, received: 4' }), {
      text: 'expected: 3, received: 4',
      truncated: false,
      redacted: false,
    })
  })

  it('keeps its start and its end, where the failure usually is, within the bound', () => {
    const result = failed({ printed: `setup\n${'x'.repeat(20_000)}\nAssertionError: expected account B, received account A` })
    assert.isTrue(result?.truncated)
    assert.isAtMost(result?.text.length ?? 0, DIAGNOSTIC_KEPT + 10)
    assert.isTrue(result?.text.startsWith('setup\n'))
    assert.include(result?.text, '\n[…]\n')
    assert.isTrue(result?.text.endsWith('AssertionError: expected account B, received account A'))
  })

  it('is none for a command that reads files or the environment, but one a pipe feeds is kept', () => {
    for (const command of [
      'cat credentials.json',
      'head -n 5 config.yml',
      'cd app && tail -f log',
      'ls | xargs cat',
      'grep -r token .',
      'printenv',
      'env | sort',
      'source .env && bun test',
      'openssl rsa -in key.pem # PRIVATE KEY',
    ])
      assert.isUndefined(failed({ command, printed: 'private body' }), command)
    for (const command of ['bun test 2>&1 | tail -50', 'env CI=1 bun test', 'npm run lint | head', undefined])
      assert.strictEqual(failed({ command, printed: 'FAIL' })?.text, 'FAIL', command)
  })

  it('is read back as an item keeps it', () => {
    assert.deepStrictEqual(diagnosticIn({ text: 'FAIL', truncated: true }), { text: 'FAIL', truncated: true, redacted: false })
    for (const kept of [undefined, null, 'FAIL', { text: '' }, { text: 3 }, ['FAIL']]) assert.isNull(diagnosticIn(kept))
  })
})
