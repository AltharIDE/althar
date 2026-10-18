import { createHash } from 'node:crypto'
import { type Files } from './hash'
import { DEFAULT_LIMITS, isSafePath, type Limits } from './validate'

/*
 * Fetching a skill from GitHub (docs/plans/skills-across-harnesses.md, section 3): a branch or tag is resolved once
 * to a full commit SHA, and only the chosen skill directory's files at that commit are fetched. Nothing fetched is
 * run. A symlink, a submodule or a tree too large to hold is refused before any file is read, and every file is
 * checked against the git blob hash the commit's tree names, so what is stored is what the commit holds.
 */

/**
 * How to reach GitHub: its REST API and its raw file host, a fetch, and a token for a private repository. Without a
 * token, files come from the raw host, which GitHub doesn't count against the API's hourly allowance.
 */
export interface GitHubAccess {
  readonly api?: string
  readonly raw?: string
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>
  readonly token?: string
}

/** Where a skill is on GitHub: `owner/name`, the directory in it, and the branch, tag or commit to take it from. */
export interface GitHubSkillSource {
  readonly repo: string
  readonly subpath: string
  readonly ref: string
}

const REPO = /^[\w.-]+\/[\w.-]+$/
const SHA = /^[0-9a-f]{40}$/

/**
 * A GitHub URL or `owner/name`, as a person would paste it, with what follows `/tree/` in a URL: a ref and then a
 * path, which only GitHub can split, as a branch's name may hold a slash (`resolveTree`).
 */
export const parseGitHubSource = (text: string): { readonly repo: string; readonly tree?: string } | null => {
  const trimmed = text
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)(?:\/tree\/(.+))?$/.exec(trimmed)
  if (url !== null) {
    const [, repo = '', tree] = url
    return { repo, ...(tree === undefined ? {} : { tree }) }
  }
  return REPO.test(trimmed) ? { repo: trimmed } : null
}

const request = async (access: GitHubAccess, path: string, accept = 'application/vnd.github+json', base?: string): Promise<Response> => {
  const response = await attempt(access, path, accept, base)
  if (response === null) throw new Error(`GitHub ${path.split('?')[0]}: ${MISSING}`)
  return response
}

const MISSING = 'not found (or private, which Althar does not install from yet)'

/** A response, or null where GitHub has nothing there: no such repository, path, or commit for a ref. */
const attempt = async (access: GitHubAccess, path: string, accept: string, base?: string): Promise<Response | null> => {
  const response = await (access.fetch ?? globalThis.fetch)(`${base ?? access.api ?? 'https://api.github.com'}${path}`, {
    headers: {
      accept,
      'x-github-api-version': '2022-11-28',
      ...(access.token === undefined ? {} : { authorization: `Bearer ${access.token}` }),
    },
  })
  if (response.status === 404 || response.status === 422) return null
  if (!response.ok) {
    const what =
      response.status === 403 || response.status === 429
        ? 'GitHub is asking Althar to slow down; try again in a while'
        : `HTTP ${response.status}`
    throw new Error(`GitHub ${path.split('?')[0]}: ${what}`)
  }
  return response
}

const repoPath = (repo: string) => {
  if (!REPO.test(repo)) throw new Error(`not a GitHub repository: ${repo}`)
  return `/repos/${repo}`
}

/** The commit a ref names now, or null where it names none. */
const commitOf = async (access: GitHubAccess, repo: string, ref: string): Promise<string | null> => {
  if (ref === '' || ref.includes('..')) throw new Error(`not a ref: ${ref}`)
  const response = await attempt(access, `${repoPath(repo)}/commits/${encodeURIComponent(ref)}`, 'application/vnd.github.sha')
  if (response === null) return null
  const sha = (await response.text()).trim()
  if (!SHA.test(sha)) throw new Error(`GitHub named no commit for ${repo}@${ref}`)
  return sha
}

/** The full commit SHA a branch, tag or commit names now. A moving branch is read once, here, and never followed. */
export const resolveRef = async (access: GitHubAccess, repo: string, ref: string): Promise<string> => {
  const sha = await commitOf(access, repo, ref)
  if (sha === null) throw new Error(`GitHub ${repo}@${ref}: ${MISSING}`)
  return sha
}

/**
 * Splits what follows `/tree/` in a URL into the ref and the path in it, by asking GitHub for each ref it could
 * start with, shortest first. Git can't hold both `feature` and `feature/new` as branches, so at most one is a ref.
 */
export const resolveTree = async (
  access: GitHubAccess,
  repo: string,
  tree: string,
): Promise<{ readonly ref: string; readonly sha: string; readonly subpath?: string }> => {
  const parts = tree.split('/')
  for (let at = 1; at <= parts.length; at++) {
    const ref = parts.slice(0, at).join('/')
    const sha = await commitOf(access, repo, ref)
    if (sha === null) continue
    const subpath = parts.slice(at).join('/')
    return { ref, sha, ...(subpath === '' ? {} : { subpath }) }
  }
  throw new Error(`GitHub ${repo}: no branch, tag or commit starts ${tree}`)
}

