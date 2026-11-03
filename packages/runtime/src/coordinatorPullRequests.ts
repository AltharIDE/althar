import { type CodeHost, ConnectorFailed, fromOutside, parseRemote, type Repository } from '@althar/connectors'
import { Effect, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { hostName, logForLead, readLog } from './checkLogs'
import { Connections } from './Connections'
import { checksOf, nameOf, signed } from './pullRequestWords'
import { ToolRefused } from './ToolServer'

/*
 * What the coordinator does on the code host to the project's pull requests
 * (ADR-081): run a failed check again, read the default branch's checks,
 * mark a pull request ready, close and reopen one, and reply on one. Each
 * works on any of the project's pull requests, whoever opened them, within
 * the kind the ADR gives it:
 *
 * - run again, read: any pull request, and the default branch;
 * - mark ready, close, reopen: Althar's own, the ones a task opened;
 * - bring up to date: any pull request, a merge of the default branch into
 *   its branch, never a rebase and never forced;
 * - reply: Althar's own, the connected account's, and the repository's own
 *   people's. An outside author's, and closing on Bitbucket Cloud (where
 *   declining is final), are *asked-for*: they wait for the person's word,
 *   which is another task's (ADR-081, "The person's word"). Until that is
 *   on main they are refused here, with a line for the person.
 *
 * Every call reads the pull request from its host first, so a stale picture
 * of it is never acted on, and each leaves it where it can be undone in a
 * step. A host that can't is refused in its own words (ADR-082), never a
 * quiet no-op.
 */

const refused = (message: string) => new ToolRefused({ message })

/** A host's failure said to the coordinator, in the host's words. */
export const hostSays = (error: ConnectorFailed) =>
  refused(
    error.reason === 'not_found'
      ? 'That is not there, or Althar’s sign-in can’t see it.'
      : error.reason === 'forbidden' && error.scope !== undefined
        ? `The code host refused: ${error.message}. Althar’s connection lacks ${error.scope}; the person gives it that in Settings.`
        : `The code host said: ${error.message}`,
  )

export const viaHost = <A, R>(effect: Effect.Effect<A, ConnectorFailed, R>) => Effect.mapError(effect, hostSays)

const decodeRemotes = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))

/** The project's repositories that are on a code host Althar is connected to, and all its repositories' names. */
const hostedOf = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const connections = yield* Connections
    const bindings = yield* sql<{ name: string; remotes: string }>`
      SELECT display_name AS name, remote_fingerprints AS remotes FROM repository_bindings
      WHERE project_id = ${projectId} AND detached_at IS NULL ORDER BY created_at, rowid`
    const found = yield* Effect.forEach(bindings, (binding) =>
      Effect.map(connections.hostOf(Option.getOrElse(decodeRemotes(binding.remotes), () => [])), (host) =>
        host === null ? [] : [{ ...host, name: binding.name }],
      ),
    )
    return { bindings, hosted: found.flat() }
  })

/**
 * Which pull request a link or a number names. By its link, the project's
 * repository whose remotes name it; by its number, the project's one
 * repository on a connected host.
 */
const placeOf = (projectId: string, asked: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const { bindings, hosted } = yield* hostedOf(projectId)
    const wanted = asked.trim()
    if (/^https?:\/\//i.test(wanted)) {
      const found = yield* connections.resolve(wanted)
      if (found === null)
        return yield* refused('Althar isn’t connected to where that link points. The person connects its host in Settings.')
      if (found.ref.kind !== 'change' || found.host === undefined) return yield* refused('That link isn’t a pull request.')
      const ref = found.ref
      const same = (path: ReadonlyArray<string>) => path.join('/').toLowerCase() === ref.path.join('/').toLowerCase()
      const inProject = bindings.some((binding) =>
        Option.getOrElse(decodeRemotes(binding.remotes), () => []).some((remote) => {
          const place = parseRemote(remote)
          return place !== null && place.host === ref.host && same(place.path)
        }),
      )
      if (!inProject) return yield* refused(`That pull request is on ${ref.path.join('/')}, which isn’t one of the project’s repositories.`)
      const repository = yield* viaHost(found.host.repository(ref.path))
      return { host: found.host, repository, number: ref.number }
    }
    const number = /^#?(\d+)$/.exec(wanted)?.[1]
    if (number === undefined) return yield* refused('Give the pull request’s link, or its number: #123.')
    const [only, ...more] = hosted
    if (only === undefined)
      return yield* refused('The project’s repository isn’t on a host Althar is connected to. The person connects it in Settings.')
    if (more.length > 0)
      return yield* refused(
        `Several of the project’s repositories are on a connected host (${hosted.map((one) => one.name).join(', ')}): give the pull request’s link.`,
      )
    const repository = yield* viaHost(only.host.repository(only.path))
    return { host: only.host, repository, number: Number(number) }
  })

