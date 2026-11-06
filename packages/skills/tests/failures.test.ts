import { chmod, mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { projectRun, releaseRun } from '../src/projection'
import { approve, checkUpdates, setActive, stageFromGitHub, uninstall } from '../src/review'
import { listInstalls, putObject, readObject, withInstall, writeInstalls, EMPTY_INSTALLS } from '../src/store'
import { clean, failure, fakeGitHub, good, run, skillMd, tree } from './support'

/*
 * What the person can put right is a `SkillRefused`; what Althar didn't expect of its own side is a `SkillStoreFailed`
 * (ADR-047). A broken install is kept to itself, copies are read-only to their folders, and a card names a licence.
 */

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const HASH = 'c'.repeat(64)

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'althar-skills-failures-'))
})
afterEach(async () => {
  await clean(root)
})

const unlicensed = (name: string) => skillMd(`name: ${name}\ndescription: Use when testing ${name}.`)

describe('read-only copies', () => {
  it('keeps a stored version’s folders read-only, so nothing can be added to it', async () => {
    const hash = await run(putObject(root, tree({ ...good(), 'references/a.md': 'more' })))
    for (const folder of ['', 'references']) expect((await stat(join(root, 'objects', hash, folder))).mode & 0o777).toBe(0o555)
    await expect(writeFile(join(root, 'objects', hash, 'extra.md'), 'x')).rejects.toThrow()
    await expect(mkdir(join(root, 'objects', hash, 'references', 'more'))).rejects.toThrow()
    expect([...(await run(readObject(root, hash))).keys()].toSorted()).toEqual(['SKILL.md', 'references/a.md'])
  })

  it('keeps a run’s copy read-only to its folders, and still replaces and removes it', async () => {
    const hash = await run(putObject(root, tree({ ...good('plain'), 'references/a.md': 'more' })))
    const input = { root, runId: 'run-1', agent: 'codex', capabilities: [], keepOutOf: [], selected: [{ id: 'plain', treeHash: hash }] }
    const first = await run(projectRun(input))
    expect((await stat(join(first.directory, 'plain', 'references'))).mode & 0o777).toBe(0o555)
    await expect(writeFile(join(first.directory, 'plain', 'new.md'), 'x')).rejects.toThrow()
    await expect(writeFile(join(first.directory, 'new.md'), 'x')).rejects.toThrow()
    const again = await run(projectRun({ ...input, layout: 'agents' }))
    expect(again.projected).toEqual(['plain'])
    await run(releaseRun(root, 'run-1'))
    await expect(stat(join(root, 'runs', 'run-1'))).rejects.toThrow()
  })
})

describe('what is refused, and what Althar did not expect', () => {
  it('refuses what the person can put right, and fails as Althar’s own for a damaged store', async () => {
    expect(await failure(setActive(root, 'nothing', true))).toMatchObject({ _tag: 'SkillRefused', message: 'nothing is not installed' })
    const missing = await failure(approve(root, { id: 'gone', repo: 'o/r', ref: 'main', sha: A, subpath: 'gone', treeHash: HASH }))
    expect(missing).toMatchObject({ _tag: 'SkillRefused' })
    expect(missing.message).toContain('review it again')
    const hash = await run(putObject(root, tree(good())))
    await chmod(join(root, 'objects', hash, 'SKILL.md'), 0o644)
    await writeFile(join(root, 'objects', hash, 'SKILL.md'), 'changed')
    expect(await failure(readObject(root, hash))).toMatchObject({ _tag: 'SkillStoreFailed' })
    await writeFile(join(root, 'installs.json'), '{nope')
    expect(await failure(setActive(root, 'x', true))).toMatchObject({ _tag: 'SkillStoreFailed', message: 'installs.json is not JSON' })
  })

  it('does not turn on an install that was never reviewed', async () => {
    await run(
      writeInstalls(
        root,
        withInstall(EMPTY_INSTALLS, { id: 'mine', source: 'local', treeHash: HASH, review: 'not-reviewed', active: false }),
      ),
    )
    expect(await failure(setActive(root, 'mine', true))).toMatchObject({ _tag: 'SkillRefused' })
    expect(await run(uninstall(root, 'mine'))).toMatchObject({ id: 'mine' })
    expect(await run(uninstall(root, 'mine'))).toBeUndefined()
  })

  it('says GitHub refused, by status, and a network that did not answer, as a refusal', async () => {
    const status = (code: number) => ({ fetch: async () => new Response('', { status: code }) })
    expect((await failure(stageFromGitHub(root, status(500), { repo: 'o/r', ref: 'main', subpath: 'x' }))).message).toContain('HTTP 500')
    expect((await failure(stageFromGitHub(root, status(429), { repo: 'o/r', ref: 'main', subpath: 'x' }))).message).toContain('slow down')
    const offline = {
      fetch: async () => {
        throw new Error('offline')
      },
    }
    expect(await failure(stageFromGitHub(root, offline, { repo: 'o/r', ref: 'main', subpath: 'x' }))).toMatchObject({
      _tag: 'SkillRefused',
    })
    const odd = { fetch: async (url: string) => (url.includes('/commits/') ? new Response(A) : Response.json({ tree: 'no' })) }
    expect((await failure(stageFromGitHub(root, odd, { repo: 'o/r', ref: 'main', subpath: 'x' }))).message).toContain("couldn't read")
  })

  it('keeps a check whose installed version is damaged to itself, with the failure whole to report', async () => {
    const repos = {
      'o/r': {
        refs: { main: A } as Record<string, string>,
        commits: { [A]: { 'x/SKILL.md': unlicensed('x') } } as Record<string, Record<string, string>>,
      },
    }
    const { access } = fakeGitHub(repos)
    const card = await run(stageFromGitHub(root, access, { repo: 'o/r', ref: 'main', subpath: 'x' }))
    await run(approve(root, { id: 'x', ...card.source, treeHash: card.treeHash }))
    await chmod(join(root, 'objects', card.treeHash, 'SKILL.md'), 0o644)
    await writeFile(join(root, 'objects', card.treeHash, 'SKILL.md'), 'changed')
    repos['o/r'].commits[B] = { 'x/SKILL.md': unlicensed('x').replace('Do the thing', 'Do more') }
    repos['o/r'].refs.main = B
    const [check] = await run(checkUpdates(root, access))
    expect(check).toMatchObject({ id: 'x', state: 'failed', error: "Althar couldn't check it. Its log has the details." })
    expect(check?.state === 'failed' && check.unexpected).toBeDefined()
  })
})

