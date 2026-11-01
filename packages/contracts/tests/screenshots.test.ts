import { describe, expect, it } from 'vitest'

import type { Evidence } from '../src/Api'
import { type PictureReport, screenshotsNow, viewOf } from '../src/screenshots'

/* The screenshots a task's Outputs show as it is now, which its pull request's comment shows too (ADR-077). */

const shot = (caption: string, digest: string | null = caption): Evidence => ({
  kind: 'screenshot',
  caption,
  picture: { digest, mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: null, unkept: digest === null ? 'too_large' : null },
  command: null,
  exit: null,
  text: null,
  dropped: 0,
})

const run: Evidence = { kind: 'test_run', caption: 'Tests', picture: null, command: 'bun test', exit: 0, text: 'ok', dropped: 0 }

const report = (id: string, sequence: number, createdAt: string, evidence: ReadonlyArray<Evidence>): PictureReport => ({
  id,
  sequence,
  createdAt,
  evidence,
})

describe('a picture’s view', () => {
  it('is its name, from its caption, where it starts with one', () => {
    expect(viewOf('A1 · One quiet line')).toBe('A1')
    expect(viewOf('Z: the board')).toBe('Z')
    expect(viewOf('T1 Today: at a glance')).toBe('T1')
    expect(viewOf('The retry button')).toBeNull()
    expect(viewOf('a1 · lower case')).toBeNull()
  })
  it('handles long whitespace runs and empty suffixes', () => {
    const spaces = ' '.repeat(100_000)
    expect(viewOf('A:' + spaces)).toBe('A')
    expect(viewOf('A0 ' + spaces)).toBe('A0')
    expect(viewOf('A' + spaces)).toBeNull()
    expect(viewOf('A:')).toBeNull()
    expect(viewOf('A1 ')).toBeNull()
    expect(viewOf('A1  ')).toBe('A1')
    expect(viewOf('A1 ·')).toBe('A1')
  })
})

describe('the screenshots as it is now', () => {
  const reports = [
    report('r3', 3, '2026-10-31T12:03:00.000Z', [shot('A1 · Retaken', 'a2'), run]),
    report('r1', 1, '2026-10-31T12:01:00.000Z', [shot('Prototype')]),
    report('r2', 2, '2026-10-31T12:02:00.000Z', [shot('A1 · First', 'a1'), shot('Unnamed'), shot('B1 · Gone', null)]),
  ]

  it('of a change: since it became one, each view once as last taken, where it was first shown', () => {
    const now = screenshotsNow(reports, { change: true, since: '2026-10-31T12:02:00.000Z' })
    expect(now.map((one) => [one.key, one.caption, one.picture.digest])).toEqual([
      ['A1', 'A1 · Retaken', 'a2'],
      ['r2:1', 'Unnamed', 'Unnamed'],
      ['B1', 'B1 · Gone', null],
    ])
    expect(now[0]?.id).toBe('r3:0')
  })

  it('of a change that never said when it became one: a later round’s pictures replace the earlier ones', () => {
    expect(screenshotsNow(reports, { change: true, since: null }).map((one) => one.key)).toEqual(['A1', 'r2:1', 'B1'])
  })

  it('of any other task: its last round that pictured it, and what only took its views again', () => {
    expect(screenshotsNow(reports, { change: false, since: null }).map((one) => one.key)).toEqual(['A1', 'r2:1', 'B1'])
    expect(screenshotsNow([report('r9', 9, '2026-10-31T12:09:00.000Z', [run])], { change: false, since: null })).toEqual([])
  })
})

/*
 * Task folders come ready (PR #476): planned as a change from the start, so
 * it never became one. Its lead showed a first look, then four directions
 * on a live page, then the person's pick worked further, then the kit's
 * piece as built, then the real page after a review: as its reports said
 * them, before leads marked what each picture is.
 */