interface TreeEntry {
  readonly path: string
  readonly mode: string
  readonly type: 'blob' | 'tree' | 'commit'
  readonly sha: string
  readonly size?: number
}

const treeOf = async (access: GitHubAccess, repo: string, sha: string): Promise<ReadonlyArray<TreeEntry>> => {
  const body = (await (await request(access, `${repoPath(repo)}/git/trees/${sha}?recursive=1`)).json()) as {
    readonly tree: ReadonlyArray<TreeEntry>
    readonly truncated: boolean
  }
  if (body.truncated) throw new Error(`${repo} is too large for GitHub to list in one go; install from a smaller repository`)
  return body.tree
}

/** Every directory in the repository at `sha` that holds a `SKILL.md`, to offer when the person names a repository and no path. */
export const findSkills = async (access: GitHubAccess, repo: string, sha: string): Promise<ReadonlyArray<string>> =>
  (await treeOf(access, repo, sha))
    .filter((entry) => entry.type === 'blob' && (entry.path === 'SKILL.md' || entry.path.endsWith('/SKILL.md')))
    .map((entry) => (entry.path === 'SKILL.md' ? '' : entry.path.slice(0, -'/SKILL.md'.length)))
    .toSorted()

/**
 * The files of one skill directory at a commit, keyed by their path inside it. Only that subtree is read: nothing
 * outside it (a repository's hooks, plugin manifests, package.json) is fetched. Refuses a symlink or submodule in
 * it, and a tree over the limits, before downloading a file.
 */
export const fetchSkill = async (
  access: GitHubAccess,
  repo: string,
  sha: string,
  subpath: string,
  limits: Limits = DEFAULT_LIMITS,
): Promise<Files> => {
  if (!SHA.test(sha)) throw new Error('a skill is fetched at a full commit SHA')
  const directory = subpath.replace(/^\/+|\/+$/g, '')
  if (directory !== '' && !isSafePath(directory)) throw new Error(`not a path in the repository: ${subpath}`)
  const prefix = directory === '' ? '' : `${directory}/`
  const inside = (await treeOf(access, repo, sha)).filter((entry) => entry.path.startsWith(prefix))
  const blobs: TreeEntry[] = []
  for (const entry of inside) {
    const path = entry.path.slice(prefix.length)
    if (entry.type === 'commit') throw new Error(`${entry.path} is a submodule`)
    if (entry.mode === '120000') throw new Error(`${entry.path} is a symlink`)
    if (entry.type === 'blob') {
      if (!isSafePath(path)) throw new Error(`unsafe path: ${entry.path}`)
      blobs.push(entry)
    }
  }
  if (!blobs.some((entry) => entry.path === `${prefix}SKILL.md`)) throw new Error(`${repo} has no SKILL.md at ${directory || 'its root'}`)
  if (blobs.length > limits.files) throw new Error(`${blobs.length} files; at most ${limits.files}`)
  const total = blobs.reduce((sum, entry) => sum + (entry.size ?? 0), 0)
  if (total > limits.bytes) throw new Error(`${total} bytes in all; at most ${limits.bytes}`)
  const tooLarge = blobs.find((entry) => (entry.size ?? 0) > limits.fileBytes)
  if (tooLarge !== undefined) throw new Error(`${tooLarge.path} is larger than ${limits.fileBytes} bytes`)
  const files = new Map<string, Uint8Array>()
  for (const entry of blobs) {
    const bytes = await blob(access, repo, sha, entry)
    if (gitBlobSha(bytes) !== entry.sha) throw new Error(`${entry.path} did not match the commit's tree`)
    files.set(entry.path.slice(prefix.length), bytes)
  }
  return files
}

/** A file's git blob hash, as a tree names it. */
export const gitBlobSha = (bytes: Uint8Array): string => createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')

const blob = async (access: GitHubAccess, repo: string, sha: string, entry: TreeEntry): Promise<Uint8Array> => {
  if (access.token === undefined) {
    const path = entry.path.split('/').map(encodeURIComponent).join('/')
    const response = await request(
      access,
      `/${repoPath(repo).slice('/repos/'.length)}/${sha}/${path}`,
      '*/*',
      access.raw ?? 'https://raw.githubusercontent.com',
    )
    return new Uint8Array(await response.arrayBuffer())
  }
  const body = (await (await request(access, `${repoPath(repo)}/git/blobs/${entry.sha}`)).json()) as {
    readonly content: string
    readonly encoding: string
  }
  if (body.encoding !== 'base64') throw new Error(`${entry.path} came as ${body.encoding}, not base64`)
  return new Uint8Array(Buffer.from(body.content, 'base64'))
}
