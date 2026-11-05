import { existsSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { fetchSkill, findSkills, parseGitHubSource, resolveRef, resolveTree } from '../src/github'
import { installLocalCatalog } from '../src/local'
import { approve, checkUpdates, diffLines, rollBack, setActive, stageFromGitHub, uninstall } from '../src/review'
import { readInstalls } from '../src/store'
import { failure, fakeGitHub, skillMd, writeCatalog, run } from './support'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)
const skill = (name: string, body = 'Do it.\n') => skillMd(`name: ${name}\ndescription: Use when testing ${name}.\nlicense: MIT`, body)

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'althar-skills-gh-'))
})

describe('reading a GitHub source', () => {
  it('takes a URL with a tree path, a plain owner/name, and nothing else', () => {
    expect(parseGitHubSource('https://github.com/obra/superpowers/tree/main/skills/brainstorming')).toEqual({
      repo: 'obra/superpowers',
      tree: 'main/skills/brainstorming',
    })
    expect(parseGitHubSource('github.com/obra/superpowers.git')).toEqual({ repo: 'obra/superpowers' })
    expect(parseGitHubSource('obra/superpowers')).toEqual({ repo: 'obra/superpowers' })
    expect(parseGitHubSource('https://gitlab.com/a/b')).toBeNull()
  })

  it('splits a /tree/ path into the ref GitHub has and the path in it, a branch with a slash too', async () => {
    const { access } = fakeGitHub({ 'o/r': { refs: { main: A, 'feature/new': B }, commits: { [A]: {}, [B]: {} } } })
    expect(await run(resolveTree(access, 'o/r', 'feature/new/skills/foo'))).toEqual({ ref: 'feature/new', sha: B, subpath: 'skills/foo' })
    expect(await run(resolveTree(access, 'o/r', 'main/skills/foo'))).toEqual({ ref: 'main', sha: A, subpath: 'skills/foo' })
    expect(await run(resolveTree(access, 'o/r', 'feature/new'))).toEqual({ ref: 'feature/new', sha: B })
    await expect(run(resolveTree(access, 'o/r', 'gone/skills'))).rejects.toThrow('no branch, tag or commit starts gone/skills')
  })
})

describe('fetching a skill from GitHub', () => {
  const repo = {
    refs: { main: A },
    commits: {
      [A]: {
        'skills/alpha/SKILL.md': skill('alpha'),
        'skills/alpha/references/more.md': 'More.\n',
        'skills/beta/SKILL.md': skill('beta'),
        'hooks/session-start.sh': 'echo hi\n',
        'package.json': '{}',
      },
    },
  }

  it('resolves a branch once to its commit, and lists the skills in the repository', async () => {
    const { access } = fakeGitHub({ 'o/r': repo })
    await expect(run(resolveRef(access, 'o/r', 'main'))).resolves.toBe(A)
    await expect(run(findSkills(access, 'o/r', A))).resolves.toEqual(['skills/alpha', 'skills/beta'])
    await expect(run(resolveRef(access, 'o/r', 'gone'))).rejects.toThrow('not found')
  })

  it('fetches only the chosen directory, never the repository’s hooks or manifests, from the raw host', async () => {
    const { access, requests } = fakeGitHub({ 'o/r': repo })
    const files = await run(fetchSkill(access, 'o/r', A, 'skills/alpha'))
    expect([...files.keys()].toSorted()).toEqual(['SKILL.md', 'references/more.md'])
    expect(requests.filter((path) => path.startsWith('raw.test/'))).toEqual([
      `raw.test/o/r/${A}/skills/alpha/SKILL.md`,
      `raw.test/o/r/${A}/skills/alpha/references/more.md`,
    ])
    expect(requests.some((path) => path.includes('hooks') || path.includes('package.json'))).toBe(false)
  })

  it('takes files through the API with a token, and refuses a file that is not what the commit’s tree names', async () => {
    const { access, requests } = fakeGitHub({ 'o/r': repo })
    await run(fetchSkill({ ...access, token: 't' }, 'o/r', A, 'skills/alpha'))
    expect(requests.filter((path) => path.includes('/git/blobs/'))).toHaveLength(2)
    const { access: lying } = fakeGitHub({ 'o/r': repo }, { 'skills/alpha/SKILL.md': 'Something else.\n' })
    await expect(run(fetchSkill(lying, 'o/r', A, 'skills/alpha'))).rejects.toThrow("did not match the commit's tree")
  })

  it('refuses a symlink or a submodule in the skill, and a directory with no SKILL.md, before reading a file', async () => {
    const { access, requests } = fakeGitHub({
      'o/r': {
        refs: {},
        commits: {
          [A]: { 'link/SKILL.md': skill('link'), 'link/escape': { mode: '120000', type: 'blob' } },
          [B]: { 'sub/SKILL.md': skill('sub'), 'sub/vendor': { mode: '160000', type: 'commit' }, 'none/README.md': 'x' },
        },
      },
    })
    await expect(run(fetchSkill(access, 'o/r', A, 'link'))).rejects.toThrow('symlink')
    await expect(run(fetchSkill(access, 'o/r', B, 'sub'))).rejects.toThrow('submodule')
    await expect(run(fetchSkill(access, 'o/r', B, 'none'))).rejects.toThrow('no SKILL.md')
    await expect(run(fetchSkill(access, 'o/r', B, '../etc'))).rejects.toThrow('not a path')
    expect(requests.some((path) => path.startsWith('raw.test/'))).toBe(false)
  })

  it('refuses a tree over the limits before downloading it', async () => {
    const { access } = fakeGitHub({
      'o/r': { refs: {}, commits: { [A]: { 'big/SKILL.md': skill('big'), 'big/blob.md': 'x'.repeat(100) } } },
    })
    await expect(run(fetchSkill(access, 'o/r', A, 'big', { files: 10, bytes: 50, fileBytes: 1000 }))).rejects.toThrow('bytes in all')
  })
})

