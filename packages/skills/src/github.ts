import { createHash } from 'node:crypto'
import { Effect, Option, Schema } from 'effect'
import { messageOf, SkillRefused } from './errors'
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

const MISSING = 'not found (or private, which Althar does not install from yet)'

const refused = (message: string) => new SkillRefused({ message })

/** What GitHub answered, read by `what`: its body as JSON, text or bytes. A network that drops the answer is said as such. */
const read = <A>(path: string, what: () => Promise<A>): Effect.Effect<A, SkillRefused> =>
  Effect.tryPromise({
    try: what,
    catch: (cause) => refused(`GitHub ${path.split('?')[0]}: the answer didn't arrive (${messageOf(cause)})`),
  })

/** A response, or null where GitHub has nothing there: no such repository, path, or commit for a ref. */
const attempt = (access: GitHubAccess, path: string, accept: string, base?: string): Effect.Effect<Response | null, SkillRefused> =>
  Effect.gen(function* () {
    const url = `${base ?? access.api ?? 'https://api.github.com'}${path}`
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        (access.fetch ?? globalThis.fetch)(url, {
          headers: {
            accept,
            'x-github-api-version': '2022-11-28',
            ...(access.token === undefined ? {} : { authorization: `Bearer ${access.token}` }),
          },
          signal,
        }),
      catch: (cause) => refused(`GitHub ${path.split('?')[0]}: Althar couldn't reach it (${messageOf(cause)})`),
    })
    if (response.status === 404 || response.status === 422) return null
    if (!response.ok) {
      const what =
        response.status === 403 || response.status === 429
          ? 'GitHub is asking Althar to slow down; try again in a while'
          : `HTTP ${response.status}`
      return yield* refused(`GitHub ${path.split('?')[0]}: ${what}`)
    }
    return response
  })

const request = (
  access: GitHubAccess,
  path: string,
  accept = 'application/vnd.github+json',
  base?: string,
): Effect.Effect<Response, SkillRefused> =>
  Effect.flatMap(attempt(access, path, accept, base), (response) =>
    response === null ? Effect.fail(refused(`GitHub ${path.split('?')[0]}: ${MISSING}`)) : Effect.succeed(response),
  )

/** A JSON answer read by `schema`; one of another shape is GitHub's to explain, not a guess. */
const json = <A>(access: GitHubAccess, path: string, schema: Schema.Codec<A, unknown>): Effect.Effect<A, SkillRefused> =>
  Effect.gen(function* () {
    const response = yield* request(access, path)
    const body = yield* read(path, (): Promise<unknown> => response.json())
    return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError((error) => refused(`GitHub ${path.split('?')[0]}: an answer Althar couldn't read (${error.message})`)),
    )
  })

const repoPath = (repo: string): Effect.Effect<string, SkillRefused> =>
  REPO.test(repo) ? Effect.succeed(`/repos/${repo}`) : Effect.fail(refused(`not a GitHub repository: ${repo}`))

/** The commit a ref names now, or null where it names none. */
const commitOf = (access: GitHubAccess, repo: string, ref: string): Effect.Effect<string | null, SkillRefused> =>
  Effect.gen(function* () {
    if (ref === '' || ref.includes('..')) return yield* refused(`not a ref: ${ref}`)
    const path = `${yield* repoPath(repo)}/commits/${encodeURIComponent(ref)}`
    const response = yield* attempt(access, path, 'application/vnd.github.sha')
    if (response === null) return null
    const sha = (yield* read(path, () => response.text())).trim()
    if (!SHA.test(sha)) return yield* refused(`GitHub named no commit for ${repo}@${ref}`)
    return sha
  })

/** The full commit SHA a branch, tag or commit names now. A moving branch is read once, here, and never followed. */
export const resolveRef = (access: GitHubAccess, repo: string, ref: string): Effect.Effect<string, SkillRefused> =>
  Effect.flatMap(commitOf(access, repo, ref), (sha) =>
    sha === null ? Effect.fail(refused(`GitHub ${repo}@${ref}: ${MISSING}`)) : Effect.succeed(sha),
  )

/**
 * Splits what follows `/tree/` in a URL into the ref and the path in it, by asking GitHub for each ref it could
 * start with, shortest first. Git can't hold both `feature` and `feature/new` as branches, so at most one is a ref.
 */
export const resolveTree = (
  access: GitHubAccess,
  repo: string,
  tree: string,
): Effect.Effect<{ readonly ref: string; readonly sha: string; readonly subpath?: string }, SkillRefused> =>
  Effect.gen(function* () {
    const parts = tree.split('/')
    for (let at = 1; at <= parts.length; at++) {
      const ref = parts.slice(0, at).join('/')
      const sha = yield* commitOf(access, repo, ref)
      if (sha === null) continue
      const subpath = parts.slice(at).join('/')
      return { ref, sha, ...(subpath === '' ? {} : { subpath }) }
    }
    return yield* refused(`GitHub ${repo}: no branch, tag or commit starts ${tree}`)
  })

const TreeEntry = Schema.Struct({
  path: Schema.String,
  mode: Schema.String,
  type: Schema.Literals(['blob', 'tree', 'commit']),
  sha: Schema.String,
  size: Schema.optionalKey(Schema.Number),
})
type TreeEntry = typeof TreeEntry.Type

const Tree = Schema.Struct({ tree: Schema.Array(TreeEntry), truncated: Schema.Boolean })
const Blob = Schema.Struct({ content: Schema.String, encoding: Schema.String })
/** The repository's licence as GitHub detects it: an SPDX id, or `NOASSERTION` where it found one it can't name. */
const Repository = Schema.Struct({ license: Schema.NullOr(Schema.Struct({ spdx_id: Schema.NullOr(Schema.String) })) })