/** The project's repository named, or its only one on a connected host. */
export const repositoryOf = (projectId: string, named: string | null | undefined) =>
  Effect.gen(function* () {
    const { hosted } = yield* hostedOf(projectId)
    const wanted = named?.trim().toLowerCase()
    const matching =
      wanted === undefined || wanted === ''
        ? hosted
        : hosted.filter((one) => one.name.toLowerCase() === wanted || one.path.join('/').toLowerCase() === wanted)
    const [one, ...more] = matching
    if (one === undefined)
      return yield* refused(
        hosted.length === 0
          ? 'The project’s repository isn’t on a host Althar is connected to. The person connects it in Settings.'
          : `The project’s repositories are ${hosted.map((entry) => entry.name).join(', ')}. Name one of those.`,
      )
    if (more.length > 0)
      return yield* refused(
        `The project has several repositories on a connected host (${hosted.map((entry) => entry.name).join(', ')}): name one.`,
      )
    return { host: one.host, repository: yield* viaHost(one.host.repository(one.path)) }
  })

/** Whether a task of the project opened this pull request (not one it was attached to, which the person opened). */
const openedByAltharOf = (projectId: string, url: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ attached: number | null }>`
      SELECT json_extract(snapshot, '$.attached') AS attached FROM external_links
      WHERE project_id = ${projectId} AND kind = 'change' AND lower(url) = ${url.toLowerCase()}`
    return rows.some((row) => row.attached !== 1)
  })

/** A pull request as its host has it now, and whether Althar opened it. */
const readOne = (projectId: string, asked: string) =>
  Effect.gen(function* () {
    if (asked.trim() === '') return yield* refused('Say which pull request: its link, or its number (#123).')
    const place = yield* placeOf(projectId, asked)
    const change = yield* viaHost(place.host.change(place.repository, place.number))
    const own = yield* openedByAltharOf(projectId, change.url)
    return { ...place, change, own, name: nameOf({ number: change.number, words: place.host.words }) }
  })

/**
 * What can't be undone, or reaches someone outside, waits for the person's
 * word. Said to the coordinator so that it tells them instead.
 *
 * TODO(the-person-s-word-errands-receipts-who-sent-it): once that task puts
 * an asked-for kind on tools, run in a turn the person's message started,
 * these go ahead on their word instead of being refused. Until then there
 * is no telling their turn from news, and no second mechanism is built here.
 */
const askedFor = (what: string, name: string, url: string) =>
  refused(
    `${what} on ${name} waits for the person’s word, which Althar can’t yet tell from news, so it isn’t done from here. Tell the person what you would do and why; they can do it on the host: ${url}`,
  )

const notOurs = (name: string, what: string) =>
  refused(`${name} isn’t one Althar opened, so ${what} it is the person’s call. Tell them what you would do and why.`)

// ---- Running checks again ---------------------------------------------------

