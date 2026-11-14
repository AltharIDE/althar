import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'

import { chosenWorktrees, databaseIn, defaultProfile, defaultWorktrees, usableNow, worktreesFrom } from '../src/locations'

/** Windows, where what some tests stand on isn't (each says what). */
const windows = process.platform === 'win32'

/** A machine where only these paths are there. */
const only =
  (...paths: ReadonlyArray<string>) =>
  (path: string) =>
    paths.includes(path)

// Not on Windows: these are a Mac's and Linux's paths, and on Windows the desktop app names the profile and worktrees.
describe.skipIf(windows)('where Althar keeps things', () => {
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

describe('the folder chosen for task folders, which the app and the command line both read', () => {
  const kept = (text: string) => () => text

  it('is the app’s choice kept in the profile, and none where it isn’t a full path or can’t be read', () => {
    assert.strictEqual(chosenWorktrees('/p', kept('{"worktrees":"/Volumes/Ext/Althar","keepAwake":true}')), '/Volumes/Ext/Althar')
    assert.isNull(chosenWorktrees('/p', kept('{"worktrees":null}')))
    assert.isNull(chosenWorktrees('/p', kept('{"worktrees":"relative/Althar"}')))
    assert.isNull(chosenWorktrees('/p', kept('[]')))
    assert.isNull(chosenWorktrees('/p', kept('{not json')))
    assert.isNull(
      chosenWorktrees('/p', () => {
        throw new Error('ENOENT')
      }),
    )
  })

  it('reads desktop.json in the profile', () => {
    const profile = mkdtempSync(join(tmpdir(), 'althar-profile-'))
    writeFileSync(join(profile, 'desktop.json'), JSON.stringify({ worktrees: '/data/Althar' }))
    assert.strictEqual(chosenWorktrees(profile), '/data/Althar')
    rmSync(profile, { recursive: true, force: true })
  })

  it('comes after the environment and before the default', () => {
    assert.deepStrictEqual(worktreesFrom({}, null, '/d'), { folder: '/d', from: 'default' })
    assert.deepStrictEqual(worktreesFrom({}, '/c', '/d'), { folder: '/c', from: 'setting' })
    assert.deepStrictEqual(worktreesFrom({ ALTHAR_WORKTREES: '/e' }, '/c', '/d'), { folder: '/e', from: 'environment' })
    assert.deepStrictEqual(worktreesFrom({ ALTHAR_WORKTREES: '' }, '/c', '/d'), { folder: '/c', from: 'setting' })
  })

  it('is usable now only where it is a folder that is there', () => {
    const root = mkdtempSync(join(tmpdir(), 'althar-usable-'))
    mkdirSync(join(root, 'Althar'))
    writeFileSync(join(root, 'file'), '')
    assert.isTrue(usableNow(join(root, 'Althar')))
    assert.isFalse(usableNow(join(root, 'gone')))
    assert.isFalse(usableNow(join(root, 'file')))
    rmSync(root, { recursive: true, force: true })
  })
})