const treeOf = (access: GitHubAccess, repo: string, sha: string): Effect.Effect<ReadonlyArray<TreeEntry>, SkillRefused> =>
  Effect.gen(function* () {
    const body = yield* json(access, `${yield* repoPath(repo)}/git/trees/${sha}?recursive=1`, Tree)
    if (body.truncated) return yield* refused(`${repo} is too large for GitHub to list in one go; install from a smaller repository`)
    return body.tree
  })

/** Every directory in the repository at `sha` that holds a `SKILL.md`, to offer when the person names a repository and no path. */
export const findSkills = (access: GitHubAccess, repo: string, sha: string): Effect.Effect<ReadonlyArray<string>, SkillRefused> =>
  Effect.map(treeOf(access, repo, sha), (tree) =>
    tree
      .filter((entry) => entry.type === 'blob' && (entry.path === 'SKILL.md' || entry.path.endsWith('/SKILL.md')))
      .map((entry) => (entry.path === 'SKILL.md' ? '' : entry.path.slice(0, -'/SKILL.md'.length)))
      .toSorted(),
  )

/**
 * The licence GitHub detects for a repository, by its SPDX id, for a skill that names none of its own; null where it
 * detects none, one it can't name, or GitHub won't say.
 */
export const repositoryLicense = (access: GitHubAccess, repo: string): Effect.Effect<string | null, SkillRefused> =>
  Effect.gen(function* () {
    const path = yield* repoPath(repo)
    const response = yield* attempt(access, path, 'application/vnd.github+json')
    if (response === null) return null
    const body = yield* read(path, (): Promise<unknown> => response.json())
    const spdx = Option.getOrUndefined(Schema.decodeUnknownOption(Repository)(body))?.license?.spdx_id ?? null
    return spdx === '' || spdx === 'NOASSERTION' ? null : spdx
  })

/**
 * The files of one skill directory at a commit, keyed by their path inside it. Only that subtree is read: nothing
 * outside it (a repository's hooks, plugin manifests, package.json) is fetched. Refuses a symlink or submodule in
 * it, and a tree over the limits, before downloading a file.
 */
export const fetchSkill = (
  access: GitHubAccess,
  repo: string,
  sha: string,
  subpath: string,
  limits: Limits = DEFAULT_LIMITS,
): Effect.Effect<Files, SkillRefused> =>
  Effect.gen(function* () {
    if (!SHA.test(sha)) return yield* refused('a skill is fetched at a full commit SHA')
    const directory = subpath.replace(/^\/+|\/+$/g, '')
    if (directory !== '' && !isSafePath(directory)) return yield* refused(`not a path in the repository: ${subpath}`)
    const prefix = directory === '' ? '' : `${directory}/`
    const inside = (yield* treeOf(access, repo, sha)).filter((entry) => entry.path.startsWith(prefix))
    const blobs: TreeEntry[] = []
    for (const entry of inside) {
      const path = entry.path.slice(prefix.length)
      if (entry.type === 'commit') return yield* refused(`${entry.path} is a submodule`)
      if (entry.mode === '120000') return yield* refused(`${entry.path} is a symlink`)
      if (entry.type === 'blob') {
        if (!isSafePath(path)) return yield* refused(`unsafe path: ${entry.path}`)
        blobs.push(entry)
      }
    }
    if (!blobs.some((entry) => entry.path === `${prefix}SKILL.md`))
      return yield* refused(`${repo} has no SKILL.md at ${directory || 'its root'}`)
    if (blobs.length > limits.files) return yield* refused(`${blobs.length} files; at most ${limits.files}`)
    const total = blobs.reduce((sum, entry) => sum + (entry.size ?? 0), 0)
    if (total > limits.bytes) return yield* refused(`${total} bytes in all; at most ${limits.bytes}`)
    const tooLarge = blobs.find((entry) => (entry.size ?? 0) > limits.fileBytes)
    if (tooLarge !== undefined) return yield* refused(`${tooLarge.path} is larger than ${limits.fileBytes} bytes`)
    const files = new Map<string, Uint8Array>()
    for (const entry of blobs) {
      const bytes = yield* blob(access, repo, sha, entry)
      if (gitBlobSha(bytes) !== entry.sha) return yield* refused(`${entry.path} did not match the commit's tree`)
      files.set(entry.path.slice(prefix.length), bytes)
    }
    return files
  })

/** A file's git blob hash, as a tree names it. */
export const gitBlobSha = (bytes: Uint8Array): string => createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')

const blob = (access: GitHubAccess, repo: string, sha: string, entry: TreeEntry): Effect.Effect<Uint8Array, SkillRefused> =>
  Effect.gen(function* () {
    const path = yield* repoPath(repo)
    if (access.token === undefined) {
      const file = entry.path.split('/').map(encodeURIComponent).join('/')
      const raw = `/${path.slice('/repos/'.length)}/${sha}/${file}`
      const response = yield* request(access, raw, '*/*', access.raw ?? 'https://raw.githubusercontent.com')
      return new Uint8Array(yield* read(raw, () => response.arrayBuffer()))
    }
    const body = yield* json(access, `${path}/git/blobs/${entry.sha}`, Blob)
    if (body.encoding !== 'base64') return yield* refused(`${entry.path} came as ${body.encoding}, not base64`)
    return new Uint8Array(Buffer.from(body.content, 'base64'))
  })
