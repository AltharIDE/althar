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

  it('of a change: since it became one, each view once as last taken, in the order they were shown', () => {
    const now = screenshotsNow(reports, { change: true, since: '2026-10-31T12:02:00.000Z' })
    expect(now.map((one) => [one.key, one.caption, one.picture.digest])).toEqual([
      ['r2:1', 'Unnamed', 'Unnamed'],
      ['B1', 'B1 · Gone', null],
      ['A1', 'A1 · Retaken', 'a2'],
    ])
    expect(now[2]?.id).toBe('r3:0')
  })

  it('of a change that never said when it became one: from its first report', () => {
    expect(screenshotsNow(reports, { change: true, since: null }).map((one) => one.key)).toEqual(['r1:0', 'r2:1', 'B1', 'A1'])
  })

  it('of any other task: from its last report that showed one', () => {
    expect(screenshotsNow(reports, { change: false, since: null }).map((one) => one.key)).toEqual(['A1'])
    expect(screenshotsNow([report('r9', 9, '2026-10-31T12:09:00.000Z', [run])], { change: false, since: null })).toEqual([])
  })
})
