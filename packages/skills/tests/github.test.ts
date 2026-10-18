import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { fetchSkill, findSkills, type GitHubAccess, parseGitHubSource, resolveRef } from '../src/github'
import { installLocalCatalog } from '../src/local'
import { approve, checkUpdates, diffLines, rollBack, setActive, stageFromGitHub, uninstall } from '../src/review'
import { readInstalls } from '../src/store'
import { skillMd, writeCatalog } from './support'

/** A GitHub API over in-memory commits: each ref names a commit, each commit a tree of paths to text, symlinks or submodules. */
const fakeGitHub = (
  repos: Record<string, { refs: Record<string, string>; commits: Record<string, Record<string, string | { mode: string; type: string }>> }>,
) => {
  const blobs = new Map<string, string>()
  const requests: string[] = []
  const access: GitHubAccess = {
    api: 'https://api.test',
    fetch: (async (input: string | URL) => {
      const url = new URL(input)
      requests.push(url.pathname)
      const [, , owner, name, ...rest] = url.pathname.split('/')
      const repo = repos[`${owner}/${name}`]
      const missing = new Response('{}', { status: 404 })
      if (repo === undefined) return missing
      if (rest[0] === 'commits') {
        const ref = decodeURIComponent(rest.slice(1).join('/'))
        const sha = repo.refs[ref] ?? (repo.commits[ref] === undefined ? undefined : ref)
        return sha === undefined ? missing : new Response(sha)
      }
      if (rest[0] === 'git' && rest[1] === 'trees') {
        const commit = repo.commits[rest[2] ?? '']
        if (commit === undefined) return missing
        const tree = Object.entries(commit).map(([path, content]) => {
          if (typeof content !== 'string') return { path, ...content, sha: '0'.repeat(40) }
          const sha = Buffer.from(path + content)
            .toString('hex')
            .slice(0, 40)
            .padEnd(40, '0')
          blobs.set(sha, content)
          return { path, mode: '100644', type: 'blob', sha, size: Buffer.byteLength(content) }
        })
        return Response.json({ tree, truncated: false })
      }
      if (rest[0] === 'git' && rest[1] === 'blobs') {
        const content = blobs.get(rest[2] ?? '')
        return content === undefined ? missing : Response.json({ content: Buffer.from(content).toString('base64'), encoding: 'base64' })
      }
      return missing
    }) as typeof fetch,
  }
  return { access, requests }
}

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const skill = (name: string, body = 'Do it.\n') => skillMd(`name: ${name}\ndescription: Use when testing ${name}.\nlicense: MIT`, body)

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'althar-skills-gh-'))
})

describe('reading a GitHub source', () => {
  it('takes a URL with a tree path, a plain owner/name, and nothing else', () => {
    expect(parseGitHubSource('https://github.com/obra/superpowers/tree/main/skills/brainstorming')).toEqual({
      repo: 'obra/superpowers',
      ref: 'main',
      subpath: 'skills/brainstorming',
    })
    expect(parseGitHubSource('github.com/obra/superpowers.git')).toEqual({ repo: 'obra/superpowers' })
    expect(parseGitHubSource('obra/superpowers')).toEqual({ repo: 'obra/superpowers' })
    expect(parseGitHubSource('https://gitlab.com/a/b')).toBeNull()
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
    await expect(resolveRef(access, 'o/r', 'main')).resolves.toBe(A)
    await expect(findSkills(access, 'o/r', A)).resolves.toEqual(['skills/alpha', 'skills/beta'])
    await expect(resolveRef(access, 'o/r', 'gone')).rejects.toThrow('not found')
  })

  it('fetches only the chosen directory, never the repository’s hooks or manifests', async () => {
    const { access, requests } = fakeGitHub({ 'o/r': repo })
    const files = await fetchSkill(access, 'o/r', A, 'skills/alpha')
    expect([...files.keys()].toSorted()).toEqual(['SKILL.md', 'references/more.md'])
    expect(requests.filter((path) => path.includes('/git/blobs/'))).toHaveLength(2)
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
    await expect(fetchSkill(access, 'o/r', A, 'link')).rejects.toThrow('symlink')
    await expect(fetchSkill(access, 'o/r', B, 'sub')).rejects.toThrow('submodule')
    await expect(fetchSkill(access, 'o/r', B, 'none')).rejects.toThrow('no SKILL.md')
    await expect(fetchSkill(access, 'o/r', B, '../etc')).rejects.toThrow('not a path')
    expect(requests.some((path) => path.includes('/git/blobs/'))).toBe(false)
  })

  it('refuses a tree over the limits before downloading it', async () => {
    const { access } = fakeGitHub({
      'o/r': { refs: {}, commits: { [A]: { 'big/SKILL.md': skill('big'), 'big/blob.md': 'x'.repeat(100) } } },
    })
    await expect(fetchSkill(access, 'o/r', A, 'big', { files: 10, bytes: 50, fileBytes: 1000 })).rejects.toThrow('bytes in all')
  })
})

