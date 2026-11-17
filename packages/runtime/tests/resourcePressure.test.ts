import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { readPressure } from '../src/machine'

import { PressureAdmission, type PressureReading, PRESSURE_BACKOFF, PRESSURE_RECOVERY, PRESSURE_STALE } from '../src/resourcePressure'

const samples = () => {
  let busy = 0
  let total = 0
  return (
    at: number,
    options: Partial<{ cpu: number; memory: number; pressure: PressureReading['pressure']; contention: number | null }> = {},
  ): PressureReading => {
    total += 1000
    busy += 1000 * (options.cpu ?? 0.2)
    return {
      at,
      cores: { busy, total, count: 4 },
      memory: { used: options.memory ?? 50, total: 100 },
      pressure: options.pressure ?? null,
      contention: options.contention === undefined ? 0.5 : options.contention,
    }
  }
}

describe('pressure-aware admission', () => {
  it.live('reads host pressure without requiring the load meter or a process listing', () =>
    Effect.gen(function* () {
      const reading = yield* readPressure()
      assert.isAbove(reading.cores.count, 0)
      assert.isAbove(reading.memory.total, 0)
      assert.isAtLeast(reading.memory.used, 0)
      assert.isAtMost(reading.memory.used, reading.memory.total)
      assert.notProperty(reading, 'processes')
      if (process.platform === 'win32') assert.isNull(reading.contention)
      else assert.isAtLeast(reading.contention ?? -1, 0)
    }),
  )
  it('keeps a busy but uncontended build free to use idle CPU, and ignores short spikes', () => {
    const policy = new PressureAdmission()
    const read = samples()
    for (const at of [0, PRESSURE_BACKOFF, 2 * PRESSURE_BACKOFF]) policy.observe(read(at, { cpu: 1, contention: 1 }), 4, 1)
    assert.strictEqual(policy.capacity(4), 4)
    policy.observe(read(3 * PRESSURE_BACKOFF, { cpu: 1, contention: 3 }), 4, 3)
    policy.observe(read(3 * PRESSURE_BACKOFF + 1), 4, 3)
    assert.strictEqual(policy.capacity(4), 4)
  })

  it('backs off sustained contention a place at a time without stopping existing work', () => {
    const policy = new PressureAdmission()
    const read = samples()
    policy.observe(read(0), 4, 3)
    for (const at of [1, PRESSURE_BACKOFF + 1, 2 * PRESSURE_BACKOFF + 1]) policy.observe(read(at, { cpu: 1, contention: 2 }), 4, 3)
    assert.strictEqual(policy.capacity(4), 2)
    assert.strictEqual(policy.capacity(1), 1, 'the configured cap is always an upper bound')
  })

  it('responds immediately to critical memory, then restores capacity gradually after sustained recovery', () => {
    const policy = new PressureAdmission()
    const read = samples()
    assert.isTrue(policy.observe(read(0, { pressure: 'critical' }), 4, 3))
    assert.strictEqual(policy.capacity(4), 1)
    policy.observe(read(1), 4, 1)
    for (let n = 1; n <= 3; n++) {
      policy.observe(read(n * PRESSURE_RECOVERY + 1), 4, 1)
      assert.strictEqual(policy.capacity(4), n + 1)
    }
    assert.strictEqual(policy.capacity(8), 8, 'no temporary reduction remains after full recovery')
  })

  it('uses native memory pressure in preference to cache-heavy memory utilization', () => {
    const policy = new PressureAdmission()
    const read = samples()
    policy.observe(read(0, { memory: 99, pressure: 'normal' }), 4, 2)
    policy.observe(read(PRESSURE_BACKOFF, { memory: 99, pressure: 'normal' }), 4, 2)
    assert.strictEqual(policy.capacity(4), 4)
    policy.observe(read(PRESSURE_BACKOFF + 1, { pressure: 'warning' }), 4, 2)
    policy.observe(read(2 * PRESSURE_BACKOFF + 1, { pressure: 'warning' }), 4, 2)
    assert.strictEqual(policy.capacity(4), 3)
  })

  it('uses available-memory pressure when no native pressure level exists', () => {
    const policy = new PressureAdmission()
    const read = samples()
    policy.observe(read(0, { memory: 92 }), 4, 2)
    policy.observe(read(PRESSURE_BACKOFF, { memory: 92 }), 4, 2)
    assert.strictEqual(policy.capacity(4), 3)
    policy.observe(read(PRESSURE_BACKOFF + 1, { memory: 97 }), 4, 2)
    assert.strictEqual(policy.capacity(4), 1)
  })

  it('falls back to CPU saturation among competing workers when runnable load is unavailable', () => {
    for (const active of [1, 3]) {
      const policy = new PressureAdmission()
      const read = samples()
      for (const at of [0, 1, PRESSURE_BACKOFF + 1]) policy.observe(read(at, { cpu: 1, contention: null }), 4, active)
      assert.strictEqual(policy.capacity(4), active === 1 ? 4 : 3)
    }
  })

  it('does not retain an old restriction after invalid or stale data, an idle reset or a clock discontinuity', () => {
    for (const stale of ['repeat', 'gap', 'invalid', 'idle', 'counter'] as const) {
      const policy = new PressureAdmission()
      const read = samples()
      const critical = read(10, { pressure: 'critical' })
      policy.observe(critical, 4, 2)
      assert.strictEqual(policy.capacity(4), 1)
      if (stale === 'idle') policy.reset()
      else if (stale === 'repeat') {
        policy.observe(critical, 4, 2)
        policy.observe(critical, 4, 2)
      } else if (stale === 'gap') policy.observe(read(10 + PRESSURE_STALE + 1), 4, 2)
      else if (stale === 'counter') policy.observe({ ...read(11), cores: { busy: 0, total: 0, count: 4 } }, 4, 2)
      else policy.observe({ ...read(11), memory: { used: Number.NaN, total: 0 } }, 4, 2)
      assert.strictEqual(policy.capacity(4), 4, stale)
    }
  })
})
