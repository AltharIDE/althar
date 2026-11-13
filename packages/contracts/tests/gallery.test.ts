import { describe, expect, it } from 'vitest'

import type { Evidence, GalleryUpdate } from '../src/Api'
import { type PictureReport, screenshotsNow, updateScreenshots } from '../src/screenshots'

const shot = (view: string, extra: Partial<Evidence> = {}): Evidence => ({
  kind: 'screenshot',
  view,
  caption: view,
  picture: { digest: view, mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: null, unkept: null },
  command: null,
  exit: null,
  text: null,
  dropped: 0,
  ...extra,
})
const report = (sequence: number, evidence: ReadonlyArray<Evidence>, gallery: GalleryUpdate = { mode: 'patch' }): PictureReport => ({
  id: `r${sequence}`,
  sequence,
  createdAt: '2026-11-01T10:00:00.000Z',
  evidence,
  gallery,
})
const options = { change: true, since: null }
const original = report(
  1,
  Array.from({ length: 12 }, (_, i) => shot(`Screen ${i + 1}`)),
)

describe('a task’s persistent visual collection', () => {
  it('keeps all twelve screens when an amendment adds three button details', () => {
    const now = screenshotsNow([original, report(2, [shot('Hover'), shot('Focus'), shot('Pressed')])], options)
    expect(now).toHaveLength(15)
    expect(now.slice(0, 12).map((x) => x.key)).toEqual(original.evidence.map((x) => x.view))
  })

  it('updates stable view IDs in place even when captions change, and adds a new detail beside them', () => {
    const now = screenshotsNow(
      [original, report(2, [shot('Screen 1', { caption: 'Panel with the new button' }), shot('Button detail')])],
      options,
    )
    expect(now).toHaveLength(13)
    expect(now[0]).toMatchObject({ key: 'Screen 1', id: 'r2:0', caption: 'Panel with the new button' })
    expect(now[1]?.id).toBe('r1:1')
  })

  it('retires and invalidates only explicitly named views, including before/after pairs', () => {
    const before = report(1, [shot('Panel', { before: true }), shot('Panel'), shot('Other')])
    const invalid = report(2, [], { mode: 'patch', invalidate: ['Panel'] })
    expect(
      screenshotsNow([before, invalid], options)
        .filter((x) => x.needsRefresh)
        .map((x) => x.key),
    ).toEqual(['Panel:before', 'Panel'])
    expect(screenshotsNow([before, invalid, report(3, [], { mode: 'patch', remove: ['Panel'] })], options).map((x) => x.key)).toEqual([
      'Other',
    ])
    expect(
      screenshotsNow([before, invalid, report(3, [shot('Panel')])], options).find((x) => x.key === 'Panel')?.needsRefresh,
    ).toBeUndefined()
  })

  it('starts a different selection only on explicit replacement, including an empty selection', () => {
    expect(screenshotsNow([original, report(2, [shot('Redesigned panel')], { mode: 'replace' })], options).map((x) => x.key)).toEqual([
      'Redesigned panel',
    ])
    expect(screenshotsNow([original, report(2, [], { mode: 'replace' })], options)).toEqual([])
    expect(screenshotsNow([original, report(2, [])], options)).toHaveLength(12)
  })

  it('keeps usable evidence when a retake or an entire replacement fails', () => {
    const failed = shot('Screen 1', {
      picture: { digest: null, mediaType: 'image/gif', bytes: 1, width: null, height: null, name: null, unkept: 'too_large' },
    })
    for (const mode of ['patch', 'replace'] as const) {
      const now = screenshotsNow([original, report(2, [failed], { mode })], options)
      expect(now).toHaveLength(12)
      expect(now[0]).toMatchObject({ id: 'r1:0', needsRefresh: true })
    }
    const partial = screenshotsNow([original, report(2, [failed, shot('New panel')], { mode: 'replace' })], options)
    expect(partial.map((x) => x.key)).toEqual(['Screen 1', 'New panel'])
    expect(partial[0]).toMatchObject({ id: 'r1:0', needsRefresh: true })
    const failedNew = screenshotsNow([original, report(2, [{ ...failed, view: 'New recording' }])], options)
    expect(failedNew).toHaveLength(13)
    expect(failedNew.at(-1)).toMatchObject({ key: 'New recording', needsRefresh: true, picture: { digest: null } })
  })

  it('uses the legacy selection as the baseline and does not resurrect discarded prototype directions', () => {
    const legacy = [
      { ...report(1, [shot('Cards'), shot('Tabs')]), gallery: undefined },
      { ...report(2, [shot('Built panel')]), gallery: undefined },
    ]
    expect(screenshotsNow([...legacy, report(3, [shot('Button')])], options).map((x) => x.key)).toEqual(['Built panel', 'Button'])
  })

  it('keeps GIF recordings alongside screenshots, while excluding prototype options from a change', () => {
    const animation = shot('Opening', { kind: 'recording', picture: { ...shot('Opening').picture!, mediaType: 'image/gif' } })
    const now = screenshotsNow([original, report(2, [animation, shot('Rejected option', { option: true })])], options)
    expect(now).toHaveLength(13)
    expect(now.at(-1)?.picture.mediaType).toBe('image/gif')
  })

  it('rebuilds the same state from a checkpoint and does not duplicate an applied handoff', () => {
    const next = report(2, [shot('Screen 1'), shot('Detail')])
    const baseline = screenshotsNow([original], options)
    const updated = updateScreenshots(baseline, next, options)
    expect(updated).toEqual(screenshotsNow([original, next], options))
    expect(updateScreenshots(updated, next, options)).toEqual(updated)
  })
})
