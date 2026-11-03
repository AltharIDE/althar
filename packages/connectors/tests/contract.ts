import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { type ChangeRequest, type CodeHost, fromOutside, type Tracker } from '../src/model'
import type { Run } from '../src/releases'

/*
 * The models' contracts (docs/architecture/06), written once and run against
 * the fake in CI and against real accounts on demand. A code host opens a
 * change from a branch the subject prepares, finds it again rather than
 * opening a second, reads it back, marks it ready, and hears a reply; where
 * it takes reviews, reads it as a change to review and posts one on it. A
 * tracker reads an issue it is given, lists the account's, and comments.
 */

export interface HostSubject {
  readonly name: string
  readonly host: CodeHost
  /** A repository the account can push to and open changes on. */
  readonly path: ReadonlyArray<string>
  /** Prepares a branch with a commit the default branch hasn't, and gives its name. */
  readonly branch: Effect.Effect<string, unknown>
  /** Closes what the contract opened, on a real service. */
  readonly cleanup?: (change: ChangeRequest) => Effect.Effect<void, unknown>
}

export const hostContract = (subject: HostSubject) =>
  describe(`${subject.name}, as a code host`, () => {
    it.live('says who it signs in as, and finds the repository', () =>
      Effect.gen(function* () {
        const account = yield* subject.host.account
        assert.isNotEmpty(account.login)
        const repository = yield* subject.host.repository(subject.path)
        assert.deepStrictEqual([...repository.path], [...subject.path])
        assert.isNotEmpty(repository.defaultBranch)
        assert.isTrue(repository.canPush)
        const target = yield* subject.host.pushTarget(repository)
        assert.isNotEmpty(target.url)
      }),
    )

    it.live('opens a change once, however often it is asked, and hears what is said on it', () =>
      Effect.gen(function* () {
        const { host } = subject
        const repository = yield* host.repository(subject.path)
        const source = yield* subject.branch
        assert.isNull(yield* host.findChange(repository, source))
        const request = {
          title: 'Althar contract',
          body: 'Opened by the connectors contract.',
          source,
          target: repository.defaultBranch,
          draft: true,
        }
        const opened = yield* host.openChange(repository, request)
        try {
          assert.strictEqual(opened.state, 'open')
          assert.strictEqual(opened.source, source)
          if (host.capabilities.drafts) assert.isTrue(opened.draft)
          const again = yield* host.openChange(repository, request)
          assert.strictEqual(again.number, opened.number, 'a second open adopts the first')
          assert.strictEqual((yield* host.findChange(repository, source))?.number, opened.number)
          const read = yield* host.change(repository, opened.number)
          assert.strictEqual(read.title, 'Althar contract')
          if (host.capabilities.drafts) assert.isFalse((yield* host.markReady(repository, read)).draft)
          const before = yield* host.activity(repository, opened.number, null)
          const reply = yield* host.reply(repository, opened.number, { body: 'A reply from the contract.', threadId: null })
          assert.strictEqual(reply.body, 'A reply from the contract.')
          const after = yield* host.activity(repository, opened.number, before.cursor === '' ? null : before.cursor)
          assert.isTrue(after.comments.some((comment) => comment.id === reply.id))
          assert.isTrue(after.cursor >= before.cursor)
          const head = (yield* host.change(repository, opened.number)).headSha
          if (head !== null) assert.isArray(yield* host.checks(repository, head))
          // Where the host takes reviews: the change read as one to review is the account's own, from inside; a comment posts.
          if (host.capabilities.reviews) {
            const toReview = yield* host.changeToReview(repository, opened.number)
            assert.strictEqual(toReview.number, opened.number)
            assert.isFalse(fromOutside(toReview))
            const posted = yield* host.postReview(repository, opened.number, {
              event: 'comment',
              body: 'A review from the contract.',
              commit: toReview.headSha,
              comments: [],
            })
            assert.isNotEmpty(posted.id)
          }
          // Where the host takes pictures: one uploads, and Althar's own comment is written anew to show it.
          if (host.capabilities.pictures && host.uploadPicture !== undefined && host.editComment !== undefined) {
            const url = yield* host.uploadPicture(repository, { bytes: ONE_PIXEL, name: 'contract.png', mediaType: 'image/png' })
            assert.match(url, /^https:\/\//)
            const edited = yield* host.editComment(
              repository,
              opened.number,
              reply.id,
              `A picture from the contract.\n\n![contract](${url})`,
            )
            assert.strictEqual(edited.id, reply.id)
            assert.include(edited.body, url)
          }
        } finally {
          if (subject.cleanup !== undefined) yield* Effect.ignore(subject.cleanup(opened))
        }
      }),
    )
  })

export interface MergeSubject {
  readonly name: string
  readonly host: CodeHost
  /** A repository the account can merge into. */
  readonly path: ReadonlyArray<string>
  /** Opens a change into the default branch, ready to merge, and gives its number. */
  readonly ready: Effect.Effect<number, unknown>
}

/*
 * Merging, as the coordinator's merge line asks a host (ADR-081): how a
 * branch merges there, where it is, whether a change has its head, and a
 * merge only at the head it was given: through the host's queue or train,
 * with auto-merge, or plainly, and taken out of a queue again. Each host's
 * fake runs these in CI; a real account's, when the person proves that host.
 */
export const mergeContract = (subject: MergeSubject) =>
  describe(`${subject.name}, merging`, () => {
    it.live('says how a branch merges, where it is, and whether a change has its head', () =>
      Effect.gen(function* () {
        const { host } = subject
        const repository = yield* host.repository(subject.path)
        const ways = yield* host.mergeWays(repository, repository.defaultBranch)
        assert.include([null, 'merge_queue', 'merge_train'], ways.queue)
        const head = yield* host.branchHead(repository, repository.defaultBranch)
        assert.isNotEmpty(head)
        const change = yield* host.change(repository, yield* subject.ready)
        assert.isTrue(yield* host.contains(repository, change, head), 'a change opened from the default branch has its head')
      }),
    )

    it.live('merges only at the head it was given, in the way it says, and takes one out of the queue again', () =>
      Effect.gen(function* () {
        const { host } = subject
        const repository = yield* host.repository(subject.path)
        const ways = yield* host.mergeWays(repository, repository.defaultBranch)
        const before = yield* host.branchHead(repository, repository.defaultBranch)
        const change = yield* host.change(repository, yield* subject.ready)
        const stale = yield* Effect.flip(host.merge(repository, { ...change, headSha: 'a-head-nobody-saw' }))
        assert.strictEqual(stale.reason, 'rejected', 'a head that moved is refused')
        const method = repository.merges.at(-1)
        if (ways.queue !== null) {
          const late = yield* Effect.flip(host.enqueue(repository, { ...change, headSha: 'a-head-nobody-saw' }))
          assert.strictEqual(late.reason, 'rejected', 'queued only at the head it was given')
          const queued = yield* host.enqueue(repository, change)
          assert.deepInclude(queued, { state: 'open', queued: true })
          const out = yield* host.leaveQueue(repository, queued)
          assert.notStrictEqual(out.queued, true)
          return
        }
        if (ways.autoMerge) {
          const auto = yield* host.merge(repository, change, { auto: true, ...(method === undefined ? {} : { method }) })
          assert.deepInclude(auto, { state: 'open', autoMerge: true })
          assert.isFalse((yield* host.leaveQueue(repository, auto)).autoMerge ?? false)
        } else assert.strictEqual((yield* Effect.flip(host.merge(repository, change, { auto: true }))).reason, 'rejected')
        const merged = yield* host.merge(repository, change, method === undefined ? {} : { method })
        // A merge that takes long lands later: it is done only once a read shows it.
        if (merged.state === 'merged') {
          const after = yield* host.branchHead(repository, repository.defaultBranch)
          assert.notStrictEqual(after, before, 'the target moves on to the merge')
          const next = yield* host.change(repository, yield* subject.ready)
          assert.isTrue(yield* host.contains(repository, next, after))
        } else assert.strictEqual(merged.state, 'open')
      }),
    )
  })

/**
 * What CI and people do on the host around a release, for the release
 * contract: on a fake, its controls; on a real service, a scratch
 * repository's own CI. Never run on a repository whose tags and releases
 * reach anyone: it pushes tags and publishes.
 */
export interface ReleaseSubject {
  readonly name: string
  readonly host: CodeHost
  /** A scratch repository the account can push tags to. */
  readonly path: ReadonlyArray<string>
  /** A commit there that isn't the default branch's head, to move a tag to. */
  readonly otherCommit: string
  /** A tag name not used before. */
  readonly tagName: Effect.Effect<string>
  /** CI starts a run on the tag that waits on two gates: one the account may give, and one it may not. */
  readonly startRun: (tag: string) => Effect.Effect<void, unknown>
  /** CI drafts the tag's release, where the host drafts them. */
  readonly draft: (tag: string) => Effect.Effect<void, unknown>
  /** CI starts a run on the tag that has failed. */
  readonly failedRun: (tag: string) => Effect.Effect<void, unknown>
}

export const releaseContract = (subject: ReleaseSubject) =>
  describe(`${subject.name}, releasing`, () => {
    it.live('tags the default branch’s head once, refuses a tag that exists unless moving it was asked for, and deletes it', () =>
      Effect.gen(function* () {
        const { host } = subject
        const repository = yield* host.repository(subject.path)
        const name = yield* subject.tagName
        const head = yield* host.commitOf(repository, repository.defaultBranch)
        assert.isNull(yield* host.tag(repository, name))
        const made = yield* host.pushTag(repository, { name, commit: head })
        assert.deepInclude(made, { name, commit: head })
        assert.strictEqual((yield* host.tag(repository, name))?.commit, head)
        assert.strictEqual(yield* host.commitOf(repository, name), head, 'a tag is a ref the host resolves')
        // Asked again for the same commit, it is there already: nothing to do.
        assert.strictEqual((yield* host.pushTag(repository, { name, commit: head })).commit, head)
        // On another commit, it is taken: refused, and left where it was.
        const taken = yield* Effect.flip(host.pushTag(repository, { name, commit: subject.otherCommit }))
        assert.strictEqual(taken.reason, 'rejected')
        assert.include(taken.message, 'Moving a tag must be asked for')
        assert.strictEqual((yield* host.tag(repository, name))?.commit, head)
        const moved = yield* host.pushTag(repository, { name, commit: subject.otherCommit, move: true })
        assert.strictEqual(moved.commit, subject.otherCommit)
        assert.strictEqual((yield* host.tag(repository, name))?.commit, subject.otherCommit)
        yield* host.deleteTag(repository, name)
        assert.isNull(yield* host.tag(repository, name))
        yield* host.deleteTag(repository, name)
      }),
    )

    it.live('publishes a release as the host does, once', () =>
      Effect.gen(function* () {
        const { host } = subject
        const repository = yield* host.repository(subject.path)
        const name = yield* subject.tagName
        yield* host.pushTag(repository, { name, commit: yield* host.commitOf(repository, repository.defaultBranch) })
        const files = [{ name: `althar-${name}.dmg`, bytes: new Uint8Array([1, 2, 3]), mediaType: 'application/octet-stream' }]
        switch (host.releasing) {
          case 'draft': {
            // Nothing to publish before CI drafts it.
            assert.strictEqual((yield* Effect.flip(host.publishRelease(repository, name, {}))).reason, 'not_found')
            yield* subject.draft(name)
            assert.strictEqual((yield* host.release(repository, name))?.state, 'draft')
            assert.strictEqual((yield* host.publishRelease(repository, name, {})).state, 'published')
            assert.strictEqual((yield* host.release(repository, name))?.state, 'published')
            assert.strictEqual((yield* host.publishRelease(repository, name, {})).state, 'published')
            break
          }
          case 'made': {
            // No drafts: making the release is publishing it.
            assert.isNull(yield* host.release(repository, name))
            const made = yield* host.publishRelease(repository, name, { name: `Althar ${name}`, notes: 'New: releases.' })
            assert.deepInclude(made, { tag: name, state: 'published' })
            assert.strictEqual((yield* host.publishRelease(repository, name, {})).id, made.id)
            break
          }
          case 'downloads': {
            assert.strictEqual((yield* host.release(repository, name))?.state, 'tagged')
            assert.strictEqual((yield* Effect.flip(host.publishRelease(repository, name, {}))).reason, 'rejected')
            const out = yield* host.publishRelease(repository, name, { files })
            assert.lengthOf(
              out.files.filter((file) => file.name === files[0]?.name),
              1,
            )
            const again = yield* host.publishRelease(repository, name, { files })
            assert.lengthOf(
              again.files.filter((file) => file.name === files[0]?.name),
              1,
              'a file in Downloads already is not put there twice',
            )
            break
          }
          case 'tag': {
            assert.strictEqual((yield* host.release(repository, name))?.state, 'tagged')
            const none = yield* Effect.flip(host.publishRelease(repository, name, { files }))
            assert.strictEqual(none.reason, 'rejected')
            assert.include(none.message, 'the tag is the release')
          }
        }
        yield* host.deleteTag(repository, name)
      }),
    )

    it.live('reads a run on a tag, approves what the account may, and says so with the host’s button where it may not', () =>
      Effect.gen(function* () {
        const { host } = subject
        const repository = yield* host.repository(subject.path)
        const name = yield* subject.tagName
        yield* host.pushTag(repository, { name, commit: yield* host.commitOf(repository, repository.defaultBranch) })
        yield* subject.startRun(name)
        const [run] = yield* host.runs(repository, name)
        assert.isDefined(run)
        const found = run as Run
        assert.strictEqual(found.ref, name)
        if (host.releasing === 'tag') {
          // Data Center's builds are another service's: nothing waits on Althar, and nothing is approved here.
          assert.lengthOf(found.gates, 0)
          const theirs = yield* Effect.flip(
            host.approveRun(repository, found, { id: 'x', name: 'release', kind: 'environment', approvable: true, url: found.url }),
          )
          assert.strictEqual(theirs.reason, 'forbidden')
          assert.include(theirs.message, 'another service')
        } else if (host.releasing === 'downloads') {
          // Bitbucket's manual steps have no API: the person's press, linked.
          assert.isNotEmpty(found.gates)
          for (const gate of found.gates) {
            assert.deepInclude(gate, { kind: 'manual_step', approvable: false })
            const refused = yield* Effect.flip(host.approveRun(repository, found, gate))
            assert.strictEqual(refused.reason, 'rejected')
            assert.include(refused.message, gate.url ?? '')
            assert.isNotNull(gate.url)
          }
        } else {
          const mine = found.gates.find((gate) => gate.approvable)
          const theirs = found.gates.find((gate) => !gate.approvable)
          assert.isDefined(mine)
          assert.isDefined(theirs)
          const refused = yield* Effect.flip(host.approveRun(repository, found, theirs!))
          assert.strictEqual(refused.reason, 'forbidden')
          assert.include(refused.message, 'can’t approve')
          assert.include(refused.message, theirs!.url ?? 'no url')
          const after = yield* host.approveRun(repository, found, mine!)
          assert.isFalse(after.gates.some((gate) => gate.id === mine!.id))
          const [read] = yield* host.runs(repository, name)
          assert.isFalse(
            (read?.gates ?? []).some((gate) => gate.id === mine!.id),
            'given, it waits on it no longer',
          )
        }
        yield* host.deleteTag(repository, name)
      }),
    )

    it.live('runs a run’s failed jobs again, as the host can', () =>
      Effect.gen(function* () {
        const { host } = subject
        const repository = yield* host.repository(subject.path)
        const name = yield* subject.tagName
        yield* host.pushTag(repository, { name, commit: yield* host.commitOf(repository, repository.defaultBranch) })
        yield* subject.failedRun(name)
        const [failed] = yield* host.runs(repository, name)
        assert.strictEqual(failed?.state, 'failed')
        if (host.releasing === 'tag') {
          const theirs = yield* Effect.flip(host.rerunFailed(repository, failed!))
          assert.include(theirs.message, 'another service')
        } else {
          assert.isTrue(yield* host.rerunFailed(repository, failed!))
          const [again] = yield* host.runs(repository, name)
          assert.include(['queued', 'running'], again?.state)
        }
        yield* host.deleteTag(repository, name)
      }),
    )
  })

export interface TrackerSubject {
  readonly name: string
  readonly tracker: Tracker
  /** An issue the account can read and comment on. */
  readonly ref: string
}

export const trackerContract = (subject: TrackerSubject) =>
  describe(`${subject.name}, as a tracker`, () => {
    it.live('reads an issue, lists the account’s, and comments', () =>
      Effect.gen(function* () {
        const { tracker } = subject
        assert.isNotEmpty((yield* tracker.account).login)
        const issue = yield* tracker.issue(subject.ref)
        assert.strictEqual(issue.ref, subject.ref)
        assert.isNotEmpty(issue.title)
        assert.include(['triage', 'backlog', 'todo', 'started', 'done', 'cancelled'], issue.status.category)
        assert.isArray(yield* tracker.mine({ limit: 5 }))
        yield* tracker.comment(issue, 'A comment from the Althar connectors contract.')
        if (tracker.capabilities.links) yield* tracker.link(issue, { url: 'https://example.com/althar-contract', title: 'Althar contract' })
        if (tracker.capabilities.changes.includes('status')) assert.isNotEmpty(yield* tracker.choices(issue, 'status'))
      }),
    )
  })

/** The smallest PNG there is: one transparent pixel. */
const ONE_PIXEL = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (char) => char.charCodeAt(0),
)
