import { type CodeHost, parseLink, parseRemote, type Repository } from '@althar/connectors'
import { Context, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from './Connections'
import { forkOf } from './forks'
import { commitOf, type FetchSource, fetchSpecs, git, gitOutcome, namedRemotes, redactUrl, remoteHeads } from './git'
import { Instance } from './Instance'
import { type Tool, ToolRefused, ToolServer } from './ToolServer'

/*
 * Fetching from the code host, which only Althar reaches (ADR-011, ADR-065):
 * a branch, a tag or a pull request, into the person's repository, with
 * Althar's sign-in. Through the connection to the repository's host where
 * there is one, its header going to git through the environment, else
 * through the remote as the person's own git reaches it, as Althar fetches
 * the default branch. A branch lands where `git fetch` would put it
 * (`origin/<branch>`); a fork's pull request, which has no branch here, at
 * `refs/althar/pull/<n>`, from the host's own ref for it. Nothing is pushed,
 * no branch here moves, and no checkout changes: only refs and objects.
 *
 * Run a branch (Launches.ts) fetches what it runs this way; a lead asks for
 * what its worktree lacks with fetch_from_remote, since it carries no
 * sign-in of its own; and the Run menu lists what there is to run, fetched
 * fresh as it opens.
 */

/** What is asked for: a remote's branch or tag by name, or a pull request by its number or link. */
export type Wanted =
  | { readonly kind: 'branch'; readonly name: string }
  | { readonly kind: 'tag'; readonly name: string }
  | { readonly kind: 'pull_request'; readonly which: string }

/** What was fetched: the commit, the ref it is at here, and what it is, in words. */
export interface Fetched {
  readonly commit: string
  /** The ref here it is at now: refs/remotes/origin/feature/x, refs/tags/v1.2, refs/althar/pull/12. */
  readonly ref: string
  /** The remote it came from, by name. */
  readonly remote: string
  /** Its branch, where it has one: a pull request's, even a fork's. */
  readonly branch: string | null
  readonly pullRequest: { readonly number: number; readonly name: string; readonly title: string | null } | null
  /** What it is, at a glance: feature/x, v1.2, PR #12 · feature/x. */
  readonly label: string
}

/** A pull request the Run menu offers. */
export interface OfferedPullRequest {
  readonly number: number
  /** As its host writes it: PR #12, MR !12. */
  readonly name: string
  readonly title: string
  readonly branch: string
  readonly author: string | null
  readonly draft: boolean
  /** Its branch is on a fork. */
  readonly fork: boolean
}

/** What a repository offers to run, as its remote has it now. */
export interface Offered {
  readonly repository: string
  /** Its open pull requests, newest first; empty where no connection to its host lists them. */
  readonly pullRequests: ReadonlyArray<OfferedPullRequest>
  /** Its remote's branches, by name, its default first. */
  readonly branches: ReadonlyArray<string>
  /** Why it lists less than it might: its remote couldn't be reached, or no connection lists its pull requests; null where it lists all. */
  readonly note: string | null
  /** The host has more open pull requests than it listed: words find them, searched there. */
  readonly more: boolean
}

/** Why Althar couldn't fetch what was asked, in words for the person or an agent. */
export class FetchRefused extends Schema.TaggedError<FetchRefused>()('FetchRefused', { message: Schema.String }) {}

/** A connected host, the repository a remote is there, and the URL and header that sign Althar in. */
interface Signed {
  readonly host: CodeHost
  readonly repository: Repository
  readonly source: FetchSource
}

/** A remote, and where to fetch it from: signed in through its host first, where Althar is connected to it, then as the person's git does. */
interface Reach {
  readonly remote: string
  readonly url: string
  readonly signed: Signed | null
  readonly sources: ReadonlyArray<FetchSource>
}

/** Branches it would be like the person meant, for a name a remote doesn't have: those sharing a word with it. */
const alike = (name: string, branches: ReadonlyArray<string>) => {
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2)
  return branches.filter((branch) => words.some((word) => branch.toLowerCase().includes(word))).slice(0, 5)
}