describe('installing a skill from GitHub as a person reviews it', () => {
  const repoAt = (body: string) => ({ refs: { main: A }, commits: { [A]: { 'skills/alpha/SKILL.md': skill('alpha', body) } } })

  it('stages a version and shows its card; nothing is installed until it is approved', async () => {
    const { access } = fakeGitHub({ 'o/r': repoAt('Do it.\n') })
    const card = await run(stageFromGitHub(root, access, { repo: 'o/r', subpath: 'skills/alpha', ref: 'main' }))
    expect(card).toMatchObject({
      id: 'alpha',
      source: { repo: 'o/r', sha: A, ref: 'main' },
      license: 'MIT',
      installable: true,
      installed: null,
    })
    expect(card.files.map((file) => file.path)).toEqual(['SKILL.md'])
    expect(card.changes).toMatchObject([{ path: 'SKILL.md', change: 'added' }])
    expect(await run(readInstalls(root))).toMatchObject({ installs: [] })
    const installed = await run(approve(root, { id: card.id, ...card.source, treeHash: card.treeHash }))
    expect(installed).toMatchObject({ id: 'alpha', source: 'github', repo: 'o/r', sha: A, ref: 'main', review: 'reviewed', active: true })
  })

  it('shows a skill that tells the agent to push, but flags it; one with allowed-tools or hooks cannot be approved', async () => {
    const { access } = fakeGitHub({
      'o/r': {
        refs: { main: A },
        commits: {
          [A]: {
            'pushy/SKILL.md': skill('pushy', 'Then run git push.\n'),
            'grant/SKILL.md': skillMd('name: grant\ndescription: Use when testing.\nallowed-tools: Bash'),
            'hooky/SKILL.md': skillMd('name: hooky\ndescription: Use when testing.\nhooks:\n  Stop: echo done'),
          },
        },
      },
    })
    const pushy = await run(stageFromGitHub(root, access, { repo: 'o/r', subpath: 'pushy', ref: 'main' }))
    expect(pushy.installable).toBe(true)
    expect(pushy.findings).toContainEqual(expect.objectContaining({ level: 'flag', code: 'pushes' }))
    const grant = await run(stageFromGitHub(root, access, { repo: 'o/r', subpath: 'grant', ref: 'main' }))
    expect(grant.installable).toBe(false)
    await expect(run(approve(root, { id: 'grant', ...grant.source, treeHash: grant.treeHash }))).rejects.toThrow('authorizing-field')
    const hooky = await run(stageFromGitHub(root, access, { repo: 'o/r', subpath: 'hooky', ref: 'main' }))
    expect(hooky.installable).toBe(false)
    await expect(run(approve(root, { id: 'hooky', ...hooky.source, treeHash: hooky.treeHash }))).rejects.toThrow('authorizing-field')
    expect(await run(readInstalls(root))).toMatchObject({ installs: [] })
  })

  it('needs the person’s say-so to put a skill in place of a default of the same name, which the catalog then leaves alone', async () => {
    const catalog = await mkdtemp(join(tmpdir(), 'althar-skills-cat-'))
    await writeCatalog(catalog, { alpha: { 'SKILL.md': skill('alpha', 'Default.\n') } })
    await run(installLocalCatalog(root, catalog))
    const { access } = fakeGitHub({ 'o/r': repoAt('Mine.\n') })
    const card = await run(stageFromGitHub(root, access, { repo: 'o/r', subpath: 'skills/alpha', ref: 'main' }))
    expect(card.installed).toMatchObject({ source: 'althar-default' })
    expect(card.changes[0]?.lines).toEqual(
      expect.arrayContaining([
        { kind: 'removed', text: 'Default.' },
        { kind: 'added', text: 'Mine.' },
      ]),
    )
    await expect(run(approve(root, { id: 'alpha', ...card.source, treeHash: card.treeHash }))).rejects.toThrow('say-so')
    await run(approve(root, { id: 'alpha', ...card.source, treeHash: card.treeHash, replace: true }))
    await run(installLocalCatalog(root, catalog))
    const read = await run(readInstalls(root))
    expect(read.installs).toMatchObject([{ id: 'alpha', source: 'github', treeHash: card.treeHash }])
    // Rolled back, it is the default again, not the default's files under the GitHub source.
    const back = await run(rollBack(root, 'alpha'))
    expect(back).toMatchObject({ source: 'althar-default', review: 'default' })
    expect([back.repo, back.subpath, back.ref, back.sha, back.history]).toEqual([undefined, undefined, undefined, undefined, undefined])
  })

  it('rolls a skill put in place of one from another repository back to that repository', async () => {
    const { access } = fakeGitHub({
      'o/r': repoAt('Theirs.\n'),
      'me/mine': { refs: { dev: B }, commits: { [B]: { 'alpha/SKILL.md': skill('alpha', 'Mine.\n') } } },
    })
    const theirs = await run(stageFromGitHub(root, access, { repo: 'o/r', subpath: 'skills/alpha', ref: 'main' }))
    await run(approve(root, { id: 'alpha', ...theirs.source, treeHash: theirs.treeHash }))
    const mine = await run(stageFromGitHub(root, access, { repo: 'me/mine', subpath: 'alpha', ref: 'dev' }))
    await run(approve(root, { id: 'alpha', ...mine.source, treeHash: mine.treeHash, replace: true }))
    const back = await run(rollBack(root, 'alpha'))
    expect(back).toMatchObject({ source: 'github', repo: 'o/r', subpath: 'skills/alpha', ref: 'main', sha: A, treeHash: theirs.treeHash })
    // Its update check asks the repository it is from again.
    expect(await run(checkUpdates(root, access))).toMatchObject([{ id: 'alpha', state: 'current', sha: A }])
  })

  it('checks for updates only when asked, stages a newer commit for review, and rolls back to the version before', async () => {
    const repos = {
      'o/r': {
        refs: { main: A },
        commits: { [A]: { 'skills/alpha/SKILL.md': skill('alpha', 'One.\n') } } as Record<string, Record<string, string>>,
      },
    }
    const { access } = fakeGitHub(repos)
    const first = await run(stageFromGitHub(root, access, { repo: 'o/r', subpath: 'skills/alpha', ref: 'main' }))
    await run(approve(root, { id: 'alpha', ...first.source, treeHash: first.treeHash }))
    expect(await run(checkUpdates(root, access))).toEqual([{ id: 'alpha', state: 'current', sha: A }])

    // A newer commit that changed something else in the repository is no update to review.
    repos['o/r'].commits[C] = { 'skills/alpha/SKILL.md': skill('alpha', 'One.\n'), 'README.md': 'Elsewhere.\n' }
    repos['o/r'].refs.main = C
    expect(await run(checkUpdates(root, access))).toEqual([{ id: 'alpha', state: 'current', sha: C }])

    repos['o/r'].commits[B] = { 'skills/alpha/SKILL.md': skill('alpha', 'Two.\n') }
    repos['o/r'].refs.main = B
    const [update] = await run(checkUpdates(root, access))
    expect(update?.state).toBe('available')
    if (update?.state !== 'available') return
    // Still the old version until the person approves the new one.
    const before = await run(readInstalls(root))
    expect(before.installs[0]?.treeHash).toBe(first.treeHash)
    expect(update.card.changes[0]?.lines).toEqual(
      expect.arrayContaining([
        { kind: 'removed', text: 'One.' },
        { kind: 'added', text: 'Two.' },
      ]),
    )
    // Turned off, it stays off once its update is approved.
    await run(setActive(root, 'alpha', false))
    expect(await run(approve(root, { id: 'alpha', ...update.card.source, treeHash: update.card.treeHash }))).toMatchObject({
      active: false,
      treeHash: update.card.treeHash,
    })
    // The version it replaced is kept, to go back to.
    expect((await run(readInstalls(root))).installs[0]?.history).toMatchObject([{ treeHash: first.treeHash, sha: A }])
    const back = await run(rollBack(root, 'alpha'))
    expect(back).toMatchObject({ treeHash: first.treeHash, sha: A, active: false })
    expect(back.history).toBeUndefined()
    // Both versions' files stay stored: the one rolled back to, and the newer one it left.
    for (const hash of [first.treeHash, update.card.treeHash]) expect(existsSync(join(root, 'objects', hash, 'SKILL.md'))).toBe(true)
    await expect(run(rollBack(root, 'alpha'))).rejects.toThrow('no earlier version')
    expect(JSON.parse(await readFile(join(root, 'installs.json'), 'utf8')).installs[0].ref).toBe('main')
  })

  it('reports a repository it cannot reach instead of failing the whole check', async () => {
    const { access } = fakeGitHub({ 'o/r': repoAt('Do it.\n') })
    const card = await run(stageFromGitHub(root, access, { repo: 'o/r', subpath: 'skills/alpha', ref: 'main' }))
    await run(approve(root, { id: 'alpha', ...card.source, treeHash: card.treeHash }))
    const { access: gone } = fakeGitHub({})
    expect(await run(checkUpdates(root, gone))).toMatchObject([{ id: 'alpha', state: 'failed' }])
  })

  it('turns an install off and on, removes a person’s own, and only turns a default off', async () => {
    const catalog = await mkdtemp(join(tmpdir(), 'althar-skills-cat-'))
    await writeCatalog(catalog, { beta: { 'SKILL.md': skill('beta') } })
    await run(installLocalCatalog(root, catalog))
    const { access } = fakeGitHub({ 'o/r': repoAt('Do it.\n') })
    const card = await run(stageFromGitHub(root, access, { repo: 'o/r', subpath: 'skills/alpha', ref: 'main' }))
    await run(approve(root, { id: 'alpha', ...card.source, treeHash: card.treeHash }))
    expect(await run(setActive(root, 'beta', false))).toMatchObject({ active: false })
    await expect(run(uninstall(root, 'beta'))).rejects.toThrow('turn it off')
    await run(uninstall(root, 'alpha'))
    const read = await run(readInstalls(root))
    expect(read.installs.map(({ id, active }) => [id, active])).toEqual([['beta', false]])
  })
})

