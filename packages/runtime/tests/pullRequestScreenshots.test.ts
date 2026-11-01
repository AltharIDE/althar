import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Artifacts } from '../src/Artifacts'
import { Policies } from '../src/Policies'
import { PullRequestScreenshots } from '../src/PullRequestScreenshots'
import { Queries } from '../src/Queries'
import { addItem } from '../src/threads'
import { Instance } from '../src/Instance'
import { NONE_NOW, SCREENSHOTS_MARK } from '../src/screenshotsComment'
import { words } from '../src/words'
import { HOST, hosted, until } from './support'

import { ask, cards, connect, pushByHand, runtimeWith, tipOf } from './changesSupport'

/*
 * A task's screenshots on its pull request (ADR-077): the ones its Outputs
 * show, in one comment Althar writes and writes anew as they change, by the
 * person's hand or, where the project's rules say, on its own. Here the
 * lead hands one screenshot as it finishes (`[lead:evidence]`), its pull
 * request opens on the fake GitHub, and the tests show it more as later
 * rounds would: reports of their own, in its thread.
 */

const REQUEST = 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:evidence]'

/** A task whose pull request is open on the fake GitHub, its lead's screenshot shown: its project, task, thread and pull request. */
const opened = (github: FakeService, working: string) =>
  Effect.gen(function* () {
    yield* connect('github', HOST)
    const projectId = yield* ask(working, REQUEST, pushByHand)
    const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && github.changes.length > 0)
    return {
      projectId: projectId as ProjectId,
      taskId: ready?.taskId ?? '',
      threadId: ready?.threadId ?? '',
      url: github.changes[0]?.url ?? '',
    }
  })

/** How the task's screenshots stand on its pull request, as its snapshot says. */
const standing = (threadId: string) =>
  Effect.gen(function* () {
    const snapshot = yield* Effect.orDie((yield* Queries).thread(threadId))
    return snapshot.task.changes[0]?.screenshots
  })

/** The lead's first report's picture, as its item keeps it: to show again, under other names, as a later round would. */
const firstPicture = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ picture: string }>`
      SELECT json_extract(content, '$.evidence[0].picture') AS picture FROM thread_items
      WHERE thread_id = ${threadId} AND kind = 'step_result' ORDER BY sequence LIMIT 1`
    return JSON.parse(row?.picture ?? 'null') as Record<string, unknown>
  })

/** The view of the lead's first screenshot, which has no name: its report's id and its place there. */
const firstView = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ id: string }>`
      SELECT id FROM thread_items WHERE thread_id = ${threadId} AND kind = 'step_result' ORDER BY sequence LIMIT 1`
    return `${row?.id ?? ''}:0`
  })

/** Another picture in the store: the first's bytes and one more, so it is another digest. */
const anotherPicture = (picture: Record<string, unknown>) =>
  Effect.gen(function* () {
    const artifacts = yield* Artifacts
    const bytes = yield* artifacts.read(String(picture.sha256))
    const put = yield* artifacts.put(Uint8Array.from([...(bytes ?? []), 0]))
    return { ...picture, sha256: put?.sha256 ?? '', bytes: put?.size ?? 0 }
  })

interface Shot {
  readonly caption: string
  readonly picture: unknown
  readonly view?: string
  readonly option?: true
}

/** A later round's report in the task's thread, showing these screenshots, and saying which views from before still hold. */
const report = (projectId: ProjectId, threadId: string, shots: ReadonlyArray<Shot>, keptViews?: ReadonlyArray<string>) =>
  addItem({ projectId, threadId }, 'step_result', {
    step: 'implement',
    summary: 'Did more.',
    evidence: shots.map((shot) => ({ kind: 'screenshot', path: null, worktree: null, ...shot })),
    unverified: [],
    ...(keptViews === undefined ? {} : { keptViews }),
  })

/** The comment's body once it says this: posted on its own, as listening goes round. */
const commentSaying = (github: FakeService, words: string) =>
  Effect.map(
    until(
      Effect.sync(() => comments(github)),
      (all) => (all[0]?.body ?? '').includes(words),
    ),
    (all) => all[0]?.body ?? '',
  )

const comments = (github: FakeService) => github.commentsOn(1).filter((comment) => comment.body.includes(SCREENSHOTS_MARK))

