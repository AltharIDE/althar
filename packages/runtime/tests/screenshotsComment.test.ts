import type { ScreenshotNow } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'

import { fromAlthar } from '../src/pullRequestWords'
import {
  changedBetween,
  commentBody,
  EARLIER_KEPT,
  earlierAfter,
  isScreenshotsComment,
  type Kept,
  type PostedShot,
  postingOf,
  SCREENSHOTS_MARK,
  standingOf,
  updatedNote,
} from '../src/screenshotsComment'

/* The comment that shows a task's screenshots on its pull request, and where they stand against it (ADR-077). */

const picture = (digest: string | null, name: string | null = null, mediaType = 'image/png') => ({
  digest,
  mediaType,
  bytes: 10,
  width: 480,
  height: 300,
  name,
  unkept: digest === null ? ('too_large' as const) : null,
})

const now = (key: string, digest: string | null, caption = `${key} · A view`): ScreenshotNow => ({
  key,
  id: `item_${key}:0`,
  caption,
  picture: picture(digest),
})

const posted = (key: string, digest: string, head: string | null = 'abcdef1234'): PostedShot => ({
  key,
  caption: `${key} · A view`,
  digest,
  url: `https://example.test/${digest}.png`,
  head,
})

const kept = (over: Partial<Kept> = {}): Kept => ({
  commentId: '91',
  commentUrl: 'https://github.test/meridian/api/pull/1#issuecomment-91',
  shown: [],
  earlier: [],
  leftOut: [],
  uploads: {},
  postedAt: '2026-10-31T12:00:00.000Z',
  failed: null,
  updatedAt: '2026-10-31T12:00:00.000Z',
  ...over,
})

describe('what goes up', () => {
  it('is each kept screenshot of a view not left out, named as its picture is, else by its view', () => {
    const shots = [
      now('A1', 'a'.repeat(64)),
      now('A2', null),
      now('B1', 'b'.repeat(64)),
      { ...now('item_x:0', 'c'.repeat(64), 'No name'), picture: picture('c'.repeat(64), null, 'image/jpeg') },
      { ...now('C1', 'd'.repeat(64)), picture: picture('d'.repeat(64), 'checkout.webp', 'image/webp') },
      { ...now('C2', 'e'.repeat(64)), picture: picture('e'.repeat(64), null, 'image/gif') },
      { ...now('C3', 'f'.repeat(64)), picture: picture('f'.repeat(64), null, 'image/webp') },
    ]
    const posting = postingOf(shots, ['B1'])
    assert.deepStrictEqual(
      posting.map((shot) => [shot.key, shot.name]),
      [
        ['A1', 'A1.png'],
        ['item_x:0', 'item_x-0.jpg'],
        ['C1', 'checkout.webp'],
        ['C2', 'C2.gif'],
        ['C3', 'C3.webp'],
      ],
    )
  })
})

describe('how many changed', () => {
  it('counts a view taken again, one new and one gone, but not their order', () => {
    const shown = [posted('A1', 'a'), posted('A2', 'b'), posted('A3', 'c')]
    assert.strictEqual(
      changedBetween(
        [
          { key: 'A3', digest: 'c' },
          { key: 'A2', digest: 'b' },
          { key: 'A1', digest: 'a' },
        ],
        shown,
      ),
      0,
    )
    assert.strictEqual(
      changedBetween(
        [
          { key: 'A1', digest: 'z' },
          { key: 'A2', digest: 'b' },
          { key: 'A4', digest: 'd' },
        ],
        shown,
      ),
      3,
    )
  })
})

