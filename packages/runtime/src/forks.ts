import { parseRemote, type Product } from '@althar/connectors'

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

/** A repository a host named: its path there, and the addresses it gives to clone it by, where it gives them. */
type Named = { readonly path: ReadonlyArray<string>; readonly addresses?: ReadonlyArray<string> | undefined }

/**
 * What a host said of a repository: the one it was forked from, and, for a fork of a fork, the one at the root of its forks
 * (GitHub's `source`); or null for no fork.
 */
export type Parent = (Named & { readonly source?: Named | undefined }) | null

/** A repository's place, the same however its address is written: host and path, lowercased. */
const keyOf = (ref: { readonly host: string; readonly path: ReadonlyArray<string> }) => `${ref.host}/${ref.path.join('/')}`.toLowerCase()

const samePath = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => a.join('/').toLowerCase() === b.join('/').toLowerCase()

/**
 * Whether a remote's path ends in a host's path for a repository: how `origin`'s address is matched to what its own host says
 * of it, which tells what the server puts in front of a repository's path there (its own path, Bitbucket Data Center's `scm/`).
 */
const endsIn = (remote: ReadonlyArray<string>, host: ReadonlyArray<string>) =>
  remote.length >= host.length && samePath(remote.slice(remote.length - host.length), host)

/**
 * Where a host's paths for repositories sit in its addresses, as its answer for `origin` told: what the server puts in front of
 * them in `origin`'s address (`context`: nothing on GitHub, a server's own path where it is under one), and whether the host is
 * Bitbucket Data Center (`scm`), whose HTTPS addresses have `scm/` in front of what its SSH ones have.
 */
export type Place = { readonly context: ReadonlyArray<string>; readonly scm: boolean }

const NOWHERE: Place = { context: [], scm: false }

/**
 * Whether a remote's path is a host's path for a repository, with exactly what the server puts in front of a repository's
 * path there, so `archive/group/repo` is never `group/repo`; on Bitbucket Data Center, with its `scm/` or without, as its
 * HTTPS and SSH addresses differ, and on no other host, where `scm/group/repo` is a repository of its own.
 */
const pathIs = (remote: ReadonlyArray<string>, host: ReadonlyArray<string>, { context, scm }: Place): boolean => {
  if (!scm) return samePath(remote, [...context, ...host])
  const bare = context.at(-1)?.toLowerCase() === 'scm' ? context.slice(0, -1) : context
  return [bare, [...bare, 'scm']].some((before) => samePath(remote, [...before, ...host]))
}

/** Whether an address is SSH's, `git@host:path` or `ssh://`, which never has a server's own path or Data Center's `scm/` in it. */
const isSsh = (url: string) => /^ssh:\/\//i.test(url.trim()) || !url.includes('://')

/**
 * Whether a remote of the clone is a repository a host named: at one of the addresses the host gave for it, or, on `origin`'s
 * host, at its path as the host's addresses are written there (`where`); an SSH remote at its path alone, as SSH addresses
 * have nothing in front of it, though `origin`'s HTTPS one has the server's own path.
 */
const isAt = (remote: Remote, named: Named, host: string, where: Place) => {
  const ref = parseRemote(remote.url)
  if (ref === null) return false
  if ((named.addresses ?? []).some((address) => matchKey(address) === keyOf(ref))) return true
  return ref.host === host && (pathIs(ref.path, named.path, where) || (isSsh(remote.url) && samePath(ref.path, named.path)))
}

const matchKey = (url: string) => {
  const ref = parseRemote(url)
  return ref === null ? null : keyOf(ref)
}

/**
 * What hosts last said of each repository they were asked about, by its
 * place, and when: kept for the whole of this run of Althar, so a fork is
 * known as one in every place that reads its remotes, connected or not at
 * that moment, and the host is asked again only after PARENT_KEPT. One
 * process runs one runtime, so it is kept here, where every reader of remotes
 * reaches it, rather than on a service only some of them have.
 */
const told = new Map<string, Told>()

/**
 * What a host said of a repository, and when; with what the server puts in front of a repository's path in the address it was
 * asked by, `origin`'s, which the host's own path for it leaves out: [] on GitHub, `scm` on Bitbucket Data Center over HTTPS, a
 * server's own path where it is under one.
 */
type Told = { readonly at: number; readonly parent: Parent } & Place

/** How long a host's answer stands before it is asked again: a fork's parent hardly ever changes. */
export const PARENT_KEPT = 60 * 60_000

/** What a host said of the repository at a remote's address, and when; undefined where none was asked, or none answered. */
export const toldOf = (url: string) => {
  const ref = parseRemote(url)
  return ref === null ? undefined : told.get(keyOf(ref))
}

/**
 * Keeps what a host said of the repository at an address: the one it was forked from, or that it is no fork; `place`, where
 * its paths sit in that address.
 */
export const tell = (url: string, parent: Parent, at: number, place: Place = NOWHERE) => {
  const ref = parseRemote(url)
  if (ref !== null) told.set(keyOf(ref), { at, parent, ...place })
}

/**
 * Keeps what a host said of a repository it read, where it said whether it is a fork, as said of the remote at `url`: only
 * where that remote is that repository, as a read of another (the one a fork came from) says nothing of it.
 */
