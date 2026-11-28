import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { afterEach } from 'vitest'

import { canonicalHost, reachedRemote, sshConfigSays, sshHostName } from '../src/sshHosts'

/*
 * A host's name as ssh's config gives it (sshHosts.ts): asked only of a name ssh couldn't read as an option, once, and
 * a remote with no user written keeps none.
 */

afterEach(() => sshConfigSays(undefined))

const knows = (host: string) => host === 'github.com'

describe('a host’s real name', () => {
  it.effect('is asked of ssh only where the name couldn’t be an option, and where ssh says nothing is the name', () =>
    Effect.gen(function* () {
      sshConfigSays({ 'work-box': 'github.com' })
      assert.strictEqual(yield* sshHostName('-oProxyCommand=boom'), '-oproxycommand=boom')
      assert.strictEqual(yield* sshHostName('Work-Box'), 'github.com')
      assert.strictEqual(yield* sshHostName('elsewhere'), 'elsewhere')
      assert.strictEqual(canonicalHost('SSH.GitHub.com'), 'github.com')
    }),
  )

  it.effect('keeps a remote without a user without one', () =>
    Effect.gen(function* () {
      sshConfigSays({})
      assert.strictEqual(yield* reachedRemote('ssh://ssh.github.com/meridian/api.git', knows), 'ssh://github.com/meridian/api.git')
      assert.strictEqual(yield* reachedRemote('ssh.github.com:meridian/api.git', knows), 'github.com:meridian/api.git')
      assert.strictEqual(yield* reachedRemote('git@ssh.github.com:', knows), 'git@github.com:')
    }),
  )
})