const RerunAsked = Schema.Struct({
  pull_request: Schema.optional(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
  repository: Schema.optional(Schema.NullOr(Schema.String)),
  check: Schema.optional(Schema.NullOr(Schema.String)),
})

/** Why a check can't be run again from here, where the host says false of it. */
const whyNot = (host: CodeHost): string =>
  host.product === 'github'
    ? 'only a GitHub Actions job runs again from Althar, and it comes from another service'
    : host.product === 'gitlab'
      ? "only a pipeline's job runs again from Althar, and it isn't one"
      : host.product === 'bitbucket_cloud'
        ? 'only a Bitbucket pipeline runs again from Althar, and it isn’t one'
        : `${hostName(host)}'s builds are another service's`

/**
 * Runs the failed checks of a pull request, or of the default branch's
 * latest commit, once more: the one named, or each that failed. A check the
 * host can't run again from here is said so, with its page.
 */
export const rerunChecks = (projectId: string, input: unknown) =>
  Effect.gen(function* () {
    const asked = yield* Schema.decodeUnknownEffect(RerunAsked)(input).pipe(
      Effect.mapError((error) => refused(`Althar couldn't read that: ${error.message}`)),
    )
    const target =
      asked.pull_request == null || String(asked.pull_request).trim() === ''
        ? yield* Effect.map(repositoryOf(projectId, asked.repository), (found) => ({
            ...found,
            ref: found.repository.defaultBranch,
            name: found.repository.defaultBranch,
          }))
        : yield* Effect.gen(function* () {
            const found = yield* readOne(projectId, String(asked.pull_request))
            if (found.change.state !== 'open')
              return yield* refused(`${found.name} is ${found.change.state}, so its checks don't run again.`)
            if (found.change.headSha === null) return yield* refused(`${found.name} has no commits, so no checks.`)
            return { host: found.host, repository: found.repository, ref: found.change.headSha, name: found.name }
          })
    const { host, repository, ref, name } = target
    const all = yield* viaHost(host.checks(repository, ref))
    const wanted = asked.check?.trim().toLowerCase()
    const one = wanted === undefined || wanted === '' ? undefined : all.find((check) => check.name.toLowerCase() === wanted)
    if (wanted !== undefined && wanted !== '' && one === undefined)
      return yield* refused(
        `${name} has no check called "${asked.check}". Its checks: ${all.length === 0 ? 'none' : all.map((check) => check.name).join(', ')}.`,
      )
    if (one !== undefined && (one.state === 'queued' || one.state === 'running'))
      return `${one.name} on ${name} is still ${one.state === 'queued' ? 'waiting to run' : 'running'}, so there's nothing to run again yet.`
    const targets = one === undefined ? all.filter((check) => check.state === 'failed') : [one]
    if (targets.length === 0)
      return `None of ${name}'s checks failed${all.some((check) => check.state === 'queued' || check.state === 'running') ? ', and some still run' : ''}, so there's nothing to run again. Name one with check to run it again all the same.`
    const tried = yield* Effect.forEach(targets, (check) =>
      host.rerun(repository, check).pipe(
        Effect.map((again) => ({ check, again, said: null as string | null })),
        Effect.catch((error: ConnectorFailed) => Effect.succeed({ check, again: false, said: error.message })),
      ),
    )
    const again = tried.filter((result) => result.again).map((result) => result.check.name)
    const elsewhere = tried.filter((result) => !result.again && result.said === null)
    const declined = tried.filter((result) => result.said !== null)
    return [
      ...(again.length === 0
        ? []
        : [
            `Running ${again.join(', ')} on ${name} again${host.product === 'bitbucket_cloud' ? ' (the whole pipeline, on the same commit)' : ''}. read_pull_request or read_checks shows how ${again.length === 1 ? 'it goes' : 'they go'}.`,
          ]),
      ...elsewhere.map(
        ({ check }) =>
          `${check.name} can't be run again here: ${whyNot(host)}. ${check.url === null ? 'The person runs it again where it ran.' : `The person can run it again from its page: ${check.url}`}`,
      ),
      ...declined.map(({ check, said }) => `${hostName(host)} would not run ${check.name} again: ${said}`),
    ].join('\n\n')
  })

// ---- The default branch's checks -------------------------------------------

const BaseAsked = Schema.Struct({ repository: Schema.optional(Schema.NullOr(Schema.String)) })

const LOGS = 2

/**
 * The checks on the latest commit of a repository's default branch, with the
 * end of the logs of the first that failed: to tell a failure that is a
 * change's from one that is broken already.
 */
export const readDefaultBranchChecks = (projectId: string, input: unknown) =>
  Effect.gen(function* () {
    const asked = yield* Schema.decodeUnknownEffect(BaseAsked)(input).pipe(
      Effect.mapError((error) => refused(`Althar couldn't read that: ${error.message}`)),
    )
    const { host, repository } = yield* repositoryOf(projectId, asked.repository)
    const base = repository.defaultBranch
    const all = yield* viaHost(host.checks(repository, base))
    const sum = checksOf(base, all)
    const logs = yield* Effect.forEach(all.filter((check) => check.state === 'failed').slice(0, LOGS), (check) =>
      Effect.map(readLog(host, repository, check), logForLead),
    )
    return [
      `The checks on ${repository.path.join('/')}'s ${base}, its latest commit: ${
        sum.total === 0
          ? `none have run. Some repositories run their checks on pull requests only, so this says nothing of whether ${base} is broken.`
          : `${sum.passed} passed, ${sum.failed} failed, ${sum.running} running.`
      }`,
      ...(sum.total === 0
        ? []
        : [sum.list.map((check) => `- ${check.name}: ${check.state}${check.summary === null ? '' : ` (${check.summary})`}`).join('\n')]),
      ...logs,
    ].join('\n\n')
  })

// ---- Marking ready, closing and reopening -----------------------------------

const PullAsked = Schema.Struct({ pull_request: Schema.Union([Schema.Number, Schema.String]) })

const decodePull = (input: unknown) =>
  Schema.decodeUnknownEffect(PullAsked)(input).pipe(
    Effect.map((asked) => String(asked.pull_request)),
    Effect.mapError((error) => refused(`Althar couldn't read that: ${error.message}`)),
  )

/** Marks one of Althar's pull requests ready for review. It can go back to a draft on the host. */
export const markReady = (projectId: string, input: unknown) =>
  Effect.gen(function* () {
    const { host, repository, change, name, own } = yield* readOne(projectId, yield* decodePull(input))
    if (!own) return yield* notOurs(name, 'marking')
    if (change.state !== 'open') return yield* refused(`${name} is ${change.state}, so it can't be marked ready.`)
    if (!change.draft) return `${name} is ready for review already.`
    if (!host.capabilities.drafts) return yield* refused(`${hostName(host)} has no drafts, so there's nothing to mark ready on ${name}.`)
    const ready = yield* viaHost(host.markReady(repository, change))
    return ready.draft
      ? `${name} is still a draft: ${hostName(host)} didn't mark it ready. The person marks it from ${change.url}.`
      : `${name} is ready for review. It can go back to a draft on ${hostName(host)} if that was a mistake.`
  })

/** Closes one of Althar's pull requests unmerged. On Bitbucket Cloud declining is final, so there it waits for the person. */
export const closePullRequest = (projectId: string, input: unknown) =>
  Effect.gen(function* () {
    const { host, repository, change, name, own } = yield* readOne(projectId, yield* decodePull(input))
    if (!own) return yield* notOurs(name, 'closing')
    if (change.state !== 'open') return `${name} is ${change.state} already.`
    // Declining can't be taken back where the host can't reopen (Bitbucket Cloud): asked-for.
    if (!host.capabilities.reopen) return yield* askedFor('Declining', name, change.url)
    const closed = yield* viaHost(host.closeChange(repository, change))
    return closed.state === 'closed'
      ? `${name} is closed, unmerged. reopen_pull_request opens it again.`
      : `${name} is ${closed.state} now, so it wasn't closed.`
  })

/** Opens one of Althar's closed pull requests again, where the host can; else it says so in the host's own words. */
export const reopenPullRequest = (projectId: string, input: unknown) =>
  Effect.gen(function* () {
    const { host, repository, change, name, own } = yield* readOne(projectId, yield* decodePull(input))
    if (!own) return yield* notOurs(name, 'reopening')
    if (change.state === 'open') return `${name} is open already.`
    const opened = yield* viaHost(host.reopenChange(repository, change))
    return `${name} is open again.${opened.draft ? ' It is a draft.' : ''}`
  })

// ---- Bringing a branch up to date -------------------------------------------

/**
 * What to say to an outside author who can be asked to update their own
 * branch, for the coordinator to offer the person. Posting it is a reply on
 * an outside author's pull request, which waits for the person's word.
 */
const askAuthor = (target: string) =>
  `Could you bring this branch up to date with ${target}? It has fallen behind, and Althar's account can't push to your fork. Thank you!`

/**
 * Merges a pull request's target branch into its branch on the host (ADR-081),
 * at the head just read: GitHub's update-branch, and elsewhere a merge in a
 * copy of Althar's own, pushed plainly. A merge commit, never a rebase, never
 * a forced push, so it can be undone by the branch's author resetting to its
 * old head. A conflict stops and names the files, and Althar settles none. On
 * a fork's branch the account can't push to, nothing is done and the answer
 * says the author can be asked, which is a reply and waits for the person's
 * word. Shared by the coordinator's `update_branch` and, once row 15 gives
 * leads the call, theirs.
 */
export const updateBranch = (projectId: string, input: unknown) =>
  Effect.gen(function* () {
    const { host, repository, change, name } = yield* readOne(projectId, yield* decodePull(input))
    if (change.state !== 'open') return yield* refused(`${name} is ${change.state}, so its branch isn't brought up to date.`)
    if (change.headSha === null) return yield* refused(`${name} has no commits to bring up to date.`)
    const result = yield* viaHost(host.updateBranch(repository, change, { expectedHead: change.headSha }))
    const target = change.target
    switch (result.outcome) {
      case 'updated':
        return result.head === null
          ? `${hostName(host)} is merging ${target} into ${name}'s branch. Its checks run again on the result; read_pull_request shows how it goes.`
          : `Merged ${target} into ${name}'s branch, now at ${result.head.slice(0, 12)}. Its checks run again on the result. It is a merge commit, nothing rebased or forced.`
      case 'current':
        return `${name}'s branch has all of ${target} already, so there was nothing to merge.`
      case 'conflict':
        return `${name}'s branch conflicts with ${target}, so nothing was merged. ${
          result.files.length === 0 ? `${hostName(host)} didn't say in which files.` : `It conflicts in ${result.files.join(', ')}.`
        } Althar doesn't settle conflicts here: it is a task's lead that merges ${target} in and resolves them, or the author.`
      case 'moved':
        return `${name}'s branch moved on since it was read${result.head === null ? '' : ` (now at ${result.head.slice(0, 12)})`}, so nothing was merged, to leave that push as it is. Read it again with read_pull_request and call this again if it is still behind.`
      case 'no_access':
        return `Althar's account can't push to ${name}'s branch, so it wasn't updated: ${result.reason} The author can bring it up to date. Asking them is a reply on an outside author's pull request, which waits for the person's word: tell the person, with something like “${askAuthor(target)}”`
    }
  })

