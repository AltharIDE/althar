import { parseRemote } from '@althar/connectors'

/*
 * A fork, as its host says, else as its clone's remotes say (DEV-171). Its
 * own remote is `origin`. With a host connected there, Althar asks it whether
 * that repository is a fork and which repository it was forked from, and
 * finds that one among the clone's remotes by its address, whatever it is
 * called: `upstream`, `base`, `parent`, its owner's name. Where none has it,
 * the fork is still one, its parent not among the remotes, which the
 * repository's settings offer to add. Without an answer from a host, the
 * convention git hosts teach stays: an `upstream` beside `origin`, on the same
 * host, naming another repository. Remotes are only read here, never renamed
 * or removed.
 */

/** A remote of the clone: its name, and its fetch URL. */
type Remote = { readonly name: string; readonly url: string }

export interface Fork {
  /** The fork's remote, its path on its host (you/meridian-web), and its name in the clone: `origin`. */
  readonly fork: { readonly url: string; readonly path: ReadonlyArray<string>; readonly remote: string }
  /**
   * The repository it was forked from: its address and path, and the remote of the clone that has it, by whatever name; null
   * where none does, its address then the one to add it by, in the form `origin`'s is written.
   */
  readonly upstream: { readonly url: string; readonly path: ReadonlyArray<string>; readonly remote: string | null }
  /** Who said it is a fork: its host, or its remotes' names alone. */
  readonly by: 'host' | 'names'
}

/** What a host said of a repository: the path of the one it was forked from, or null for none. */
export type Parent = { readonly path: ReadonlyArray<string> } | null

/** A repository's place, the same however its address is written: host and path, lowercased. */
const keyOf = (ref: { readonly host: string; readonly path: ReadonlyArray<string> }) => `${ref.host}/${ref.path.join('/')}`.toLowerCase()

const samePath = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => a.join('/').toLowerCase() === b.join('/').toLowerCase()

/**
 * Whether a remote's path is a host's path for a repository: the same, or the same under the server's own path or Bitbucket
 * Data Center's `scm/`, as a remote's address may have it in front.
 */
const pathIs = (remote: ReadonlyArray<string>, host: ReadonlyArray<string>) =>
  remote.length >= host.length && samePath(remote.slice(remote.length - host.length), host)

/**
 * What hosts last said of each repository they were asked about, by its
 * place, and when: kept for the whole of this run of Althar, so a fork is
 * known as one in every place that reads its remotes, connected or not at
 * that moment, and the host is asked again only after PARENT_KEPT. One
 * process runs one runtime, so it is kept here, where every reader of remotes
 * reaches it, rather than on a service only some of them have.
 */
const told = new Map<string, { readonly at: number; readonly parent: Parent }>()

/** How long a host's answer stands before it is asked again: a fork's parent hardly ever changes. */
export const PARENT_KEPT = 60 * 60_000

/** What a host said of the repository at a remote's address, and when; undefined where none was asked, or none answered. */
export const toldOf = (url: string) => {
  const ref = parseRemote(url)
  return ref === null ? undefined : told.get(keyOf(ref))
}

/** Keeps what a host said of the repository at an address: the one it was forked from, or that it is no fork. */
export const tell = (url: string, parent: Parent, at: number) => {
  const ref = parseRemote(url)
  if (ref !== null) told.set(keyOf(ref), { at, parent })
}

/**
 * Keeps what a host said of a repository it read, where it said whether it is a fork, as said of the remote at `url`: only
 * where that remote is that repository, as a read of another (the one a fork came from) says nothing of it.
 */
export const tellOf = (
  url: string,
  repository: { readonly path: ReadonlyArray<string>; readonly parent?: Parent | undefined },
  at: number,
) => {
  const ref = parseRemote(url)
  if (repository.parent === undefined || ref === null || !pathIs(ref.path, repository.path)) return false
  const was = told.get(keyOf(ref))?.parent
  told.set(keyOf(ref), { at, parent: repository.parent })
  return was === undefined ? true : (was?.path.join('/') ?? null) !== (repository.parent?.path.join('/') ?? null)
}

/** Forgets every host's answer: for tests, which start each runtime afresh. */
export const forgetTold = () => told.clear()

/** An address for a repository on the same host, written as `like` is (SSH or HTTPS, with `.git` or not): `like`'s path swapped. */
export const addressLike = (like: string, path: ReadonlyArray<string>, own: ReadonlyArray<string>) => {
  const written = own.join('/')
  const at = like.toLowerCase().lastIndexOf(written.toLowerCase())
  return at < 0 ? null : `${like.slice(0, at)}${path.join('/')}${like.slice(at + written.length)}`
}