describe('a task’s screenshots on its pull request', () => {
  it.live('go up by the person’s hand in one comment, written anew as they change, each picture uploaded once', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { projectId, taskId, threadId, url } = yield* opened(github, working)
      const screenshots = yield* PullRequestScreenshots
      const before = yield* standing(threadId)
      assert.deepStrictEqual(before, { standing: 'unposted', changed: 1, synced: false, leftOut: [], commentUrl: null, failed: null })

      yield* screenshots.post({ taskId, url, leftOut: [] })
      assert.lengthOf(github.uploads, 1)
      assert.strictEqual(github.uploads[0]?.mediaType, 'image/png')
      const [first] = comments(github)
      assert.include(first?.body ?? '', 'The retry button after a failed checkout')
      assert.include(first?.body ?? '', github.uploads[0]?.url ?? 'none')
      assert.strictEqual((yield* standing(threadId))?.standing, 'posted')

      // Posted again, unchanged: the same comment, nothing uploaded again.
      yield* screenshots.post({ taskId, url, leftOut: [] })
      assert.lengthOf(github.uploads, 1)
      assert.lengthOf(comments(github), 1)
      assert.strictEqual(github.calls.filter((call) => call === 'editComment').length, 1)

      // A later round pictures it anew under names: the picture before, which it doesn't keep, drops out. Posted by hand
      // once, the comment follows by itself; the same picture goes up once still.
      const picture = yield* firstPicture(threadId)
      yield* report(projectId, threadId, [
        { caption: 'A1 · The retry button', picture },
        { caption: 'A2 · The error line', picture: yield* anotherPicture(picture) },
      ])
      const written = yield* commentSaying(github, 'A2 · The error line')
      assert.lengthOf(github.uploads, 2)
      assert.lengthOf(comments(github), 1)
      assert.include(written, 'A1 · The retry button')
      assert.notInclude(written, 'The retry button after a failed checkout')
      assert.notInclude(written, '<details>')
      assert.strictEqual((yield* standing(threadId))?.standing, 'posted')
      // Nobody reviewed since: nothing more is said.
      assert.lengthOf(github.commentsOn(1), 1)

      // Reviewed since, and one view taken again: a line tells the reviewers, and the other view stays.
      github.reviewAs(1, 'dana', 'approved')
      yield* report(projectId, threadId, [
        { caption: 'A2 · The error line, again', picture: yield* anotherPicture(yield* anotherPicture(picture)) },
      ])
      const again = yield* commentSaying(github, 'A2 · The error line, again')
      yield* until(
        Effect.sync(() => github.commentsOn(1)),
        (all) => all.length === 2,
      )
      // The fake gives its comments no address: the line says how many, with nowhere to link.
      assert.isTrue(github.commentsOn(1)[1]?.body.startsWith('Screenshots updated: one changed.\n'))
      assert.lengthOf(comments(github), 1)
      // The view taken again shows as it is now, and as it was, folded away; the one not taken again as it was.
      assert.include(again, 'A1 · The retry button')
      assert.include(again, '<summary>Earlier screenshots (1)</summary>')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('show the change as built: never the options the person chose between, nor views a later round replaced', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { projectId, taskId, threadId, url } = yield* opened(github, working)
      const screenshots = yield* PullRequestScreenshots
      const picture = yield* firstPicture(threadId)
      const other = yield* anotherPicture(picture)
      // Directions on a live page, for the person to pick from: options, in the thread only.
      yield* report(projectId, threadId, [
        { caption: 'A · Cards on three repositories', picture, option: true },
        { caption: 'B · Tabs, a tab per repository', picture: other, option: true },
      ])
      // The built version: two views by name, replacing the first look.
      const tabs = yield* anotherPicture(other)
      yield* report(projectId, threadId, [
        { caption: 'The setup, one repository', picture: yield* anotherPicture(tabs), view: 'One repository' },
        { caption: 'Three repositories as tabs', picture: tabs, view: 'Tabs' },
      ])
      yield* screenshots.post({ taskId, url, leftOut: [] })
      const [posted] = comments(github)
      assert.include(posted?.body ?? '', 'The setup, one repository')
      assert.include(posted?.body ?? '', 'Three repositories as tabs')
      for (const gone of ['A · Cards', 'B · Tabs', 'The retry button after a failed checkout']) assert.notInclude(posted?.body ?? '', gone)

      // A follow-up takes one view again: the comment follows by itself, and keeps the other.
      yield* report(projectId, threadId, [
        { caption: 'Three repositories as tabs, arrow keys fixed', picture: yield* anotherPicture(tabs), view: 'Tabs' },
      ])
      const followed = yield* commentSaying(github, 'arrow keys fixed')
      assert.include(followed, 'The setup, one repository')
      assert.include(followed, '<summary>Earlier screenshots (1)</summary>')

      // A round of something new keeps only what it says still holds.
      yield* report(projectId, threadId, [{ caption: 'A refused file', picture }], ['Tabs'])
      const kept = yield* commentSaying(github, 'A refused file')
      assert.include(kept, 'arrow keys fixed')
      assert.notInclude(kept, 'The setup, one repository')

      // A round whose one picture was too large to keep replaces them all: the comment empties, rather than keep them.
      const tooLarge = {
        artifactId: null,
        sha256: null,
        mediaType: '',
        bytes: 1,
        width: null,
        height: null,
        name: 'page.png',
        why: 'too_large',
      }
      yield* report(projectId, threadId, [{ caption: 'The whole page', picture: tooLarge }])
      const emptied = yield* commentSaying(github, NONE_NOW)
      assert.lengthOf(comments(github), 1)
      for (const gone of ['A refused file', 'arrow keys fixed', '<details>']) assert.notInclude(emptied, gone)
      assert.strictEqual((yield* standing(threadId))?.standing, 'posted')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('leave out the views the person leaves out, from then on, whoever posts', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { projectId, taskId, threadId, url } = yield* opened(github, working)
      const screenshots = yield* PullRequestScreenshots
      const picture = yield* firstPicture(threadId)
      yield* report(projectId, threadId, [
        { caption: 'A1 · The retry button', picture },
        { caption: 'B1 · The settings page', picture: yield* anotherPicture(picture) },
      ])
      yield* screenshots.post({ taskId, url, leftOut: ['B1'] })
      assert.notInclude(comments(github)[0]?.body ?? '', 'B1 · The settings page')
      assert.deepStrictEqual((yield* standing(threadId))?.leftOut, ['B1'])

      // Taken again: posted without saying what to leave out, it stays out.
      yield* report(projectId, threadId, [
        { caption: 'B1 · The settings page, again', picture: yield* anotherPicture(yield* anotherPicture(picture)) },
      ])
      assert.strictEqual((yield* standing(threadId))?.standing, 'posted')
      yield* screenshots.post({ taskId, url })
      assert.notInclude(comments(github)[0]?.body ?? '', 'B1 ·')

      // The rules post them on their own now: still out, and what changes goes up by itself.
      yield* (yield* Policies).set(projectId, { postScreenshots: true }, (yield* Instance).personId)
      assert.isTrue((yield* standing(threadId))?.synced)
      yield* report(projectId, threadId, [{ caption: 'A1 · The retry button, retaken', picture: yield* anotherPicture(picture) }])
      yield* until(
        Effect.map(standing(threadId), (one) => [one]),
        ([one]) => one?.standing === 'posted',
      )
      const [body] = comments(github).map((comment) => comment.body)
      assert.include(body ?? '', 'A1 · The retry button, retaken')
      assert.notInclude(body ?? '', 'B1 ·')

      // Every view left out: nothing goes up, and the person is told to choose one.
      const refused = yield* Effect.flip(screenshots.post({ taskId, url, leftOut: ['A1', 'B1', yield* firstView(threadId)] }))
      assert.strictEqual(words(refused, (id) => id).message, 'Every screenshot is left out. Choose at least one to post.')
      // Said as it was asked: nothing went wrong to keep on the card.
      assert.isNull((yield* standing(threadId))?.failed)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('are posted again where the comment was deleted, and found again by its mark where the record was lost', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { taskId, url } = yield* opened(github, working)
      const screenshots = yield* PullRequestScreenshots
      const sql = yield* SqlClient.SqlClient
      yield* screenshots.post({ taskId, url, leftOut: [] })
      const [first] = comments(github)
      github.deleteComment(1, first?.id ?? '')
      yield* screenshots.post({ taskId, url, leftOut: [] })
      const [again] = comments(github)
      assert.notStrictEqual(again?.id, first?.id)
      assert.lengthOf(comments(github), 1)

      // What Althar kept of it is gone: the comment with its mark is the one written anew, not a second.
      yield* sql`DELETE FROM pull_request_pictures`
      yield* screenshots.post({ taskId, url, leftOut: [] })
      assert.lengthOf(comments(github), 1)
      assert.strictEqual(comments(github)[0]?.id, again?.id)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('say on the card why posting failed, and go up once they can', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { taskId, threadId, url } = yield* opened(github, working)
      const screenshots = yield* PullRequestScreenshots
      github.failNext('uploadPicture', 'forbidden', undefined, 403)
      const failed = yield* Effect.flip(screenshots.post({ taskId, url, leftOut: [] }))
      assert.match(words(failed, (id) => id).message, /GitHub/)
      const said = yield* standing(threadId)
      assert.strictEqual(said?.standing, 'unposted')
      assert.isNotNull(said?.failed)
      yield* screenshots.post({ taskId, url, leftOut: [] })
      assert.isNull((yield* standing(threadId))?.failed)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('aren’t offered where the host takes no pictures, and posting there says why', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare), pictures: false })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { taskId, threadId, url } = yield* opened(github, working)
      assert.isUndefined(yield* standing(threadId))
      const refused = yield* Effect.flip((yield* PullRequestScreenshots).post({ taskId, url, leftOut: [] }))
      assert.strictEqual(
        words(refused, (id) => id).message,
        'GitHub doesn’t take pictures in a pull request’s conversation, so Althar can’t post screenshots there.',
      )
      assert.lengthOf(github.uploads, 0)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})