describe('installing a skill from GitHub as a person reviews it', () => {
  const repoAt = (body: string) => ({ refs: { main: A }, commits: { [A]: { 'skills/alpha/SKILL.md': skill('alpha', body) } } })

  it('stages a version and shows its card; nothing is installed until it is approved', async () => {
    const { access } = fakeGitHub({ 'o/r': repoAt('Do it.\n') })
    const card = await stageFromGitHub(root, access, { repo: 'o/r', subpath: 'skills/alpha', ref: 'main' })
    expect(card).toMatchObject({
      id: 'alpha',
      source: { repo: 'o/r', sha: A, ref: 'main' },
      license: 'MIT',
      installable: true,
      installed: null,
    })
    expect(card.files.map((file) => file.path)).toEqual(['SKILL.md'])
    expect(card.changes).toMatchObject([{ path: 'SKILL.md', change: 'added' }])
    expect((await readInstalls(root)).ok && (await readInstalls(root))).toMatchObject({ value: { installs: [] } })
    const installed = await approve(root, { id: card.id, ...card.source, treeHash: card.treeHash })
    expect(installed).toMatchObject({ id: 'alpha', source: 'github', repo: 'o/r', sha: A, ref: 'main', review: 'reviewed', active: true })
  })

  it('shows a skill that tells the agent to push, but flags it; one with a refused field cannot be approved', async () => {
    const { access } = fakeGitHub({
      'o/r': {
        refs: { main: A },
        commits: {
          [A]: {
            'pushy/SKILL.md': skill('pushy', 'Then run git push.\n'),
            'grant/SKILL.md': skillMd('name: grant\ndescription: Use when testing.\nallowed-tools: Bash'),
          },
        },
      },
    })
    const pushy = await stageFromGitHub(root, access, { repo: 'o/r', subpath: 'pushy', ref: 'main' })
    expect(pushy.installable).toBe(true)
    expect(pushy.findings).toContainEqual(expect.objectContaining({ level: 'flag', code: 'pushes' }))
    const grant = await stageFromGitHub(root, access, { repo: 'o/r', subpath: 'grant', ref: 'main' })
    expect(grant.installable).toBe(false)
    await expect(approve(root, { id: 'grant', ...grant.source, treeHash: grant.treeHash })).rejects.toThrow('authorizing-field')
  })

  it('needs the person’s say-so to put a skill in place of a default of the same name, which the catalog then leaves alone', async () => {
    const catalog = await mkdtemp(join(tmpdir(), 'althar-skills-cat-'))
    await writeCatalog(catalog, { alpha: { 'SKILL.md': skill('alpha', 'Default.\n') } })
    await installLocalCatalog(root, catalog)
    const { access } = fakeGitHub({ 'o/r': repoAt('Mine.\n') })
    const card = await stageFromGitHub(root, access, { repo: 'o/r', subpath: 'skills/alpha', ref: 'main' })
    expect(card.installed).toMatchObject({ source: 'althar-default' })
    expect(card.changes[0]?.lines).toEqual(
      expect.arrayContaining([
        { kind: 'removed', text: 'Default.' },
        { kind: 'added', text: 'Mine.' },
      ]),
    )
    await expect(approve(root, { id: 'alpha', ...card.source, treeHash: card.treeHash })).rejects.toThrow('say-so')
    await approve(root, { id: 'alpha', ...card.source, treeHash: card.treeHash, replace: true })
    await installLocalCatalog(root, catalog)
    const read = await readInstalls(root)
    expect(read.ok && read.value.installs).toMatchObject([{ id: 'alpha', source: 'github', treeHash: card.treeHash }])
  })

  it('checks for updates only when asked, stages a newer commit for review, and rolls back to the version before', async () => {
    const repos = {
      'o/r': {
        refs: { main: A },
        commits: { [A]: { 'skills/alpha/SKILL.md': skill('alpha', 'One.\n') } } as Record<string, Record<string, string>>,
      },
    }
    const { access } = fakeGitHub(repos)
    const first = await stageFromGitHub(root, access, { repo: 'o/r', subpath: 'skills/alpha', ref: 'main' })
    await approve(root, { id: 'alpha', ...first.source, treeHash: first.treeHash })
    expect(await checkUpdates(root, access)).toEqual([{ id: 'alpha', state: 'current', sha: A }])

    repos['o/r'].commits[B] = { 'skills/alpha/SKILL.md': skill('alpha', 'Two.\n') }
    repos['o/r'].refs.main = B
    const [update] = await checkUpdates(root, access)
    expect(update?.state).toBe('available')
    if (update?.state !== 'available') return
    // Still the old version until the person approves the new one.
    const before = await readInstalls(root)
    expect(before.ok && before.value.installs[0]?.treeHash).toBe(first.treeHash)
    expect(update.card.changes[0]?.lines).toEqual(
      expect.arrayContaining([
        { kind: 'removed', text: 'One.' },
        { kind: 'added', text: 'Two.' },
      ]),
    )
    await approve(root, { id: 'alpha', ...update.card.source, treeHash: update.card.treeHash })
    const back = await rollBack(root, 'alpha')
    expect(back).toMatchObject({ treeHash: first.treeHash, sha: A })
    expect(back.history).toBeUndefined()
    await expect(rollBack(root, 'alpha')).rejects.toThrow('no earlier version')
    expect(JSON.parse(await readFile(join(root, 'installs.json'), 'utf8')).installs[0].ref).toBe('main')
  })

  it('reports a repository it cannot reach instead of failing the whole check', async () => {
    const { access } = fakeGitHub({ 'o/r': repoAt('Do it.\n') })
    const card = await stageFromGitHub(root, access, { repo: 'o/r', subpath: 'skills/alpha', ref: 'main' })
    await approve(root, { id: 'alpha', ...card.source, treeHash: card.treeHash })
    const { access: gone } = fakeGitHub({})
    expect(await checkUpdates(root, gone)).toMatchObject([{ id: 'alpha', state: 'failed' }])
  })

  it('turns an install off and on, removes a person’s own, and only turns a default off', async () => {
    const catalog = await mkdtemp(join(tmpdir(), 'althar-skills-cat-'))
    await writeCatalog(catalog, { beta: { 'SKILL.md': skill('beta') } })
    await installLocalCatalog(root, catalog)
    const { access } = fakeGitHub({ 'o/r': repoAt('Do it.\n') })
    const card = await stageFromGitHub(root, access, { repo: 'o/r', subpath: 'skills/alpha', ref: 'main' })
    await approve(root, { id: 'alpha', ...card.source, treeHash: card.treeHash })
    expect(await setActive(root, 'beta', false)).toMatchObject({ active: false })
    await expect(uninstall(root, 'beta')).rejects.toThrow('turn it off')
    await uninstall(root, 'alpha')
    const read = await readInstalls(root)
    expect(read.ok && read.value.installs.map(({ id, active }) => [id, active])).toEqual([['beta', false]])
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