const folders = [
  report('i215', 215, '2026-10-31T10:45:02.094Z', [
    shot('A · Rows: in Running, a row per repository with what it copies and runs, and which task recorded it'),
    shot("B · Script: the same place, each repository's setup shown as the script Althar runs (meridian, three repositories)"),
    shot('C · Its own section: Task folders in the side nav, a sheet per repository, with how its last replay went'),
    run,
  ]),
  report('i284', 284, '2026-10-31T10:54:34.453Z', [run]),
  report('i316', 316, '2026-10-31T11:08:59.647Z', [run]),
  report('i540', 540, '2026-11-01T16:08:55.484Z', [
    shot("The plain-text setup in project settings' Running, for a project with three repositories: a commands box and a files box each"),
    run,
  ]),
  report('i576', 576, '2026-11-01T16:13:07.335Z', [
    shot("A · Cards on meridian's three repositories"),
    shot('B · Tabs: a tab per repository, commands and files side by side'),
    shot('C · Terminal: dark cards'),
    shot('D · One script: files as copy lines at the top'),
  ]),
  report('i612', 612, '2026-11-01T16:33:07.976Z', [
    shot('B · Files: the copied files as chips under the commands, on the three-repository project'),
  ]),
  report('i727', 727, '2026-11-01T17:01:47.156Z', [
    shot("The kit's RepositorySetups with one repository: commands, then the files copied from the checkout, numbered and coloured"),
    shot('Three repositories as tabs; the open one has no checkout on this computer and a setup that needs nothing'),
    run,
  ]),
  report('i776', 776, '2026-11-01T17:08:13.672Z', [
    shot('The real Running page in the app after a window reload: the commands and files typed earlier, read back from the runtime'),
    shot('Adding ../secrets.env is refused: the reason shows under the card and the files go back to what was kept'),
    run,
  ]),
  report('i835', 835, '2026-11-01T17:15:57.231Z', [run]),
  report('i858', 858, '2026-11-01T17:20:00.576Z', [run]),
]

const marked = (piece: Evidence, more: Partial<Evidence>): Evidence => ({ ...piece, ...more })

describe('a change whose lead showed directions before it built one (#476)', () => {
  it('shows the built version, none of the directions or first looks', () => {
    const now = screenshotsNow(folders, { change: true, since: null })
    expect(now.map((one) => one.id)).toEqual(['i776:0', 'i776:1'])
    expect(now.some((one) => /^[A-D] ·/.test(one.caption))).toBe(false)
  })

  it('as its lead marks them now: the directions as options, the built views by name, the kit’s views carried beside the real page', () => {
    const lead = [
      ...folders.filter((one) => one.sequence < 576),
      report('i576', 576, '2026-11-01T16:13:07.335Z', folders[4]?.evidence.map((piece) => marked(piece, { option: true })) ?? []),
      report('i612', 612, '2026-11-01T16:33:07.976Z', [marked(shot('B · Files: chips under the commands'), { option: true })]),
      report('i727', 727, '2026-11-01T17:01:47.156Z', [
        marked(shot('The kit’s RepositorySetups with one repository'), { view: 'One repository' }),
        marked(shot('Three repositories as tabs'), { view: 'Tabs' }),
      ]),
      {
        ...report('i776', 776, '2026-11-01T17:08:13.672Z', [marked(shot('The real Running page'), { view: 'Running page' })]),
        keptViews: ['One repository', 'Tabs'],
      },
    ]
    expect(screenshotsNow(lead, { change: true, since: null }).map((one) => one.key)).toEqual(['One repository', 'Tabs', 'Running page'])
    // Until it built one, the change showed nothing of the directions: they were options, in the thread.
    expect(screenshotsNow(lead.slice(0, 5), { change: true, since: null }).map((one) => one.id)).toEqual(['i540:0'])
    // A prototype's own Outputs are its directions.
    expect(screenshotsNow(lead.slice(0, 5), { change: false, since: null }).map((one) => one.key)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('keeps the other views where a follow-up takes only one of them again', () => {
    const built = [
      report('b1', 1, '2026-11-01T17:01:00.000Z', [
        marked(shot('One repository'), { view: 'One repository' }),
        marked(shot('Tabs'), { view: 'Tabs' }),
        marked(shot('Running page'), { view: 'Running page' }),
      ]),
      report('b2', 2, '2026-11-01T17:10:00.000Z', [marked(shot('Tabs, the arrow keys fixed', 'tabs2'), { view: 'Tabs' }), run]),
    ]
    const now = screenshotsNow(built, { change: true, since: null })
    expect(now.map((one) => [one.key, one.picture.digest])).toEqual([
      ['One repository', 'One repository'],
      ['Tabs', 'tabs2'],
      ['Running page', 'Running page'],
    ])
    // Something new beside them, without saying the others still hold: the new picture alone.
    const next = report('b3', 3, '2026-11-01T17:20:00.000Z', [
      marked(shot('Tabs again', 'tabs3'), { view: 'Tabs' }),
      shot('A refused file'),
    ])
    expect(screenshotsNow([...built, next], { change: true, since: null }).map((one) => one.key)).toEqual(['Tabs', 'b3:1'])
    expect(
      screenshotsNow([...built, { ...next, keptViews: ['Running page'] }], { change: true, since: null }).map((one) => one.key),
    ).toEqual(['Running page', 'Tabs', 'b3:1'])
  })
})
