import { rm } from 'node:fs/promises'
import { Effect } from 'effect'
import { unlockTree } from '../src/files'
import { type GitHubAccess, gitBlobSha } from '../src/github'
import { type Files } from '../src/hash'
import { putObject, readInstalls, withInstall, writeInstalls } from '../src/store'

const encoder = new TextEncoder()

/** Runs a skills effect as a test awaits it: its value, or its failure as the rejection. */
export const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

/** The failure an effect ends with, to look at. */
export const failure = <A, E>(effect: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(effect))

/** Removes a store, whose objects and run copies are read-only, folders too. */
export const clean = (directory: string): Promise<void> =>
  Effect.runPromise(unlockTree(directory)).then(() => rm(directory, { recursive: true, force: true }))

/** A skill tree from text, as a fetch would hand it over. */
export const tree = (files: Record<string, string>): Files =>
  new Map(Object.entries(files).map(([path, text]) => [path, encoder.encode(text)]))

export const skillMd = (front: string, body = 'Do the thing.\n'): string => `---\n${front}\n---\n${body}`

export const good = (name = 'my-skill'): Record<string, string> => ({
  'SKILL.md': skillMd(`name: ${name}\ndescription: Use when testing.\nlicense: MIT\nmetadata:\n  author: someone`),
})

/** Puts a skill in the store and records it as one of the person's own installs, on or off; returns its stored version. */
export const install = async (root: string, id: string, files: Record<string, string>, active = true): Promise<string> => {
  const hash = await run(putObject(root, tree(files)))
  await run(
    writeInstalls(root, withInstall(await run(readInstalls(root)), { id, source: 'local', treeHash: hash, review: 'reviewed', active })),
  )
  return hash
}

/**
 * GitHub's API and raw host over in-memory commits: each ref names a commit, each commit a tree of paths to text,
 * symlinks or submodules. `served` changes what the raw host hands out for a path, as a host that lied would.
 */
export const fakeGitHub = (
  repos: Record<
    string,
    {
      refs: Record<string, string>
      commits: Record<string, Record<string, string | { mode: string; type: string }>>
      /** The licence GitHub detects for the repository, by SPDX id; none where it detects none. */
      license?: string
    }
  >,
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
      if (rest.length === 0) return Response.json({ license: repo.license === undefined ? null : { spdx_id: repo.license } })
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