// ---- Replying -------------------------------------------------------------

const ReplyAsked = Schema.Struct({
  pull_request: Schema.Union([Schema.Number, Schema.String]),
  body: Schema.String,
  thread_id: Schema.optional(Schema.NullOr(Schema.String)),
})

/**
 * Whether a pull request's author is one of the repository's own people: the
 * connected account, or, where the host says (GitHub), a member. Elsewhere
 * that isn't known, and an author not known to be is an outside one.
 */
const authoredByOwn = (host: CodeHost, repository: Repository, number: number, author: { readonly id: string } | null) =>
  Effect.gen(function* () {
    const account = yield* host.account.pipe(Effect.orElseSucceed(() => null))
    if (author !== null && account?.id === author.id) return true
    if (!host.capabilities.reviews) return false
    return yield* host.changeToReview(repository, number).pipe(
      Effect.map((pull) => !fromOutside(pull)),
      Effect.orElseSucceed(() => false),
    )
  })

/**
 * Replies on a pull request, in a line comment's thread or its conversation,
 * signed as from Althar: on one Althar opened, or whose author is the
 * connected account or one of the repository's people. A reply to an outside
 * author notifies them for good, so that one waits for the person.
 */
export const replyOnPullRequest = (projectId: string, input: unknown, by: string | null) =>
  Effect.gen(function* () {
    const asked = yield* Schema.decodeUnknownEffect(ReplyAsked)(input).pipe(
      Effect.mapError((error) => refused(`Althar couldn't read that: ${error.message}`)),
    )
    if (asked.body.trim() === '') return yield* refused('Say what to reply.')
    const { host, repository, change, name, own } = yield* readOne(projectId, String(asked.pull_request))
    if (!own && !(yield* authoredByOwn(host, repository, change.number, change.author)))
      return yield* askedFor('A reply', `${name}, an outside author’s`, change.url)
    const comment = yield* viaHost(
      host.reply(repository, change.number, { body: signed(asked.body, by), threadId: asked.thread_id ?? null }),
    )
    return `Replied on ${name}${comment.url === null ? '' : `: ${comment.url}`}.`
  })
