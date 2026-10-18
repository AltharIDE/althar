import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type GitHubAccess, gitBlobSha } from '../src/github'
import { type Files, treeHash } from '../src/hash'

const encoder = new TextEncoder()

/** A skill tree from text, as a fetch would hand it over. */
export const tree = (files: Record<string, string>): Files =>
  new Map(Object.entries(files).map(([path, text]) => [path, encoder.encode(text)]))

export const skillMd = (front: string, body = 'Do the thing.\n'): string => `---\n${front}\n---\n${body}`

export const good = (name = 'my-skill'): Record<string, string> => ({
  'SKILL.md': skillMd(`name: ${name}\ndescription: Use when testing.\nlicense: MIT\nmetadata:\n  author: someone`),
})

/** Writes a local catalog of the given skills (id -> files) with correct pins, and returns its directory entries' tree hashes. */
export const writeCatalog = async (
  directory: string,
  skills: Record<string, Record<string, string>>,
  needs: Record<string, string[]> = {},
) => {
  const entries = []
  for (const [id, files] of Object.entries(skills)) {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(directory, 'skills', id, path)), { recursive: true })
      await writeFile(join(directory, 'skills', id, path), text)
    }
    entries.push({ id, source: { kind: 'althar' }, treeHash: treeHash(tree(files)), license: 'Apache-2.0', needs: needs[id] ?? [] })
  }
  await writeFile(join(directory, 'catalog.json'), JSON.stringify({ version: 1, revision: 'fixture-1', entries }))
}

/**
 * GitHub's API and raw host over in-memory commits: each ref names a commit, each commit a tree of paths to text,
 * symlinks or submodules. `served` changes what the raw host hands out for a path, as a host that lied would.
 */
export const fakeGitHub = (
  repos: Record<string, { refs: Record<string, string>; commits: Record<string, Record<string, string | { mode: string; type: string }>> }>,
  served: Record<string, string> = {},
) => {
  const blobs = new Map<string, string>()
  const requests: string[] = []
  const access: GitHubAccess = {
    api: 'https://api.test',
    raw: 'https://raw.test',
    fetch: async (input: string) => {
      const url = new URL(input)
      requests.push(`${url.host}${url.pathname}`)
      const missing = new Response('{}', { status: 404 })
      if (url.host === 'raw.test' || url.host === 'raw.githubusercontent.com') {
        const [, owner, name, sha = '', ...path] = url.pathname.split('/').map(decodeURIComponent)
        const content = served[path.join('/')] ?? repos[`${owner}/${name}`]?.commits[sha]?.[path.join('/')]
        return typeof content === 'string' ? new Response(content) : missing
      }
      const [, , owner, name, ...rest] = url.pathname.split('/')
      const repo = repos[`${owner}/${name}`]
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
          const sha = gitBlobSha(new TextEncoder().encode(content))
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
    },
  }
  return { access, requests }
}
