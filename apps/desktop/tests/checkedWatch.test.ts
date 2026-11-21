// @vitest-environment node
import { ApiError, type FeedPosition, type WatchEvent } from '@althar/contracts'
import { Effect, Stream } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { checkedPosition, checkedWatch } from '../src/renderer/data/checkedWatch'

const homeId = `home_${'1'.repeat(32)}`
const position = (cursor = 0, digit = '2'): FeedPosition => ({ homeId, cursor, checkpoint: cursor === 0 ? null : digit.repeat(32) })
const changed = (cursor: number, digit = '2'): WatchEvent => ({
  _tag: 'Changed',
  cursor,
  checkpoint: digit.repeat(32),
  aggregateType: 'task',
  aggregateId: 'task',
  projectId: 'another-project',
  threadId: null,
})
const restored = new ApiError({ reason: 'SnapshotRequired', message: 'Restored history' })
const result = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.result(effect))

describe('checked home feeds', () => {
  it('refuses another home, unscoped cursors and malformed history markers', () => {
    expect(() => checkedPosition(7, homeId)).toThrow()
    expect(() => checkedPosition(position(), `home_${'3'.repeat(32)}`)).toThrow('another home')
    for (const value of [
      { ...position(), checkpoint: '1'.repeat(32) },
      { ...position(1), checkpoint: null },
      { ...position(1), checkpoint: 'bad' },
    ])
      expect(() => checkedPosition(value, homeId)).toThrow()
  })
  it('uses a fresh home-scoped snapshot after a restoration and does not loop on an invalid feed', async () => {
    const positions: FeedPosition[] = []
    const reset = vi.fn()
    const snapshot = vi.fn(() => Effect.succeed({ cursor: 8, position: position(8, '4'), projects: [] }))
    const watch = (at: FeedPosition) => {
      positions.push(at)
      return Stream.fail(restored)
    }
    const ended = await result(checkedWatch({ watch, snapshot }, homeId, position(3), () => {}, undefined, reset))
    expect(ended).toMatchObject({ _tag: 'Failure', failure: { reason: 'SnapshotRequired' } })
    expect(positions).toEqual([position(3), position(8, '4')])
    expect(snapshot).toHaveBeenCalledTimes(1)
    expect(reset).toHaveBeenCalledTimes(1)
  })
  it('checks global positions even for other projects, rejects backwards or divergent history, and never retries a closed tunnel', async () => {
    for (const bad of [changed(6), changed(7, '3'), { ...changed(9), checkpoint: undefined }]) {
      const heard: WatchEvent[] = []
      const snapshot = vi.fn(() => Effect.succeed({ cursor: 10, position: position(10), projects: [] }))
      let watches = 0
      const watch = () => (++watches === 1 ? Stream.make(changed(7), bad) : Stream.empty)
      const ended = await result(checkedWatch({ watch, snapshot }, homeId, position(2), (event) => heard.push(event)))
      expect(heard).toEqual([changed(7)])
      expect(snapshot).toHaveBeenCalledTimes(1)
      expect(ended).toMatchObject({ _tag: 'Failure', failure: { reason: 'ConnectionClosed' } })
      expect(watches).toBe(2)
    }
  })
  it('fails closed if a fresh snapshot is missing its checked position or belongs to another home', async () => {
    for (const next of [undefined, { ...position(5), homeId: `home_${'5'.repeat(32)}` }]) {
      const reset = vi.fn()
      const ended = await result(
        checkedWatch(
          { watch: () => Stream.fail(restored), snapshot: () => Effect.succeed({ cursor: 5, position: next, projects: [] }) },
          homeId,
          position(),
          () => {},
          undefined,
          reset,
        ),
      )
      expect(ended._tag).toBe('Failure')
      expect(reset).not.toHaveBeenCalled()
    }
  })
})
