import { assert, describe, it } from '@effect/vitest'
import { join, resolve } from 'node:path'

import { parseOptions } from '../src/options'

const home = resolve('/home/host-owner')
const parse = (args: string[], env: NodeJS.ProcessEnv = {}) => parseOptions(args, env, home)

describe('host command configuration', () => {
  it('keeps worker listener, certificate and attempt options scoped to their commands', () => {
    const tls = ['--worker-ca', '/trusted/ca', '--tls-certificate', '/trusted/home', '--tls-key', '/private/key']
    const id = `wrk_${'a'.repeat(32)}`
    const attempt = `watt_${'b'.repeat(32)}`
    assert.equal(parse(['configure-workers', ...tls]).workerConfiguration?.port, 6770)
    assert.equal(
      parse(['configure-workers', ...tls, '--worker-relay', '/private/link.json']).workerConfiguration?.relay,
      '/private/link.json',
    )
    assert.equal(parse(['worker-run', '--worker-id', id]).workerId, id)
    assert.equal(parse(['worker-result', '--attempt-id', attempt]).workerAttemptId, attempt)
    assert.equal(parse(['worker-log', '--attempt-id', attempt]).workerAttemptId, attempt)
    assert.equal(parse(['worker-log', '--attempt-id', attempt, '--offset', '3']).workerLogOffset, 3)
    const project = `proj_${'2'.repeat(32)}`
    const projectAttempt = `wpr_${'3'.repeat(32)}`
    assert.deepEqual(
      parse(['worker-project-run', '--worker-id', id, '--project-id', project, '--command-name', 'git-check']).workerProject,
      { projectId: project, commandName: 'git-check' },
    )
    assert.equal(parse(['worker-cancel', '--attempt-id', projectAttempt]).workerAttemptId, projectAttempt)
    for (const args of [
      ['configure-workers', '--worker-ca', '/trusted/ca'],
      ['configure-workers', ...tls, '--listen-port', '99999'],
      ['serve', '--listen-port', '6770'],
      ['configure-workers', ...tls, '--origin', 'https://localhost:6770'],
      ['serve', '--worker-ca', '/trusted/ca'],
      ['serve', '--worker-relay', '/private/link.json'],
      ['enroll-worker'],
      ['serve', '--worker-certificate', '/trusted/worker'],
      ['worker-run', '--worker-id', 'not-a-worker'],
      ['worker-run', '--worker-id', id, '--project-id', project],
      ['worker-project-run', '--worker-id', id, '--project-id', project, '--command-name', 'a command'],
      ['worker-cancel', '--attempt-id', attempt],
      ['serve', '--worker-id', id],
      ['worker-result', '--attempt-id', 'not-an-attempt'],
      ['worker-log'],
      ['worker-log', '--attempt-id', attempt, '--offset', '-1'],
      ['worker-log', '--attempt-id', attempt, '--offset', '1.5'],
      ['worker-log', '--attempt-id', attempt, '--offset', '9007199254740992'],
      ['worker-result', '--attempt-id', attempt, '--offset', '0'],
      ['serve', '--attempt-id', attempt],
    ])
      assert.throws(() => parse(args))
  })

  it('defaults to explicit apply and validates update-only controls', () => {
    const options = parse(['configure-updates', '--release-key', '/trusted/one', '--release-key', '/trusted/two', '--automatic-updates'])
    assert.isTrue(options.automaticUpdates)
    assert.deepStrictEqual(options.releaseKeys, ['/trusted/one', '/trusted/two'])
    assert.isUndefined(parse(['configure-updates']).automaticUpdates)
    assert.isFalse(parse(['configure-updates', '--manual-updates']).automaticUpdates)
    assert.isTrue(parse(['update', '--apply', '--allow-incompatible', '--wait']).allowIncompatible)
    for (const args of [
      ['serve', '--release-key', '/key'],
      ['configure-updates', '--automatic-updates', '--manual-updates'],
      ['update', '--allow-incompatible'],
      ['serve', '--apply'],
      ['package-release', '--release-sequence', '0'],
      ['recover-update', '--controller-pid', '-1'],
      ['serve', '--release-sequence', '2'],
    ])
      assert.throws(() => parse(args))
  })
  it('uses a profile distinct from the desktop and keeps keys outside it', () => {
    const config = parse(['serve'])
    assert.strictEqual(config.command, 'serve')
    assert.strictEqual(config.profile, join(home, '.local/share/althar-host'))
    assert.strictEqual(config.worktrees, join(config.profile, 'worktrees'))
    assert.strictEqual(config.keyFile, join(home, '.config/althar-host/master-key'))
    assert.strictEqual(parse([]).command, 'help')
    assert.strictEqual(parse(['--help']).command, 'help')
    assert.strictEqual(parse(['--version']).command, 'version')
  })

  it('accepts explicit provisioning paths and XDG settings without losing spaces', () => {
    const config = parse(
      [
        'init',
        '--profile',
        './my profile',
        '--key-file',
        './key dir/master',
        '--project',
        './source one',
        '--project',
        './source two',
        '--json',
      ],
      { XDG_CONFIG_HOME: resolve('/config') },
    )
    assert.strictEqual(config.profile, resolve('my profile'))
    assert.strictEqual(config.keyFile, resolve('key dir/master'))
    assert.deepStrictEqual(config.projects, [resolve('source one'), resolve('source two')])
    assert.isTrue(config.json)
    assert.strictEqual(config.unitDirectory, resolve('/config/systemd/user'))
  })

  it('uses a delivered service credential only for serve and rejects conflicting or malformed arguments', () => {
    const env = { CREDENTIALS_DIRECTORY: resolve('/run/credentials/host'), ALTHAR_HOST_PROFILE: resolve('/host-data') }
    assert.strictEqual(parse(['serve'], env).keyFile, resolve('/run/credentials/host/master-key'))
    assert.strictEqual(parse(['init'], env).keyFile, join(home, '.config/althar-host/master-key'))
    for (const args of [
      ['serve', '--profile'],
      ['serve', '--bogus'],
      ['serve', '--project', '/repo'],
      ['status', '--start'],
      ['init', '--wait'],
      ['serve', 'status'],
      ['serve', '--profile', 'x\ny'],
      ['serve', '--profile', 'a', '--profile', 'b'],
    ])
      assert.throws(() => parse(args))
    assert.throws(() => parse(['serve'], { XDG_CONFIG_HOME: 'relative' }))
  })

  it('limits service names and applies credential choices only to service installation', () => {
    const config = parse(['install-service', '--service-name', 'personal-home', '--encrypted-credential', '/private/host.cred', '--start'])
    assert.strictEqual(config.serviceName, 'personal-home')
    assert.strictEqual(config.encryptedCredential, resolve('/private/host.cred'))
    assert.isTrue(config.start)
    assert.throws(() => parse(['install-service', '--service-name', '../escape']))
    assert.throws(() => parse(['serve', '--encrypted-credential', '/private/host.cred']))
  })
})
