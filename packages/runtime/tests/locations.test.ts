import { assert, describe, it } from '@effect/vitest'

import { databaseIn, defaultProfile, defaultWorktrees } from '../src/locations'

/** A machine where only these paths are there. */
const only =
  (...paths: ReadonlyArray<string>) =>
  (path: string) =>
    paths.includes(path)

describe('where Althar keeps things', () => {
  it('keeps the profile and worktrees in Althar’s folders, unless told otherwise', () => {
    const none = only()
    assert.strictEqual(defaultProfile({}, 'darwin', '/Users/ada', none), '/Users/ada/Library/Application Support/Althar')
    assert.strictEqual(defaultProfile({}, 'linux', '/home/ada', none), '/home/ada/.local/share/althar')
    assert.strictEqual(defaultProfile({ XDG_DATA_HOME: '/data' }, 'linux', '/home/ada', none), '/data/althar')
    assert.strictEqual(defaultProfile({ ALTHAR_PROFILE: '/p' }, 'darwin', '/Users/ada', none), '/p')
    assert.strictEqual(
      defaultProfile({ ALTHAR_PROFILE: '' }, 'darwin', '/Users/ada', none),
      '/Users/ada/Library/Application Support/Althar',
    )
    assert.strictEqual(defaultWorktrees({}, '/Users/ada', none), '/Users/ada/Althar')
    assert.strictEqual(defaultWorktrees({ ALTHAR_WORKTREES: '/w' }, '/Users/ada', none), '/w')
    assert.strictEqual(databaseIn('/p', none), '/p/althar.sqlite')
  })

  it('goes on using what Charrette left where Althar has nothing of its own yet', () => {
    const charrette = only(
      '/Users/ada/Library/Application Support/Charrette',
      '/home/ada/.local/share/charrette',
      '/Users/ada/Charrette',
      '/p/charrette.sqlite',
    )
    assert.strictEqual(defaultProfile({}, 'darwin', '/Users/ada', charrette), '/Users/ada/Library/Application Support/Charrette')
    assert.strictEqual(defaultProfile({}, 'linux', '/home/ada', charrette), '/home/ada/.local/share/charrette')
    assert.strictEqual(defaultWorktrees({}, '/Users/ada', charrette), '/Users/ada/Charrette')
    assert.strictEqual(databaseIn('/p', charrette), '/p/charrette.sqlite')
    // Once Althar has its own, Charrette's are left alone.
    const both = only(
      '/Users/ada/Library/Application Support/Althar',
      '/Users/ada/Library/Application Support/Charrette',
      '/p/althar.sqlite',
      '/p/charrette.sqlite',
    )
    assert.strictEqual(defaultProfile({}, 'darwin', '/Users/ada', both), '/Users/ada/Library/Application Support/Althar')
    assert.strictEqual(databaseIn('/p', both), '/p/althar.sqlite')
  })
})