describe('a broken install', () => {
  it('is listed on its own, by its id where it has one, and the rest read as they are', async () => {
    const good = { id: 'fine', source: 'local', treeHash: HASH, review: 'reviewed', active: true }
    await writeFile(
      join(root, 'installs.json'),
      JSON.stringify({
        version: 1,
        installs: [good, { id: 'bad', source: 'nowhere' }, 7, { ...good, id: 'unreviewed', review: 'not-reviewed' }],
      }),
    )
    const listed = await run(listInstalls(root))
    expect(listed.map((one) => (one.ok ? one.install.id : `${one.id}!`))).toEqual(['fine', 'bad!', '#3!', 'unreviewed!'])
    expect(listed[3]?.ok === false && listed[3].problem).toContain('cannot be active')
    expect(await run(listInstalls(join(root, 'none')))).toEqual([])
    await writeFile(join(root, 'installs.json'), JSON.stringify({ version: 2, installs: [] }))
    expect(await failure(listInstalls(root))).toMatchObject({ _tag: 'SkillStoreFailed' })
  })
})

describe('the licence on a review card', () => {
  const repo = (license?: string) => ({
    'o/r': {
      refs: { main: A },
      commits: { [A]: { 'bare/SKILL.md': unlicensed('bare'), 'own/SKILL.md': skillMd('name: own\ndescription: Use it.\nlicense: MIT') } },
      ...(license === undefined ? {} : { license }),
    },
  })

  it('is the skill’s own, or else its repository’s by SPDX id, or none', async () => {
    const { access } = fakeGitHub(repo('Apache-2.0'))
    expect((await run(stageFromGitHub(root, access, { repo: 'o/r', ref: 'main', subpath: 'bare' }))).license).toBe('Apache-2.0')
    expect((await run(stageFromGitHub(root, access, { repo: 'o/r', ref: 'main', subpath: 'own' }))).license).toBe('MIT')
    const { access: other } = fakeGitHub(repo('NOASSERTION'))
    expect((await run(stageFromGitHub(root, other, { repo: 'o/r', ref: 'main', subpath: 'bare' }))).license).toBeNull()
    const { access: none } = fakeGitHub(repo())
    expect((await run(stageFromGitHub(root, none, { repo: 'o/r', ref: 'main', subpath: 'bare' }))).license).toBeNull()
  })

  it('is none where GitHub won’t describe the repository, and the card is still shown', async () => {
    const { access } = fakeGitHub(repo('MIT'))
    const fetch = access.fetch
    if (fetch === undefined) throw new Error('no fetch')
    const quiet = { ...access, fetch: async (url: string) => (url.endsWith('/repos/o/r') ? new Response('', { status: 500 }) : fetch(url)) }
    expect((await run(stageFromGitHub(root, quiet, { repo: 'o/r', ref: 'main', subpath: 'bare' }))).license).toBeNull()
  })
})
