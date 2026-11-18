import { describe, expect, it } from 'vitest'

import type { BoardTask } from '@althar/contracts'

import { MERGE_QUEUE_STEP, MERGING_STEP, asMerging, mergeStandingOf, mergesThroughQueue } from '../src/renderer/data/merges'
import { change } from './fixtures'

/*
 * A merge bound for its branch's merge queue is in it from just after the
 * press, wherever it shows: the press plays through at once, and the
 * runtime's read catches up behind it (The UI is instant). Its timing, from
 * the press, is useTask's, in taskParts.test.tsx.
 */

const bound = change({ draft: false, needs: [{ kind: 'merge_queue', state: 'met' }] })
const plain = change({ draft: false })

const ready = (one: Partial<BoardTask>): BoardTask =>
  ({ threadId: `th-${one.taskId}`, phase: 'ready', step: null, createdAt: '2026-11-18T20:00:00.000Z', ...one }) as BoardTask

describe('a merge going into its queue', () => {
  it('goes through its queue where its host said its branch merges through one', () => {
    expect(mergesThroughQueue(bound)).toBe(true)
    expect(mergesThroughQueue(plain)).toBe(false)
    expect(mergesThroughQueue(null)).toBe(false)
  })

  it('stands in its queue once the press is answered, though its read still says open', () => {
    expect(mergeStandingOf(bound, true)).toBe('merging')
    expect(mergeStandingOf(bound, true, false, true)).toBe('queued')
    // Not pressed, or merged meanwhile, the read says where it stands.
    expect(mergeStandingOf(bound, false, false, true)).toBeNull()
    expect(mergeStandingOf({ ...bound, state: 'merged' }, true, false, true)).toBe('merged')
    // A bypass of its queue merges it straight.
    expect(mergeStandingOf({ ...bound, queued: true }, true, true, true)).toBe('merging')
  })

  it('is at work in its merge queue on the board, not Merging, from just after the press', () => {
    const tasks = [ready({ taskId: 't1', change: bound }), ready({ taskId: 't2', change: plain })]
    const merging = new Set(['t1', 't2'])
    expect(asMerging(tasks, merging).map((one) => one.step)).toEqual([MERGING_STEP, MERGING_STEP])
    expect(asMerging(tasks, merging, new Set(['t1'])).map((one) => [one.phase, one.step])).toEqual([
      ['running', MERGE_QUEUE_STEP],
      ['running', MERGING_STEP],
    ])
    // Its press refused, it is the person's again: no longer merging, nor in a queue.
    expect(asMerging(tasks, new Set(), new Set(['t1'])).map((one) => one.phase)).toEqual(['ready', 'ready'])
  })
})
