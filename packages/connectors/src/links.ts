import type { Product } from './model'

/*
 * Links and remotes, read without asking anyone: which host a repository's
 * remote is on and at what path, and what a pasted link points at. A host
 * is known by name (github.com, linear.app) or because the person connected
 * an instance on it.
 */

/** A repository's place: the host's name, and the path to it. */
export interface RemoteRef {
  readonly host: string
  readonly path: ReadonlyArray<string>
}

/**
 * Reads a git remote: `git@host:owner/repo.git`, `ssh://git@host:22/owner/repo`,
 * `https://host/owner/repo.git`, and GitLab's nested groups. Null for a local
 * path or anything else without a host.
 */
export const parseRemote = (remote: string): RemoteRef | null => {
  const text = remote.trim()
  let host: string
  let path: string
  if (!text.includes('://')) {
    // scp-like: [user@]host:path
    const scp = /^(?:[^@\s]+@)?([^:/\s]+):(.+)$/.exec(text)
    if (scp === null) return null
    host = scp[1] ?? ''
    path = scp[2] ?? ''
  } else {
    let url: URL
    try {
      url = new URL(text)
    } catch {
      return null
    }
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol) || url.hostname === '') return null
    host = url.hostname
    path = decodeURIComponent(url.pathname)
  }
  const segments = path
    .replace(/\.git\/?$/, '')
    .split('/')
    .filter((segment) => segment !== '')
  return segments.length < 2 ? null : { host: host.toLowerCase(), path: segments }
}

/** What a pasted link points at: an issue, or a change, on a product at a host. */
export type LinkRef =
  | { readonly kind: 'issue'; readonly product: Product; readonly host: string; readonly ref: string }
  | {
      readonly kind: 'change'
      readonly product: Product
      readonly host: string
      readonly path: ReadonlyArray<string>
      readonly number: number
    }

/** Hosts by name: the hosted products, plus each instance the person connected. */
export type KnownHosts = ReadonlyMap<string, Product>

/** The hosted products' own hosts. */
export const HOSTED: KnownHosts = new Map<string, Product>([
  ['github.com', 'github'],
  ['gitlab.com', 'gitlab'],
  ['bitbucket.org', 'bitbucket_cloud'],
  ['linear.app', 'linear'],
  ['trello.com', 'trello'],
])