/** The number a pull request is asked for by, where it isn't a link: 12, #12, !12. */
const numberOf = (which: string) => {
  const found = /^[#!]?(\d+)$/.exec(which.trim())?.[1]
  return found === undefined ? null : Number(found)
}

const sameRepository = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => a.join('/').toLowerCase() === b.join('/').toLowerCase()

/** A host by its name, the hosts' own SSH names read as the host they are. */
const hostName = (host: string) =>
  ({ 'ssh.github.com': 'github.com', 'altssh.gitlab.com': 'gitlab.com' })[host.toLowerCase()] ?? host.toLowerCase()

export class Fetches extends Context.Service<
  Fetches,
  {
    /** Fetches what is asked for into the repository, signed in as Althar: what it got, or why not. */
    fetch(repository: string, wanted: Wanted): Effect.Effect<Fetched, FetchRefused>
    /**
     * What each of the project's repositories here offers to run: its open
     * pull requests and its branches, asked of its remote now. With words,
     * only the open pull requests whose titles have them, searched on the
     * host, for those past the first listing; no branches, which are all
     * listed already.
     */
    offered(projectId: string, text?: string): Effect.Effect<ReadonlyArray<Offered>, unknown>
  }
>()('@althar/runtime/Fetches') {
  static readonly layer: Layer.Layer<Fetches, never, SqlClient.SqlClient | Instance | Connections | ToolServer> = Layer.effect(
    Fetches,
    Effect.gen(function* () {
      const connections = yield* Connections
      const instance = yield* Instance
      const toolServer = yield* ToolServer
      const sqlClient = yield* SqlClient.SqlClient

      /** How to reach a remote of the repository: null where it has none by that name. */
      const reachOf = (repository: string, remote: string) =>
        Effect.gen(function* () {
          const url = (yield* namedRemotes(repository).pipe(Effect.orElseSucceed(() => []))).find((one) => one.name === remote)?.url
          if (url === undefined) return null
          const signed = yield* Effect.gen(function* () {
            const found = yield* connections.hostOf([url], { fromCli: true })
            if (found === null) return null
            const repo = yield* found.host.repository(found.path)
            return { host: found.host, repository: repo, source: yield* found.host.pushTarget(repo) } satisfies Signed
          }).pipe(Effect.orElseSucceed(() => null))
          return {
            remote,
            url,
            signed,
            sources: [...(signed === null ? [] : [signed.source]), { url: remote, header: null }],
          } satisfies Reach
        })

      /** Its remote's branches, from the first way to it that answers; null where none does. */
      const headsOf = (repository: string, reach: Reach) =>
        Effect.gen(function* () {
          for (const source of reach.sources) {
            const heads = yield* remoteHeads(repository, source)
            if (heads !== null) return heads
          }
          return null
        })

      /** Fetches the first refspec that any way to the remote gives: the ref it went into, or null. */
      const fetchFirst = (repository: string, reach: Reach, specs: ReadonlyArray<{ readonly spec: string; readonly into: string }>) =>
        Effect.gen(function* () {
          for (const { spec, into } of specs)
            for (const source of reach.sources) if (yield* fetchSpecs(repository, source, [spec])) return into
          return null
        })

      const unreachable = (reach: Reach, what: string) =>
        new FetchRefused({
          message: `Althar couldn't reach ${reach.remote} (${redactUrl(reach.url)}) to fetch ${what}${reach.signed === null ? ': this computer may be offline, or git here has no sign-in for it. Connect its host in Settings, and Althar fetches with that.' : '. This computer may be offline.'}`,
        })

      /** Whether a name is one git takes for a branch or tag, never read as an option. */
      const named = (repository: string, kind: 'heads' | 'tags', name: string) =>
        Effect.gen(function* () {
          if (name === '' || name.startsWith('-') || name.startsWith('refs/')) return false
          return (yield* gitOutcome(repository, 'check-ref-format', `refs/${kind}/${name}`)).code === 0
        })

      const fetchBranch = (repository: string, name: string) =>
        Effect.gen(function* () {
          if (!(yield* named(repository, 'heads', name)))
            return yield* new FetchRefused({ message: `${name === '' ? 'That' : `“${name}”`} isn't a branch's name.` })
          const remotes = (yield* namedRemotes(repository).pipe(Effect.orElseSucceed(() => []))).map((one) => one.name)
          // A fork's branches are its own, and the ones it was forked from upstream's: origin first.
          const tried = ['origin', ...remotes.filter((one) => one !== 'origin')]
          let first: { readonly reach: Reach; readonly heads: ReadonlyArray<{ readonly name: string }> | null } | null = null
          for (const remote of tried) {
            const reach = yield* reachOf(repository, remote)
            if (reach === null) continue
            const heads = yield* headsOf(repository, reach)
            first ??= { reach, heads }
            if (heads?.some((head) => head.name === name) !== true) continue
            const into = `refs/remotes/${remote}/${name}`
            const ref = yield* fetchFirst(repository, reach, [{ spec: `+refs/heads/${name}:${into}`, into }])
            if (ref === null) return yield* unreachable(reach, name)
            return { reach, ref }
          }
          if (first === null) return yield* new FetchRefused({ message: 'The repository has no remote to fetch from.' })
          if (first.heads === null) return yield* unreachable(first.reach, name)
          const like = alike(
            name,
            first.heads.map((head) => head.name),
          )
          return yield* new FetchRefused({
            message: `${first.reach.remote} has no branch called ${name}.${like.length === 0 ? '' : ` Branches like it: ${like.join(', ')}.`}`,
          })
        })

      const fetchTag = (repository: string, name: string) =>
        Effect.gen(function* () {
          if (!(yield* named(repository, 'tags', name)))
            return yield* new FetchRefused({ message: `${name === '' ? 'That' : `“${name}”`} isn't a tag's name.` })
          const reach = yield* reachOf(repository, 'origin')
          if (reach === null) return yield* new FetchRefused({ message: 'The repository has no remote called origin to fetch from.' })
          const into = `refs/tags/${name}`
          // Not forced: a tag of the same name here that differs stays as it is.
          const ref = yield* fetchFirst(repository, reach, [{ spec: `refs/tags/${name}:${into}`, into }])
          if (ref === null)
            return yield* new FetchRefused({
              message: `Althar couldn't fetch the tag ${name} from origin: it has no such tag, a tag of that name here differs, or it couldn't be reached.`,
            })
          return { reach, ref }
        })

      /** The host's own ref for a pull request, which a fork's has too: GitHub's and GitLab's; Bitbucket keeps none to fetch. */
      const changeRefOf = (host: CodeHost | null, number: number) =>
        host === null
          ? [`refs/pull/${number}/head`, `refs/merge-requests/${number}/head`]
          : host.product === 'github'
            ? [`refs/pull/${number}/head`]
            : host.product === 'gitlab'
              ? [`refs/merge-requests/${number}/head`]
              : []

      const fetchPull = (repository: string, which: string) =>
        Effect.gen(function* () {
          const remotes = yield* namedRemotes(repository).pipe(Effect.orElseSucceed(() => []))
          // A fork's pull requests open where it was forked from.
          const remote = forkOf(remotes) === null ? 'origin' : 'upstream'
          const reach = yield* reachOf(repository, remote)
          if (reach === null) return yield* new FetchRefused({ message: `The repository has no remote called ${remote} to fetch from.` })
          const asked = which.trim()
          let number = numberOf(asked)
          if (number === null && /^https?:\/\//i.test(asked)) {
            const resolved = yield* connections.resolve(asked).pipe(Effect.orElseSucceed(() => null))
            const ref = resolved?.ref ?? parseLink(asked)
            if (ref?.kind !== 'change') return yield* new FetchRefused({ message: 'That link isn’t to a pull request.' })
            // Its host and its repository both the remote's: a link elsewhere with the same number is another change.
            const here = parseRemote(reach.url)
            if (here === null)
              return yield* new FetchRefused({
                message: `That link is to ${ref.host}, and ${remote} isn't on a code host Althar can tell. Give the pull request's number.`,
              })
            if (hostName(here.host) !== hostName(ref.host) || !sameRepository(here.path, ref.path))
              return yield* new FetchRefused({
                message: `That pull request is on ${ref.host}/${ref.path.join('/')}, not ${here.host}/${here.path.join('/')}.`,
              })
            number = ref.number
          }
          if (number === null) return yield* new FetchRefused({ message: 'Give the pull request’s number, as #12, or its link.' })
          const signed = reach.signed
          const change =
            signed === null ? null : yield* signed.host.change(signed.repository, number).pipe(Effect.orElseSucceed(() => null))
          const name = signed === null ? `PR #${number}` : `${signed.host.words.short} ${signed.host.words.prefix}${number}`
          if (signed !== null && change === null)
            return yield* new FetchRefused({
              message: `${name} isn’t on ${signed.repository.path.join('/')}, or Althar’s sign-in can’t see it.`,
            })
          // Its branch, where it is the repository's own; else, as for a fork's, the host's own ref for it.
          const own = change !== null && change.headRepository === null
          const into = `refs/althar/pull/${number}`
          const specs = [
            ...(own
              ? [
                  {
                    spec: `+refs/heads/${change.source}:refs/remotes/${remote}/${change.source}`,
                    into: `refs/remotes/${remote}/${change.source}`,
                  },
                ]
              : []),
            ...changeRefOf(signed?.host ?? null, number).map((from) => ({ spec: `+${from}:${into}`, into })),
          ]
          if (specs.length === 0)
            return yield* new FetchRefused({
              message: `${name}’s branch is on a fork, and Althar can’t fetch a fork’s pull request from this host yet.`,
            })
          const ref = yield* fetchFirst(repository, reach, specs)
          if (ref === null) {
            // Reached, with no connection to ask: it has no such pull request, as far as its refs say.
            const reached = change === null && (yield* headsOf(repository, reach)) !== null
            return yield* reached
              ? new FetchRefused({
                  message: `${remote} has no pull request #${number} Althar can fetch. Connect its host in Settings, and Althar fetches with that.`,
                })
              : unreachable(reach, name)
          }
          return {
            reach,
            ref,
            pullRequest: { number, name, title: change?.title ?? null },
            branch: change?.source ?? null,
          }
        })

      const fetch = (repository: string, wanted: Wanted): Effect.Effect<Fetched, FetchRefused> =>
        Effect.gen(function* () {
          if (wanted.kind === 'pull_request') {
            const got = yield* fetchPull(repository, wanted.which)
            return {
              commit: yield* commitOf(repository, got.ref),
              ref: got.ref,
              remote: got.reach.remote,
              branch: got.branch,
              pullRequest: got.pullRequest,
              label: got.branch === null ? got.pullRequest.name : `${got.pullRequest.name} · ${got.branch}`,
            }
          }
          const name = wanted.name.trim()
          const got = wanted.kind === 'branch' ? yield* fetchBranch(repository, name) : yield* fetchTag(repository, name)
          return {
            commit: yield* commitOf(repository, got.ref),
            ref: got.ref,
            remote: got.reach.remote,
            branch: wanted.kind === 'branch' ? name : null,
            pullRequest: null,
            label: name,
          }
        }).pipe(
          Effect.catchTag('GitFailed', () =>
            Effect.fail(new FetchRefused({ message: 'Althar fetched it, but git can’t read the commit it got. Try again.' })),
          ),
        )

      /** How many open pull requests a listing reads, newest first. */
      const LISTED = 50

      const offered = (projectId: string, text?: string) =>
        Effect.gen(function* () {
          const bindings = yield* sqlClient<{ name: string; base: string | null; repository: string }>`
            SELECT b.display_name AS name, b.default_base_ref AS base, l.path AS repository
            FROM repository_bindings b
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE b.project_id = ${projectId} AND b.detached_at IS NULL
            ORDER BY b.created_at, b.rowid`
          return yield* Effect.forEach(
            bindings,
            (binding) =>
              Effect.gen(function* () {
                const words = text?.trim() ?? ''
                const remotes = yield* namedRemotes(binding.repository).pipe(Effect.orElseSucceed(() => []))
                const origin = yield* reachOf(binding.repository, 'origin')
                const heads = origin === null ? null : words !== '' ? [] : yield* headsOf(binding.repository, origin)
                const base = binding.base ?? 'main'
                const branches = (heads ?? [])
                  .map((head) => head.name)
                  .toSorted((a, b) => (a === base ? -1 : b === base ? 1 : a.localeCompare(b)))
                // A fork's pull requests are where it was forked from.
                const signed = (forkOf(remotes) === null ? origin : yield* reachOf(binding.repository, 'upstream'))?.signed ?? null
                const listed =
                  signed === null
                    ? null
                    : yield* signed.host
                        .listChanges(signed.repository, { state: 'open', limit: LISTED, ...(words === '' ? {} : { text: words }) })
                        .pipe(Effect.orElseSucceed(() => null))
                return {
                  repository: binding.name,
                  pullRequests: (listed?.changes ?? []).map((change) => ({
                    number: change.number,
                    name: `${signed?.host.words.short ?? 'PR'} ${signed?.host.words.prefix ?? '#'}${change.number}`,
                    title: change.title,
                    branch: change.source,
                    author: change.author?.login ?? null,
                    draft: change.draft,
                    fork: change.forkOwner !== null || (change.headRepository !== undefined && change.headRepository !== null),
                  })),
                  branches,
                  note:
                    heads === null
                      ? `Althar couldn't reach ${binding.name}'s remote: this computer may be offline, or its host isn't connected.`
                      : listed === null
                        ? 'Connect its host in Settings to see its pull requests here. A number, as #12, runs one still.'
                        : null,
                  more: listed?.more ?? false,
                } satisfies Offered
              }),
            { concurrency: 4 },
          )
        })

      /* ---- What a lead can ask for ---- */

      const Asked = Schema.Struct({
        branch: Schema.optional(Schema.String),
        tag: Schema.optional(Schema.String),
        pull_request: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
        repository: Schema.optional(Schema.String),
      })

      const fetchTool: Tool = {
        name: 'fetch_from_remote',
        description:
          "Fetches a branch, a tag or a pull request from the code host into your repository, as Althar, with its own sign-in: you carry none, so `git fetch` and `git pull` that need one fail in your worktree, sandboxed or not. Give one of branch (its name on the remote), tag, or pull_request (its number or link). A branch lands at origin/<branch>, current, as `git fetch` would put it; a pull request's own branch there too, and a fork's at refs/althar/pull/<number>. It says the commit it got. Nothing is pushed, and no branch of yours moves: check it out or merge it yourself. In a task of several repositories, say which, as repository.",
        input: {
          type: 'object',
          properties: {
            branch: { type: 'string', description: 'A branch on the remote, such as feature/find-a-pro.' },
            tag: { type: 'string' },
            pull_request: { type: ['string', 'integer'], description: 'Its number, as 12 or #12, or its link.' },
            repository: { type: 'string' },
          },
        },
        call: (input, access) =>
          Effect.gen(function* () {
            if (access.taskId === null) return yield* new ToolRefused({ message: 'This tool is for a task’s lead.' })
            const asked = yield* Schema.decodeUnknownEffect(Asked)(input).pipe(
              Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
            )
            const wanted: ReadonlyArray<Wanted> = [
              ...(asked.branch === undefined ? [] : [{ kind: 'branch' as const, name: asked.branch }]),
              ...(asked.tag === undefined ? [] : [{ kind: 'tag' as const, name: asked.tag }]),
              ...(asked.pull_request === undefined ? [] : [{ kind: 'pull_request' as const, which: String(asked.pull_request) }]),
            ]
            const [one] = wanted
            if (one === undefined || wanted.length > 1)
              return yield* new ToolRefused({ message: 'Give one of branch, tag or pull_request.' })
            // Into the person's repository, which the worktree shares its refs with: Althar's git never runs in the lead's.
            const places = yield* sqlClient<{ name: string; slug: string; repository: string }>`
              SELECT b.display_name AS name, b.slug, l.path AS repository
              FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
              JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
              WHERE w.task_id = ${access.taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write'
              ORDER BY b.created_at, b.rowid`.pipe(Effect.orElseSucceed(() => []))
            const wantedName = asked.repository?.trim().toLowerCase()
            const chosen =
              wantedName === undefined
                ? places
                : places.filter((place) => place.name.toLowerCase() === wantedName || place.slug === wantedName)
            const [place] = chosen
            if (place === undefined)
              return yield* new ToolRefused({
                message:
                  places.length === 0
                    ? 'Your task has no repository here to fetch into.'
                    : `There's no repository called ${asked.repository} in the task. Its repositories: ${places.map((one) => one.name).join(', ')}.`,
              })
            if (chosen.length > 1)
              return yield* new ToolRefused({
                message: `Say which repository, as repository: ${places.map((one) => one.name).join(', ')}.`,
              })
            const got = yield* fetch(place.repository, one).pipe(
              Effect.mapError((refused) => new ToolRefused({ message: refused.message })),
            )
            const subject = yield* git(place.repository, 'log', '-1', '--format=%s', got.commit).pipe(Effect.orElseSucceed(() => ''))
            const short = got.commit.slice(0, 12)
            const at = got.ref.replace(/^refs\/remotes\//, '').replace(/^refs\/tags\//, '')
            const what =
              got.pullRequest === null
                ? got.label
                : `${got.pullRequest.name}${got.pullRequest.title === null ? '' : ` (${got.pullRequest.title})`}`
            const switching =
              got.ref.startsWith('refs/remotes/') && got.branch !== null
                ? `To work on it: \`git switch -c ${got.branch} ${at} --no-track\`.`
                : `To look at it: \`git switch --detach ${short}\`.`
            return `Fetched ${what} from ${got.remote}: ${at} is at ${short}${subject === '' ? '' : ` (${subject})`}. ${switching}`
          }),
      }

      yield* toolServer.serve('lead', [fetchTool])

      return Fetches.of({
        fetch,
        offered: (projectId, text) => offered(projectId, text),
      })
    }),
  )
}
