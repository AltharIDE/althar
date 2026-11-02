import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import {
  detailsOf,
  lineOf,
  type ReviewRecord,
  reviewedCommit,
  reviewSeal,
  sealOf,
  sealUrl,
  setReviewSeal,
  setReviewSealStyle,
} from '../src/pullRequestReview'
import { ask, cards, connect, git, runtimeWith } from './changesSupport'
import { HOST, hosted, until } from './support'

/*
 * What a pull request Althar opens says of the review its change had: the
 * seal in its corner, and folded at its end what changed after review, with
 * its commits, and what was kept, with why; never how many findings.
 */

const RECORD = {
  reviewer: 'GPT-6.1 Sol',
  lead: 'Claude Opus 5.5',
  passes: 3,
  sha: '2f67c42a0b1c2d3e4f5061728394a5b6c7d8e9f0',
  date: '2026-10-31',
  changed: [
    { what: 'A session’s windows stay over an endpoint answer asked before them.', commits: ['5fa77fc9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] },
    { what: 'The peek says what the last read met.', commits: [] },
  ],
  kept: [
    { point: 'Ask the endpoint every 5 minutes, not every 15', why: 'its 429 asks for up to an hour’s wait.' },
    { point: 'Rename the reader', why: null },
  ],
} satisfies ReviewRecord

describe('the review on a pull request, as words', () => {
  it('folds what changed and what was kept under who reviewed it, in how many passes, at which commit', () => {
    assert.strictEqual(
      detailsOf(RECORD),
      [
        '<details>\n<summary>Reviewed by GPT-6.1 Sol in 3 passes, at <code>2f67c42</code></summary>',
        '**What changed after review**\n\n- A session’s windows stay over an endpoint answer asked before them. 5fa77fc\n- The peek says what the last read met.',
        '**Looked at and kept**\n\n- Ask the endpoint every 5 minutes, not every 15 — its 429 asks for up to an hour’s wait.\n- Rename the reader',
        '<sub>Built by Claude Opus 5.5 · Reviewed by GPT-6.1 Sol</sub>\n</details>',
      ].join('\n\n'),
    )
  })

  it('leaves out a part with nothing in it, and says one pass as one', () => {
    const passed = detailsOf({ ...RECORD, passes: 1, changed: [], kept: [] })
    assert.include(passed, '<summary>Reviewed by GPT-6.1 Sol in 1 pass, at <code>2f67c42</code></summary>')
    assert.notInclude(passed, 'What changed')
    assert.notInclude(passed, 'Looked at')
  })

  it('never lets what someone wrote break out of the fold, run on, or count anything', () => {
    const odd = detailsOf({
      ...RECORD,
      kept: [{ point: 'Close it early </details><img src=x onerror=alert(1)>', why: 'One\n\nand two' }],
    })
    assert.strictEqual(odd.match(/<\/details>/g)?.length, 1)
    assert.notInclude(odd, '<img')
    assert.include(odd, '&lt;/details&gt;&lt;img src=x onerror=alert(1)&gt; — One and two')
    assert.notMatch(detailsOf(RECORD), /finding|\d+ (?:fixed|kept|changes?)\b/i)
    assert.strictEqual(lineOf('word '.repeat(80)).length <= 240, true)
    assert.isTrue(lineOf('word '.repeat(80)).endsWith('…'))
  })

  it('puts the seal in the corner in either ink, read from the address the site draws it at', () => {
    const seal = sealOf('wax', RECORD) ?? ''
    assert.include(seal, '<picture>')
    assert.include(seal, `<source media="(prefers-color-scheme: dark)" srcset="${sealUrl('wax', RECORD, 'dark')}">`)
    assert.include(seal, `src="${sealUrl('wax', RECORD, 'light')}"`)
    assert.include(seal, 'align="right" width="150" alt="Reviewed by GPT-6.1 Sol in 3 passes, at 2f67c42"')
    assert.strictEqual(
      sealUrl('wax', RECORD, 'dark'),
      'https://althar.ai/seal/wax.svg?model=GPT-6.1+Sol&sha=2f67c42&passes=3&date=2026-10-31&ink=dark',
    )
  })

  it('names no commit, and has no seal, where no commit holds what the last pass read', () => {
    const unsure = { ...RECORD, sha: null }
    assert.isNull(sealOf('ring', unsure))
    assert.include(detailsOf(unsure), '<summary>Reviewed by GPT-6.1 Sol in 3 passes</summary>')
  })

  it('goes without a seal where one can’t set the reviewer’s name', () => {
    assert.isNull(sealOf('ring', { ...RECORD, reviewer: 'Modèle' }))
    assert.isNull(sealOf('ring', { ...RECORD, reviewer: 'x'.repeat(33) }))
    assert.isNotNull(sealOf('ring', { ...RECORD, reviewer: 'x'.repeat(32) }))
  })
})

describe('the commit a pass read', () => {
  const repo = () => {
    const cwd = mkdtempSync(join(tmpdir(), 'reviewed-'))
    const run = (...args: Array<string>) =>
      execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t.test', ...args], { cwd })
        .toString()
        .trim()
    run('init', '-q')
    writeFileSync(join(cwd, 'a.txt'), 'one\n')
    run('add', '-A')
    run('commit', '-q', '-m', 'One')
    /** A pass's copy, as reviewCopy.ts makes it: the worktree as it stands, uncommitted work too, as a commit on the head. */
    const snapshot = () => {
      run('add', '-A')
      const tree = run('write-tree')
      return run('commit-tree', tree, '-p', 'HEAD', '-m', 'What review round 1 reads')
    }
    return { cwd, run, snapshot }
  }

  it.effect('is the head the copy was made on, where nothing was left uncommitted', () => {
    const { cwd, run, snapshot } = repo()
    const copy = snapshot()
    const head = run('rev-parse', 'HEAD')
    return Effect.map(reviewedCommit(cwd, copy, head), (read) => assert.strictEqual(read, head))
  })

  it.effect('is the commit the lead made later of what it read uncommitted, never the head it sat on', () => {
    const { cwd, run, snapshot } = repo()
    writeFileSync(join(cwd, 'a.txt'), 'two\n')
    const copy = snapshot()
    run('reset', '-q')
    const head = run('rev-parse', 'HEAD')
    run('commit', '-q', '-am', 'Two')
    const two = run('rev-parse', 'HEAD')
    writeFileSync(join(cwd, 'a.txt'), 'three\n')
    run('commit', '-q', '-am', 'Three')
    const end = run('rev-parse', 'HEAD')
    return Effect.map(reviewedCommit(cwd, copy, end), (read) => {
      assert.notStrictEqual(read, head)
      assert.strictEqual(read, two)
    })
  })

  it.effect('is none, where no commit ever held what it read uncommitted', () => {
    const { cwd, run, snapshot } = repo()
    writeFileSync(join(cwd, 'a.txt'), 'two\n')
    const copy = snapshot()
    run('checkout', '-q', '--', 'a.txt')
    writeFileSync(join(cwd, 'a.txt'), 'other\n')
    run('commit', '-q', '-am', 'Other')
    return Effect.map(reviewedCommit(cwd, copy, run('rev-parse', 'HEAD')), (read) => assert.isNull(read))
  })
})

describe('the review seal setting', () => {
  it.live('is on, as a ring, until the person changes it', () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* reviewSeal, { on: true, style: 'ring' })
      yield* setReviewSealStyle('colophon')
      yield* setReviewSeal(false)
      assert.deepStrictEqual(yield* reviewSeal, { on: false, style: 'colophon' })
      yield* setReviewSeal(true)
      yield* setReviewSealStyle('ring')
      assert.deepStrictEqual(yield* reviewSeal, { on: true, style: 'ring' })
    }).pipe(Effect.provide(runtimeWith({ github: makeFakeService() }))),
  )
})

