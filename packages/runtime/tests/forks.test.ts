import { assert, describe, it } from '@effect/vitest'
import { afterEach } from 'vitest'

import { addressLike, baseBranch, forgetTold, forkOf, fromParent, onRemote, tell, tellOf, toldOf } from '../src/forks'

/*
 * How Althar tells a fork, and the repository it was forked from (DEV-171):
 * as its host says, finding that one among the clone's remotes by address
 * whatever it is called; else by the remotes' names, `origin` and
 * `upstream`, as it always has.
 */

const origin = { name: 'origin', url: 'git@github.com:you/web.git' }
const upstream = { name: 'upstream', url: 'https://github.com/meridian/web.git' }

describe('telling a fork', () => {
  afterEach(() => forgetTold())

  it('by its remotes’ names alone, as before, with no host to say', () => {
    const fork = forkOf([origin, upstream])
    assert.deepStrictEqual(fork, {
      fork: { url: origin.url, path: ['you', 'web'], remote: 'origin' },
      upstream: { url: upstream.url, path: ['meridian', 'web'], remote: 'upstream' },
      by: 'names',
    })
    // Its parent under another name, without a host to say, isn't one Althar can tell.
    assert.isNull(forkOf([origin, { name: 'base', url: upstream.url }]))
  })

  it('as its host says, its parent found among the remotes by its address, whatever it is called', () => {
    const base = { name: 'Base', url: 'https://github.com/Meridian/Web' }
    const other = { name: 'dana', url: 'git@github.com:dana/web.git' }
    const fork = forkOf([origin, other, base], { path: ['meridian', 'web'] })
    assert.deepStrictEqual(fork, {
      fork: { url: origin.url, path: ['you', 'web'], remote: 'origin' },
      upstream: { url: base.url, path: ['meridian', 'web'], remote: 'Base' },
      by: 'host',
    })
    // Where several remotes have it, `upstream` is the one, as before.
    assert.strictEqual(forkOf([origin, base, upstream], { path: ['meridian', 'web'] })?.upstream.remote, 'upstream')
    // An `upstream` naming another repository than the host's parent isn't it.
    const elsewhere = forkOf([origin, { name: 'upstream', url: 'https://github.com/someone/web.git' }, base], { path: ['meridian', 'web'] })
    assert.strictEqual(elsewhere?.upstream.remote, 'Base')
  })

  it('as its host says, with the repository it was forked from not among its remotes, by the address to add it with', () => {
    const fork = forkOf([origin], { path: ['meridian', 'web'] })
    assert.deepStrictEqual(fork?.upstream, { url: 'git@github.com:meridian/web.git', path: ['meridian', 'web'], remote: null })
    assert.strictEqual(fork?.by, 'host')
    // Written as origin's address is: HTTPS stays HTTPS.
    const https = forkOf([{ name: 'origin', url: 'https://github.com/you/web' }], { path: ['meridian', 'web'] })
    assert.strictEqual(https?.upstream.url, 'https://github.com/meridian/web')
    // A remote of the same path on another host isn't it.
    const gitlab = forkOf([origin, { name: 'base', url: 'https://gitlab.com/meridian/web.git' }], { path: ['meridian', 'web'] })
    assert.isNull(gitlab?.upstream.remote)
  })

  it('isn’t one where its host says it isn’t and its remotes don’t, and stays one its remotes’ names make', () => {
    assert.isNull(forkOf([origin], null))
    assert.isNull(forkOf([origin, { name: 'base', url: upstream.url }], null))
    // A clone with an `upstream` is read as it always was, whatever its host says of its origin.
    assert.strictEqual(forkOf([origin, upstream], null)?.by, 'names')
    assert.isNull(forkOf([upstream], { path: ['meridian', 'web'] }))
  })

  it('by its remotes’ names where its host couldn’t be reached, and by what a host said before where one did', () => {
    // Nothing kept: no host said, so the names say, as before.
    assert.isUndefined(toldOf(origin.url))
    assert.isNull(forkOf([origin, { name: 'base', url: upstream.url }]))
    assert.strictEqual(forkOf([origin, upstream])?.by, 'names')
    // Once a host said, it is kept for the same repository however its address is written.
    tell('https://github.com/You/Web', { path: ['meridian', 'web'] }, 1)
    assert.deepStrictEqual(toldOf(origin.url), { at: 1, parent: { path: ['meridian', 'web'] } })
    assert.strictEqual(forkOf([origin, { name: 'base', url: upstream.url }])?.upstream.remote, 'base')
  })

  it('keeps a host’s answer only for the repository it was read for, and says when it changed', () => {
    // A read of another repository, the parent itself, says nothing of the clone's origin.
    assert.isFalse(tellOf(origin.url, { path: ['meridian', 'web'], parent: null }, 1))
    // A read that doesn't say whether it is a fork keeps nothing.
    assert.isFalse(tellOf(origin.url, { path: ['you', 'web'] }, 1))
    assert.isTrue(tellOf(origin.url, { path: ['you', 'web'], parent: { path: ['meridian', 'web'] } }, 1))
    assert.isFalse(tellOf(origin.url, { path: ['you', 'web'], parent: { path: ['meridian', 'web'] } }, 2))
    assert.strictEqual(toldOf(origin.url)?.at, 2)
    assert.isTrue(tellOf(origin.url, { path: ['you', 'web'], parent: null }, 3))
    // Bitbucket Data Center's remote has `scm/` in front of the path its host gives.
    assert.isTrue(tellOf('https://git.example.com/scm/dana/web.git', { path: ['dana', 'web'], parent: { path: ['PRJ', 'web'] } }, 1))
  })

  it('reads a task’s base on whichever remote its parent is', () => {
    const fork = forkOf([origin, { name: 'base', url: upstream.url }], { path: ['meridian', 'web'] })
    assert.isNotNull(fork)
    if (fork === null) return
    assert.strictEqual(fromParent('base/release/0.8', fork), 'release/0.8')
    // Started when the clone called it upstream: renamed since by hand, it is still the parent's.
    assert.strictEqual(fromParent('upstream/main', fork), 'main')
    assert.isNull(fromParent('origin/main', fork))
    assert.isNull(fromParent(null, fork))
    assert.strictEqual(baseBranch('base/main', false, ['base']), 'main')
    assert.strictEqual(baseBranch('upstream/main', false), 'main')
    assert.strictEqual(baseBranch('feature/x', false), 'feature/x')
    assert.strictEqual(baseBranch('origin/main', true), 'origin/main')
    assert.deepStrictEqual(onRemote('dana.v2/main', ['dana.v2']), { remote: 'dana.v2', branch: 'main' })
    assert.isNull(onRemote('danaXv2/main', ['dana.v2']))
  })

  it('writes the address to add a parent by as its origin’s is written', () => {
    assert.strictEqual(
      addressLike('git@gitlab.com:dana/group/api.git', ['meridian', 'group', 'api'], ['dana', 'group', 'api']),
      'git@gitlab.com:meridian/group/api.git',
    )
    assert.strictEqual(addressLike('ssh://git@host:7999/dana/api.git', ['PRJ', 'api'], ['dana', 'api']), 'ssh://git@host:7999/PRJ/api.git')
    // What the server puts in front of the repository stays.
    assert.strictEqual(
      addressLike('https://git.example.com/scm/~dana/api.git', ['PRJ', 'api'], ['scm', '~dana', 'api']),
      'https://git.example.com/scm/PRJ/api.git',
    )
    assert.strictEqual(
      addressLike('https://example.com/gitlab/dana/api.git', ['meridian', 'api'], ['gitlab', 'dana', 'api']),
      'https://example.com/gitlab/meridian/api.git',
    )
  })
})
