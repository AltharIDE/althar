import { type Files } from './hash'
import { DEFAULT_LIMITS, isSafePath, type Limits } from './validate'

/*
 * Fetching a skill from GitHub (docs/plans/skills-across-harnesses.md, section 3): a branch or tag is resolved once
 * to a full commit SHA, and only the chosen skill directory's files at that commit are fetched, over GitHub's REST
 * API. Nothing fetched is run. A symlink, a submodule or a tree too large to hold is refused before any file is read.
 */

/** How to reach GitHub's REST API: its base URL, a fetch, and a token for a private repository, if the person connected one. */
export interface GitHubAccess {
  readonly api?: string
  readonly fetch?: typeof globalThis.fetch
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

/** A GitHub URL or `owner/name`, with an optional `/tree/<ref>/<path>`, as a person would paste it. */
export const parseGitHubSource = (text: string): { readonly repo: string; readonly ref?: string; readonly subpath?: string } | null => {
  const trimmed = text
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)(?:\/tree\/([^/]+)(?:\/(.+))?)?$/.exec(trimmed)
  if (url !== null) {
    const [, repo = '', ref, subpath] = url
    return { repo, ...(ref === undefined ? {} : { ref }), ...(subpath === undefined ? {} : { subpath }) }
  }
  return REPO.test(trimmed) ? { repo: trimmed } : null
}

const request = async (access: GitHubAccess, path: string, accept = 'application/vnd.github+json'): Promise<Response> => {
  const response = await (access.fetch ?? globalThis.fetch)(`${access.api ?? 'https://api.github.com'}${path}`, {
    headers: {
      accept,
      'x-github-api-version': '2022-11-28',
      ...(access.token === undefined ? {} : { authorization: `Bearer ${access.token}` }),
    },
  })
  if (!response.ok) {
    const what = response.status === 404 ? 'not found (or private, with no GitHub connection that can read it)' : `HTTP ${response.status}`
    throw new Error(`GitHub ${path.split('?')[0]}: ${what}`)
  }
  return response
}

const repoPath = (repo: string) => {
  if (!REPO.test(repo)) throw new Error(`not a GitHub repository: ${repo}`)
  return `/repos/${repo}`
}

/** The full commit SHA a branch, tag or commit names now. A moving branch is read once, here, and never followed. */
export const resolveRef = async (access: GitHubAccess, repo: string, ref: string): Promise<string> => {
  if (ref === '' || ref.includes('..')) throw new Error(`not a ref: ${ref}`)
  const sha = (
    await (await request(access, `${repoPath(repo)}/commits/${encodeURIComponent(ref)}`, 'application/vnd.github.sha')).text()
  ).trim()
  if (!SHA.test(sha)) throw new Error(`GitHub named no commit for ${repo}@${ref}`)
  return sha
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
    const body = (await (await request(access, `${repoPath(repo)}/git/blobs/${entry.sha}`)).json()) as {
      readonly content: string
      readonly encoding: string
    }
    if (body.encoding !== 'base64') throw new Error(`${entry.path} came as ${body.encoding}, not base64`)
    files.set(entry.path.slice(prefix.length), new Uint8Array(Buffer.from(body.content, 'base64')))
  }
  return files
}