describe('a pull request opened after a review', () => {
  it.live('says who reviewed it, in how many passes, what changed with the commit that changed it, and what was kept', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      yield* setReviewSealStyle('wax')
      // The reviewer finds the heading wrong; the lead fixes it in a commit of its own, and the second pass passes.
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [review:findings]')
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
      const body = github.changes[0]?.body ?? ''
      // The fix as it went up: crediting made it again, so its sha is the branch's on the host, not the lead's.
      const fix = git(bare, 'log', '-1', '--format=%H', '--grep=Settle the review', 'althar/add-a-retry')
      assert.match(fix, /^[0-9a-f]{40}$/)
      // The second pass read the branch as settling left it: the fix, as it went up.
      const seal =
        /^<picture>\n {2}<source media="\(prefers-color-scheme: dark\)" srcset="https:\/\/althar\.ai\/seal\/wax\.svg\?model=([^&]+)&sha=([0-9a-f]{7})&passes=2&date=\d{4}-\d{2}-\d{2}&ink=dark">/.exec(
          body,
        )
      assert.isNotNull(seal)
      assert.strictEqual(seal?.[2], fix.slice(0, 7))
      const reviewer = decodeURIComponent((seal?.[1] ?? '').replace(/\+/g, ' '))
      assert.include(body, `<summary>Reviewed by ${reviewer} in 2 passes, at <code>${fix.slice(0, 7)}</code></summary>`)
      assert.include(body, `**What changed after review**\n\n- The heading names the retry. ${fix.slice(0, 7)}`)
      assert.notInclude(body, 'Looked at and kept')
      assert.match(body, /<sub>Built by .+ · Reviewed by .+<\/sub>\n<\/details>\n\nOpened by \[Althar\]/)
      assert.notMatch(body, /finding/i)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('names no commit for a fix where the lead named one it didn’t make settling', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [lead:fix-elsewhere] [review:findings]',
      )
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
      const body = github.changes[0]?.body ?? ''
      assert.include(body, '**What changed after review**\n\n- The heading names the retry.\n\n')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('says what the lead kept as it was, and why, in the one pass that read it', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [lead:set-aside] [review:findings]')
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
      const body = github.changes[0]?.body ?? ''
      assert.match(body, /^<picture>\n.+\/seal\/ring\.svg\?.+&passes=1&/s)
      assert.include(body, '**Looked at and kept**\n\n- The heading is wrong. — It reads as intended.')
      assert.notInclude(body, 'What changed after review')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('says nothing of its review where the person turned it off', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      yield* setReviewSeal(false)
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan] [lead:finish] [lead:edit] [review:findings]')
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
      const body = github.changes[0]?.body ?? ''
      assert.notInclude(body, '<picture>')
      assert.notInclude(body, '<details>')
      assert.include(body, 'Opened by [Althar]')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('says nothing of a review the change didn’t have', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
      const body = github.changes[0]?.body ?? ''
      assert.notInclude(body, '<picture>')
      assert.notInclude(body, '<details>')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})
