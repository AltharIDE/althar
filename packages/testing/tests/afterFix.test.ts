import { expect, test, vi } from 'vite-plus/test'

import { afterFix } from '../src/afterFix'

const timeline = (closer: unknown) => JSON.stringify({ data: { repository: { issue: { timelineItems: { nodes: [{ closer }] } } } } })

test.each(['behind', 'diverged'])('an old branch (%s) cannot reopen an issue closed by a merged fix', (status) => {
  const gh = vi
    .fn()
    .mockReturnValueOnce(timeline({ mergeCommit: { oid: 'fixed' } }))
    .mockReturnValueOnce(status)
  expect(afterFix(gh, 'AltharIDE/althar', 787, 'tested')).toBe(false)
  expect(gh.mock.calls[1]).toEqual(['api', 'repos/AltharIDE/althar/compare/fixed...tested', '--jq', '.status'])
})

test.each(['ahead', 'identical'])('a failure that tested the fix (%s) reopens its issue', (status) => {
  const gh = vi
    .fn()
    .mockReturnValueOnce(timeline({ oid: 'fixed' }))
    .mockReturnValueOnce(status)
  expect(afterFix(gh, 'AltharIDE/althar', 787, 'tested')).toBe(true)
})

test.each([null, {}, { mergeCommit: null }])('a manual closure without a fixing commit still reopens', (closer) => {
  const gh = vi.fn().mockReturnValueOnce(timeline(closer))
  expect(afterFix(gh, 'AltharIDE/althar', 787, 'tested')).toBe(true)
  expect(gh).toHaveBeenCalledTimes(1)
})

test('without a tested SHA there is no ancestry evidence to discard a failure', () => {
  const gh = vi.fn()
  expect(afterFix(gh, 'AltharIDE/althar', 787, undefined)).toBe(true)
  expect(gh).not.toHaveBeenCalled()
})

test('a missing closing event is not evidence that the run is stale', () => {
  const gh = vi.fn().mockReturnValue(JSON.stringify({ data: { repository: { issue: { timelineItems: { nodes: [] } } } } }))
  expect(afterFix(gh, 'AltharIDE/althar', 787, 'tested')).toBe(true)
})

test('an unavailable API surfaces the error so the reporter can warn and retain the failure', () => {
  expect(() =>
    afterFix(
      () => {
        throw new Error('Unavailable')
      },
      'AltharIDE/althar',
      787,
      'tested',
    ),
  ).toThrow('Unavailable')
})