/**
 * The fork a repository's remotes make it, or null. `said` is what its host
 * said of `origin`'s repository, by default what a host last said of it here;
 * undefined where no host said. A host's parent is found among the remotes by
 * address, `upstream` first where several have it. A host saying it is no
 * fork leaves the remotes' names to say, so a clone with an `upstream` is
 * read as it always was.
 */
export const forkOf = (remotes: ReadonlyArray<Remote>, said?: Parent): Fork | null => {
  const origin = remotes.find((remote) => remote.name === 'origin')
  if (origin === undefined) return null
  const own = parseRemote(origin.url)
  if (own === null) return null
  const parent = said === undefined ? told.get(keyOf(own))?.parent : said
  if (parent != null && !samePath(parent.path, own.path)) {
    const having = remotes.filter((remote) => {
      if (remote.name === 'origin') return false
      const ref = parseRemote(remote.url)
      return ref !== null && ref.host === own.host && pathIs(ref.path, parent.path)
    })
    const there = having.find((remote) => remote.name === 'upstream') ?? having[0]
    return {
      fork: { url: origin.url, path: own.path, remote: 'origin' },
      upstream:
        there === undefined
          ? {
              url: addressLike(origin.url, parent.path, own.path) ?? `https://${own.host}/${parent.path.join('/')}.git`,
              path: parent.path,
              remote: null,
            }
          : { url: there.url, path: parent.path, remote: there.name },
      by: 'host',
    }
  }
  const upstream = remotes.find((remote) => remote.name === 'upstream')
  if (upstream === undefined) return null
  const from = parseRemote(upstream.url)
  if (from === null || own.host !== from.host) return null
  if (samePath(own.path, from.path)) return null
  return {
    fork: { url: origin.url, path: own.path, remote: 'origin' },
    upstream: { url: upstream.url, path: from.path, remote: 'upstream' },
    by: 'names',
  }
}

/** The remote of the clone a fork's parent is on, where it is among them: what fetching, starting from and merging from it go by. */
export const parentRemote = (fork: Fork | null) => fork?.upstream.remote ?? null

/**
 * Where a repository's work goes, best first: its `origin` as its clone has
 * it now, then the rest it was added with. `git remote -v` lists remotes by
 * name, so a clone whose remotes were renamed by hand, the repository it was
 * forked from as `origin` and the fork as `fork`, would otherwise have the
 * fork first; it is no fork Althar can tell, and its work goes to `origin`.
 */
export const workRemotes = (remotes: ReadonlyArray<Remote>, recorded: ReadonlyArray<string>): ReadonlyArray<string> => {
  const origin = remotes.find((remote) => remote.name === 'origin')?.url
  return origin === undefined ? recorded : [origin, ...recorded.filter((url) => url !== origin)]
}

const escaped = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The branch a ref names on one of the remotes given, as a task's base is
 * written, `origin/main`, `base/release/0.8`; `origin` and `upstream` always,
 * as a clone's remotes had them when the task started, which a rename by hand
 * since hasn't changed. Null for a ref on none of them.
 */
export const onRemote = (ref: string, remotes: ReadonlyArray<string> = []) => {
  const names = [...new Set(['origin', 'upstream', ...remotes])].map(escaped).join('|')
  const found = new RegExp(`^(${names})/(.+)$`).exec(ref)
  return found === null ? null : { remote: found[1] ?? '', branch: found[2] ?? '' }
}

/**
 * The branch a task's base names on the repository a fork was forked from:
 * `upstream/main`'s, as the clone had it when the task started, or that of
 * the remote the clone has it under now, `base/main`'s; null for a base on
 * another remote, or none.
 */
export const fromParent = (baseRef: string | null, fork: Fork) => {
  if (baseRef === null) return null
  const on = onRemote(baseRef, fork.upstream.remote === null ? [] : [fork.upstream.remote])
  return on === null || on.remote === 'origin' ? null : on.branch
}

/**
 * The branch a task's base names on the repository: `origin/…`, `upstream/…`,
 * or another of its remotes', the remote's name left off. A branch of the
 * clone's own called that stays as it is.
 */
export const baseBranch = (baseRef: string, local: boolean, remotes: ReadonlyArray<string> = []) =>
  local ? baseRef : (onRemote(baseRef, remotes)?.branch ?? baseRef)