describe('where the screenshots stand', () => {
  it('are unposted before any comment, counting what would go up', () => {
    assert.deepStrictEqual(standingOf([now('A1', 'a'), now('A2', 'b')], undefined, false), {
      standing: 'unposted',
      changed: 2,
      synced: false,
      leftOut: [],
      commentUrl: null,
      failed: null,
    })
    // Left out before it was ever posted: what is left out holds, and the rest still waits.
    const waiting = standingOf([now('A1', 'a'), now('A2', 'b')], kept({ commentId: null, commentUrl: null, leftOut: ['A2'] }), true)
    assert.strictEqual(waiting.standing, 'unposted')
    assert.strictEqual(waiting.changed, 1)
    assert.deepStrictEqual(waiting.leftOut, ['A2'])
  })

  it('are posted while the comment shows them as they are, and changed once they aren’t', () => {
    const shown = [posted('A1', 'a'), posted('A2', 'b')]
    assert.strictEqual(standingOf([now('A1', 'a'), now('A2', 'b')], kept({ shown }), true).standing, 'posted')
    const changed = standingOf([now('A1', 'z'), now('A2', 'b')], kept({ shown, failed: 'GitHub refused.' }), true)
    assert.deepStrictEqual(changed, {
      standing: 'changed',
      changed: 1,
      synced: true,
      leftOut: [],
      commentUrl: 'https://github.test/meridian/api/pull/1#issuecomment-91',
      failed: 'GitHub refused.',
    })
  })

  it('leave out only views Outputs still shows', () => {
    const standing = standingOf([now('A1', 'a')], kept({ shown: [posted('A1', 'a')], leftOut: ['A1', 'Z9'] }), false)
    assert.deepStrictEqual(standing.leftOut, ['A1'])
    // Every view left out: the comment shows one that is gone now, which is a change.
    assert.strictEqual(standing.standing, 'changed')
  })
})

describe('what the comment showed before', () => {
  it('keeps each view taken again or gone, newest first, up to its limit', () => {
    const before = [posted('A1', 'a'), posted('A2', 'b'), posted('A3', 'c')]
    const after = [posted('A1', 'z'), posted('A2', 'b')]
    const earlier = earlierAfter(before, [posted('A1', 'y', 'older00')], after)
    assert.deepStrictEqual(
      earlier.map((shot) => [shot.key, shot.digest]),
      [
        ['A1', 'a'],
        ['A3', 'c'],
        ['A1', 'y'],
      ],
    )
    const many = Array.from({ length: EARLIER_KEPT + 5 }, (_, i) => posted(`B${i}`, `d${i}`))
    assert.lengthOf(earlierAfter(many, many, []), EARLIER_KEPT)
  })
})

describe('the comment', () => {
  it('shows each screenshot under its caption, as of its commit, marked and signed', () => {
    const body = commentBody({ shown: [posted('A1', 'a'), posted('A2', 'b')], earlier: [], head: 'abcdef1234' })
    assert.isTrue(body.startsWith(`${SCREENSHOTS_MARK}\n\n**Screenshots** as of \`abcdef1\``))
    assert.include(body, 'A1 · A view\n\n<img src="https://example.test/a.png" alt="A1 · A view" width="720">')
    assert.notInclude(body, '<details>')
    assert.isTrue(fromAlthar(body))
    assert.isTrue(isScreenshotsComment(body))
    assert.isFalse(isScreenshotsComment('Looks good.'))
  })

  it('folds away what it showed before, each at its own commit where known', () => {
    const body = commentBody({
      shown: [posted('A1', 'z')],
      earlier: [posted('A1', 'a', '1234567aaa'), posted('A2', 'b', null)],
      head: null,
    })
    assert.include(body, '**Screenshots**\n\n')
    assert.include(body, '<details>\n<summary>Earlier screenshots (2)</summary>')
    assert.include(body, 'A1 · A view, at `1234567`')
    assert.include(body, 'A2 · A view\n\n<img src="https://example.test/b.png"')
  })

  it('reads nothing in a caption as markup, nor lets it out of its attribute', () => {
    const shot = { ...posted('A1', 'a'), caption: 'A1 · <script>"x"</script> *bold* [link](y)\n# h', url: 'https://e.test/a.png?x="1"&y=2' }
    const body = commentBody({ shown: [shot], earlier: [], head: null })
    assert.include(body, 'A1 · \\<script\\>"x"\\</script\\> \\*bold\\* \\[link\\](y) \\# h')
    assert.include(body, 'alt="A1 · &lt;script&gt;&quot;x&quot;&lt;/script&gt; *bold* [link](y) # h"')
    assert.include(body, 'src="https://e.test/a.png?x=&quot;1&quot;&amp;y=2"')
  })

  it('tells reviewers how many changed, and where', () => {
    const one = updatedNote(1, 'https://github.test/c/1')
    assert.isTrue(one.startsWith('Screenshots updated: one changed. [See them](https://github.test/c/1).'))
    assert.isTrue(fromAlthar(one))
    assert.isTrue(updatedNote(3, null).startsWith('Screenshots updated: 3 changed.\n'))
  })
})