/** Reads a link to an issue or a change on a known host; null for anything else. */
export const parseLink = (link: string, hosts: KnownHosts = HOSTED): LinkRef | null => {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  const product = hosts.get(host) ?? (host.endsWith('.atlassian.net') ? 'jira_cloud' : undefined)
  if (product === undefined) return null
  const segments = url.pathname.split('/').filter((segment) => segment !== '')
  switch (product) {
    case 'github': {
      const [owner, repo, kind, number] = segments
      const n = Number(number)
      if (owner === undefined || repo === undefined || !Number.isInteger(n) || n <= 0) return null
      if (kind === 'issues') return { kind: 'issue', product, host, ref: `${owner}/${repo}#${n}` }
      if (kind === 'pull') return { kind: 'change', product, host, path: [owner, repo], number: n }
      return null
    }
    case 'gitlab': {
      // https://gitlab.com/group/sub/project/-/issues/12, or /-/merge_requests/12
      const dash = segments.indexOf('-')
      const path = segments.slice(0, dash)
      const kind = segments[dash + 1]
      const n = Number(segments[dash + 2])
      if (dash < 2 || !Number.isInteger(n) || n <= 0) return null
      if (kind === 'issues' || kind === 'work_items') return { kind: 'issue', product, host, ref: `${path.join('/')}#${n}` }
      if (kind === 'merge_requests') return { kind: 'change', product, host, path, number: n }
      return null
    }
    case 'linear': {
      // https://linear.app/<workspace>/issue/MER-231/<slug>
      const at = segments.indexOf('issue')
      const key = at === -1 ? undefined : segments[at + 1]
      return key !== undefined && /^[A-Z][A-Z0-9]*-\d+$/i.test(key) ? { kind: 'issue', product, host, ref: key.toUpperCase() } : null
    }
    case 'jira_cloud':
    case 'jira_dc': {
      // /browse/PROJ-123, or a board with ?selectedIssue=PROJ-123
      const browse = segments.indexOf('browse')
      const key = browse === -1 ? (url.searchParams.get('selectedIssue') ?? undefined) : segments[browse + 1]
      return key !== undefined && /^[A-Z][A-Z0-9_]*-\d+$/i.test(key) ? { kind: 'issue', product, host, ref: key.toUpperCase() } : null
    }
    case 'trello': {
      // https://trello.com/c/<shortLink>/<slug>
      const [kind, shortLink] = segments
      return kind === 'c' && shortLink !== undefined && /^[A-Za-z0-9]+$/.test(shortLink)
        ? { kind: 'issue', product, host, ref: shortLink }
        : null
    }
    case 'bitbucket_cloud':
    case 'bitbucket_dc': {
      // bitbucket.org/<workspace>/<repo>/pull-requests/12; Data Center: /projects/P/repos/r/pull-requests/12, perhaps under
      // the server's own path, or a person's own repository at /users/name/repos/r, which goes by `~name`.
      const at = segments.indexOf('pull-requests')
      const n = Number(segments[at + 1])
      if (at < 2 || !Number.isInteger(n) || n <= 0) return null
      const owner = segments[at - 4]
      const path =
        product === 'bitbucket_dc' && segments[at - 2] === 'repos' && (owner === 'projects' || owner === 'users')
          ? [`${owner === 'users' ? '~' : ''}${segments[at - 3] ?? ''}`, segments[at - 1] ?? '']
          : segments.slice(0, at)
      return { kind: 'change', product, host, path, number: n }
    }
  }
}

/** Every http(s) link in a piece of text, in order, once each, without trailing punctuation. */
export const linksIn = (text: string): ReadonlyArray<string> => [
  ...new Set([...text.matchAll(/https?:\/\/[^\s<>()"'`]+/g)].map((match) => match[0].replace(/[.,;:!?)\]]+$/, ''))),
]

/**
 * Where a host opens a new pull request from a branch into its base, for
 * pushing without a connection: GitHub, GitLab and Bitbucket by the hosts
 * they are known by (and a GitLab, Gitea or Forgejo of a team's own by its
 * name), from the remote the branch went to. Null for a host whose page
 * can't be told.
 */
export const newPullRequestLink = (remote: string, branch: string, base: string, known: KnownHosts): string | null => {
  const ref = parseRemote(remote)
  if (ref === null) return null
  // A web remote's page is on its own scheme and port; one reached over SSH is on the host's https site.
  const web = /^https?:\/\//i.test(remote.trim()) ? new URL(remote.trim()) : null
  const at = `${web === null ? `https://${ref.host}` : `${web.protocol}//${web.host.toLowerCase()}`}/${ref.path.map(encodeURIComponent).join('/')}`
  const product = known.get(ref.host)
  const [from, into] = [encodeURIComponent(branch), encodeURIComponent(base)]
  // In a path, a branch keeps its slashes, as the host's own links write it.
  const [fromPath, intoPath] = [branch, base].map((name) => name.split('/').map(encodeURIComponent).join('/'))
  if (product === 'github') return `${at}/compare/${intoPath}...${fromPath}?expand=1`
  if (product === 'bitbucket_cloud') return `${at}/pull-requests/new?source=${from}&dest=${into}`
  if (product === 'gitlab' || /(^|\.)gitlab\./.test(ref.host))
    return `${at}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${from}&merge_request%5Btarget_branch%5D=${into}`
  if (/(^|\.)(gitea|forgejo)\.|^codeberg\.org$/.test(ref.host)) return `${at}/compare/${intoPath}...${fromPath}`
  return null
}