export const tellOf = (
  url: string,
  repository: { readonly path: ReadonlyArray<string>; readonly parent?: Parent | undefined },
  at: number,
  product?: Product,
) => {
  const ref = parseRemote(url)
  if (repository.parent === undefined || ref === null || !endsIn(ref.path, repository.path)) return false
  const was = told.get(keyOf(ref))?.parent
  const context = ref.path.slice(0, ref.path.length - repository.path.length)
  told.set(keyOf(ref), { at, parent: repository.parent, context, scm: product === 'bitbucket_dc' })
  return was === undefined ? true : saying(was) !== saying(repository.parent)
}

/** What a host's answer says of a fork, to tell whether a later one says otherwise: its parent, and its root. */
const saying = (parent: Parent) =>
  parent === null ? null : `${parent.path.join('/')} ${parent.source?.path.join('/') ?? ''}`.toLowerCase()

/** Forgets every host's answer: for tests, which start each runtime afresh. */
export const forgetTold = () => told.clear()

/**
 * An address for a repository on the same host, written as `like` is (SSH or HTTPS, with `.git` or not): `like`'s repository,
 * `own`, its path less what the server puts in front of it (`context`), swapped for `path`, so what is in front stays (Bitbucket
 * Data Center's `scm/`, a server's own path), however deep either repository's namespace.
 */
export const addressLike = (like: string, path: ReadonlyArray<string>, own: ReadonlyArray<string>, context: ReadonlyArray<string> = []) => {
  const written = own.slice(context.length).join('/')
  const at = like.toLowerCase().lastIndexOf(written.toLowerCase())
  if (at < 0 || written === '') return null
  return `${like.slice(0, at)}${path.join('/')}${like.slice(at + written.length)}`
}

/**
 * The fork a repository's remotes make it, or null. `said` is what its host
 * said of `origin`'s repository, by default what a host last said of it here;
 * undefined where no host said. A host's parent is found among the remotes by
 * address, `upstream` first where several have it; where none has it, the
 * root of its forks, where the host said one (a fork of a fork, whose
 * `upstream` is often the root). Where none has either and the host can't say
 * the root (GitLab, Bitbucket), an `upstream` on the same host naming another
 * repository is the parent as the names say, as it always was: the root of a
 * fork of a fork, or the repository a mirror its fork was made from mirrors.
 * Where the host said the root (GitHub), one that is neither isn't. A host saying it is no fork leaves the remotes' names to say
 * too, so a clone with an `upstream` is read as it always was. `place` is
 * where the host's paths sit in its addresses, as its answer told it, else as
 * on GitHub.
 */
export const forkOf = (remotes: ReadonlyArray<Remote>, said?: Parent, place?: Place): Fork | null => {
  const origin = remotes.find((remote) => remote.name === 'origin')
  if (origin === undefined) return null
  const own = parseRemote(origin.url)
  if (own === null) return null
  const kept = told.get(keyOf(own))
  const parent = said === undefined ? kept?.parent : said
  const where = place ?? (said === undefined ? kept : undefined) ?? NOWHERE
  const before = where.context
  const fork = { url: origin.url, path: own.path, remote: 'origin' }
  const named = byNames(remotes, origin, own)
  if (parent == null || samePath(parent.path, own.path.slice(before.length))) return named
  const having = (repository: Named) => {
    const at = remotes.filter((remote) => remote.name !== 'origin' && isAt(remote, repository, own.host, where))
    return at.find((remote) => remote.name === 'upstream') ?? at[0]
  }
  const there = having(parent)
  if (there !== undefined) return { fork, upstream: { url: there.url, path: parent.path, remote: there.name }, by: 'host' }
  const root = parent.source === undefined ? undefined : having(parent.source)
  if (root !== undefined && parent.source !== undefined) {
    return { fork, upstream: { url: root.url, path: parent.source.path, remote: root.name }, by: 'host' }
  }
  // Where the host can't say the root of its forks, an `upstream` that is neither may be it: the names say, as they always did.
  if (named !== null && parent.source === undefined) return named
  // Its addresses as the host gives them, the one written as origin's is (SSH or HTTPS) first, else one made like origin's.
  const given = parent.addresses ?? []
  const url =
    given.find((address) => isSsh(address) === isSsh(origin.url)) ??
    addressLike(origin.url, parent.path, own.path, before) ??
    given[0] ??
    `https://${own.host}/${[...before, ...parent.path].join('/')}.git`
  return { fork, upstream: { url, path: parent.path, remote: null }, by: 'host' }
}

/** The fork the remotes' names make: an `upstream` beside `origin`, on the same host, naming another repository. */
const byNames = (remotes: ReadonlyArray<Remote>, origin: Remote, own: { readonly host: string; readonly path: ReadonlyArray<string> }) => {
  const upstream = remotes.find((remote) => remote.name === 'upstream')
  if (upstream === undefined) return null
  const from = parseRemote(upstream.url)
  if (from === null || own.host !== from.host) return null
  if (samePath(own.path, from.path)) return null
  return {
    fork: { url: origin.url, path: own.path, remote: 'origin' },
    upstream: { url: upstream.url, path: from.path, remote: 'upstream' },
    by: 'names',
  } satisfies Fork
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