describe('the line diff on a card', () => {
  it('keeps a few lines around each change and drops the rest', () => {
    const before = Array.from({ length: 20 }, (_, at) => `line ${at}`).join('\n')
    const after = before.replace('line 10', 'line ten')
    expect(diffLines(before, after)).toEqual([
      ...[7, 8, 9].map((at) => ({ kind: 'same', text: `line ${at}` })),
      { kind: 'removed', text: 'line 10' },
      { kind: 'added', text: 'line ten' },
      ...[11, 12, 13].map((at) => ({ kind: 'same', text: `line ${at}` })),
    ])
  })
})

describe('what GitHub is asked, and what it answers', () => {
  const at = (path: string) => (input: string) => input.includes(path)

  it('refuses a name that is no repository or ref, before asking', async () => {
    const { access, requests } = fakeGitHub({})
    expect((await failure(resolveRef(access, 'not a repo', 'main'))).message).toContain('not a GitHub repository')
    expect((await failure(resolveRef(access, 'o/r', ''))).message).toContain('not a ref')
    expect((await failure(resolveRef(access, 'o/r', 'a..b'))).message).toContain('not a ref')
    expect((await failure(fetchSkill(access, 'o/r', 'main', 'x'))).message).toContain('full commit SHA')
    expect(requests).toEqual([])
  })

  it('refuses an answer that names no commit, a tree too large to list, and a blob not in base64', async () => {
    const answers = (pick: (input: string) => Response) => ({ api: 'https://api.test', fetch: async (input: string) => pick(input) })
    expect(
      (
        await failure(
          resolveRef(
            answers(() => new Response('main')),
            'o/r',
            'main',
          ),
        )
      ).message,
    ).toContain('named no commit')
    expect(
      (
        await failure(
          findSkills(
            answers(() => Response.json({ tree: [], truncated: true })),
            'o/r',
            A,
          ),
        )
      ).message,
    ).toContain('too large')
    const tree = { tree: [{ path: 'SKILL.md', mode: '100644', type: 'blob', sha: B, size: 1 }], truncated: false }
    const latin = answers((input) => (at('/git/trees/')(input) ? Response.json(tree) : Response.json({ content: 'x', encoding: 'latin1' })))
    expect((await failure(fetchSkill({ ...latin, token: 't' }, 'o/r', A, ''))).message).toContain('not base64')
    expect(
      (
        await failure(
          resolveRef(
            answers(() => new Response('', { status: 422 })),
            'o/r',
            'main',
          ),
        )
      ).message,
    ).toContain('not found')
  })

  it('takes a skill at the repository’s root, and refuses one over the file count, one too large, and an unsafe path', async () => {
    const root = { 'SKILL.md': skill('r'), 'a.md': 'a', 'sub/b.md': 'b' }
    const { access } = fakeGitHub({ 'o/r': { refs: {}, commits: { [A]: root } } })
    expect([...(await run(fetchSkill(access, 'o/r', A, '/'))).keys()].toSorted()).toEqual(['SKILL.md', 'a.md', 'sub/b.md'])
    expect(await run(findSkills(access, 'o/r', A))).toEqual([''])
    expect((await failure(fetchSkill(access, 'o/r', A, '', { files: 2, bytes: 1e6, fileBytes: 1e6 }))).message).toContain('at most 2')
    expect((await failure(fetchSkill(access, 'o/r', A, '', { files: 9, bytes: 1e6, fileBytes: 10 }))).message).toContain('larger than')
    expect((await failure(fetchSkill(access, 'o/r', A, 'none'))).message).toContain('no SKILL.md at none')
    const unsafe = { tree: [{ path: 'x/a\\b', mode: '100644', type: 'blob', sha: B }], truncated: false }
    const answer = { api: 'https://api.test', fetch: async () => Response.json(unsafe) }
    expect((await failure(fetchSkill(answer, 'o/r', A, 'x'))).message).toContain('unsafe path')
    const nameless = { tree: [{ path: 'SKILL.md', mode: '100644', type: 'blob', sha: B }], truncated: false }
    const noSize = { api: 'https://api.test', fetch: async () => Response.json(nameless) }
    expect((await failure(fetchSkill(noSize, 'o/r', A, ''))).message).toContain('did not match')
  })

  it('says a failure that is not an Error in its own words', async () => {
    const thrower = {
      fetch: async (): Promise<Response> => {
        throw 'refused by a proxy'
      },
    }
    expect((await failure(resolveRef(thrower, 'o/r', 'main'))).message).toContain('refused by a proxy')
  })
})
