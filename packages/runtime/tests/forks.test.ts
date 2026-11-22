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
    assert.deepStrictEqual(toldOf(origin.url), { at: 1, parent: { path: ['meridian', 'web'] }, context: [], scm: false })
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
    assert.deepStrictEqual(toldOf('https://git.example.com/scm/dana/web.git')?.context, ['scm'])
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
      addressLike('https://git.example.com/scm/~dana/api.git', ['PRJ', 'api'], ['scm', '~dana', 'api'], ['scm']),
      'https://git.example.com/scm/PRJ/api.git',
    )
    assert.strictEqual(
      addressLike('https://example.com/gitlab/dana/api.git', ['meridian', 'api'], ['gitlab', 'dana', 'api'], ['gitlab']),
      'https://example.com/gitlab/meridian/api.git',
    )
    // However deep the parent's namespace, beside one as long as origin's path with the server's in front.
    assert.strictEqual(
      addressLike('https://example.com/gitlab/alice/api.git', ['group', 'subgroup', 'api'], ['gitlab', 'alice', 'api'], ['gitlab']),
      'https://example.com/gitlab/group/subgroup/api.git',
    )
  })

  it('on a self-hosted GitLab under a path of its own, keeps that path for its parent, however deep its namespace', () => {
    const mounted = { name: 'origin', url: 'https://example.com/gitlab/alice/api.git' }
    // As reading it from its host told: the host's path for origin is alice/api, so the server's own path is gitlab.
    assert.isTrue(tellOf(mounted.url, { path: ['alice', 'api'], parent: { path: ['group', 'subgroup', 'api'] } }, 1))
    const fork = forkOf([mounted])
    assert.deepStrictEqual(fork?.upstream, {
      url: 'https://example.com/gitlab/group/subgroup/api.git',
      path: ['group', 'subgroup', 'api'],
      remote: null,
    })
    // A remote at that address, by any name, is it.
    const parent = { name: 'base', url: 'https://example.com/gitlab/group/subgroup/api' }
    assert.strictEqual(forkOf([mounted, parent])?.upstream.remote, 'base')
  })

  it('is never a repository whose path only ends in its parent’s, however that remote is called', () => {
    const lab = { name: 'origin', url: 'git@gitlab.com:you/repo.git' }
    const archived = { name: 'upstream', url: 'git@gitlab.com:archive/group/repo.git' }
    const parent = { name: 'base', url: 'git@gitlab.com:group/repo.git' }
    // Beside the parent, the archived one called upstream isn't it.
    assert.strictEqual(forkOf([lab, archived, parent], { path: ['group', 'repo'] })?.upstream.remote, 'base')
    // On its own, under another name, the parent is among none of the remotes.
    assert.isNull(forkOf([lab, { ...archived, name: 'archive' }], { path: ['group', 'repo'] })?.upstream.remote)
    // Bitbucket Data Center's HTTPS address has scm/ in front of what its SSH one has, either one the parent.
    const center = { name: 'origin', url: 'ssh://git@host:7999/~dana/api.git' }
    const https = { name: 'base', url: 'https://host/scm/prj/api.git' }
    const dc = { context: [], scm: true }
    assert.strictEqual(forkOf([center, https], { path: ['PRJ', 'api'] }, dc)?.upstream.remote, 'base')
    const other = { name: 'old', url: 'https://host/scm/old/prj/api.git' }
    assert.isNull(forkOf([center, other], { path: ['PRJ', 'api'] }, dc)?.upstream.remote)
  })

  it('takes scm/ in front of its parent’s path only on Bitbucket Data Center, where its addresses have it', () => {
    // On GitLab, scm/group/repo is a project of its own, never group/repo, though called upstream.
    const lab = { name: 'origin', url: 'git@gitlab.com:alice/api.git' }
    const scm = { name: 'scm', url: 'git@gitlab.com:scm/group/repo.git' }
    assert.isTrue(tellOf(lab.url, { path: ['alice', 'api'], parent: { path: ['group', 'repo'] } }, 1, 'gitlab'))
    assert.isNull(forkOf([lab, scm])?.upstream.remote)
    // Asked of a Data Center over SSH, the same remote over HTTPS, with its scm/, is the parent.
    const center = { name: 'origin', url: 'ssh://git@host:7999/~dana/api.git' }
    const https = { name: 'base', url: 'https://host/scm/prj/api.git' }
    assert.isTrue(tellOf(center.url, { path: ['~dana', 'api'], parent: { path: ['PRJ', 'api'] } }, 1, 'bitbucket_dc'))
    assert.strictEqual(forkOf([center, https])?.upstream.remote, 'base')
  })

  it('as a fork of a fork, by the remote that has the root of its forks where none has its parent', () => {
    // GitHub says a fork of ninemate/web, itself forked from meridian/web, which the clone has as upstream.
    const said = { path: ['ninemate', 'web'], source: { path: ['meridian', 'web'] } }
    assert.deepStrictEqual(forkOf([origin, upstream], said), {
      fork: { url: origin.url, path: ['you', 'web'], remote: 'origin' },
      upstream: { url: upstream.url, path: ['meridian', 'web'], remote: 'upstream' },
      by: 'host',
    })
    // Under another name, the root is it too; a remote with the parent itself comes first.
    assert.strictEqual(forkOf([origin, { name: 'root', url: upstream.url }], said)?.upstream.remote, 'root')
    const middle = { name: 'nine', url: 'git@github.com:ninemate/web.git' }
    assert.deepStrictEqual(forkOf([origin, upstream, middle], said)?.upstream, {
      url: middle.url,
      path: ['ninemate', 'web'],
      remote: 'nine',
    })
  })

  it('by its `upstream` as before, where no remote has what its host said, as a fork of a fork whose root its host can’t say', () => {
    // GitLab says only the parent, dana/web, of a fork whose upstream is the root, meridian/web.
    const said = () => ({ path: ['dana', 'web'] })
    const fork = forkOf([origin, upstream], said())
    assert.deepStrictEqual(fork?.upstream, { url: upstream.url, path: ['meridian', 'web'], remote: 'upstream' })
    assert.strictEqual(fork?.by, 'names')
    // Where the host says the root of its forks, as GitHub does, an upstream that is neither isn't it.
    const rooted = forkOf([origin, { name: 'upstream', url: 'https://github.com/someone/web.git' }], {
      ...said(),
      source: { path: ['dana', 'web'] },
    })
    assert.deepStrictEqual([rooted?.upstream.remote, rooted?.by], [null, 'host'])
    // An upstream on another host is none the names make: the parent is then among none of the remotes.
    const elsewhere = forkOf([origin, { name: 'upstream', url: 'https://gitlab.com/meridian/web.git' }], { path: ['dana', 'web'] })
    assert.deepStrictEqual([elsewhere?.upstream.remote, elsewhere?.by], [null, 'host'])
  })

  it('finds its parent at an address its host gave for it, and offers to add it by the one written as origin’s is', () => {
    // A GitLab under a path of its own, origin over SSH: its parent over HTTPS has the server's path, as the host's address says.
    const ssh = { name: 'origin', url: 'git@git.example.com:alice/api.git' }
    const https = { name: 'base', url: 'https://git.example.com/gitlab/group/api' }
    const addresses = ['https://git.example.com/gitlab/group/api.git', 'git@git.example.com:group/api.git']
    assert.strictEqual(forkOf([ssh, https], { path: ['group', 'api'], addresses })?.upstream.remote, 'base')
    // Without the host's addresses, an HTTPS remote under a path Althar wasn't told of isn't taken for it.
    assert.isNull(forkOf([ssh, https], { path: ['group', 'api'] })?.upstream.remote)
    // Not a remote: the host's own address, written as origin's is.
    assert.strictEqual(forkOf([ssh], { path: ['group', 'api'], addresses })?.upstream.url, 'git@git.example.com:group/api.git')
    const mounted = { name: 'origin', url: 'https://git.example.com/gitlab/alice/api.git' }
    assert.strictEqual(
      forkOf([mounted], { path: ['group', 'api'], addresses }, { context: ['gitlab'], scm: false })?.upstream.url,
      addresses[0],
    )
  })

  it('takes an SSH remote at its parent’s path for it, where origin’s HTTPS address has the server’s own path in front', () => {
    const mounted = { name: 'origin', url: 'https://git.example.com/gitlab/alice/api.git' }
    assert.isTrue(tellOf(mounted.url, { path: ['alice', 'api'], parent: { path: ['group', 'api'] } }, 1, 'gitlab'))
    assert.strictEqual(forkOf([mounted, { name: 'base', url: 'git@git.example.com:group/api.git' }])?.upstream.remote, 'base')
    // Over HTTPS, the same path without the server's isn't it: another repository's address, or none.
    assert.isNull(forkOf([mounted, { name: 'base', url: 'https://git.example.com/group/api.git' }])?.upstream.remote)
    // On Data Center under a path of its own, its SSH address has neither that path nor scm/.
    const center = { name: 'origin', url: 'https://host/bitbucket/scm/~dana/api.git' }
    assert.isTrue(tellOf(center.url, { path: ['~dana', 'api'], parent: { path: ['PRJ', 'api'] } }, 1, 'bitbucket_dc'))
    assert.strictEqual(forkOf([center, { name: 'base', url: 'ssh://git@host:7999/prj/api.git' }])?.upstream.remote, 'base')
  })

  it('says a host’s answer changed where only the root of its forks did', () => {
    assert.isTrue(tellOf(origin.url, { path: ['you', 'web'], parent: { path: ['ninemate', 'web'] } }, 1))
    assert.isTrue(
      tellOf(origin.url, { path: ['you', 'web'], parent: { path: ['ninemate', 'web'], source: { path: ['meridian', 'web'] } } }, 2),
    )
    assert.isFalse(
      tellOf(origin.url, { path: ['you', 'web'], parent: { path: ['ninemate', 'web'], source: { path: ['meridian', 'web'] } } }, 3),
    )
  })
})
