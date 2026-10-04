import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import type { ChangeRequest, CodeHost, Tracker } from '../src/model'

/*
 * The models' contracts (docs/architecture/06), written once and run against
 * the fake in CI and against real accounts on demand. A code host opens a
 * change from a branch the subject prepares, finds it again rather than
 * opening a second, reads it back, marks it ready, and hears a reply. A
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
        } finally {
          if (subject.cleanup !== undefined) yield* Effect.ignore(subject.cleanup(opened))
        }
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
      }),
    )
  })
