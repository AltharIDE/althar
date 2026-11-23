import type { MemoryPressure, PlacesWhy } from '@althar/contracts'

/** Cheap host observations, without process attribution or a window's load-meter reads. */
export interface PressureReading {
  readonly at: number
  readonly cores: { readonly busy: number; readonly total: number; readonly count: number }
  readonly memory: { readonly used: number; readonly total: number }
  readonly pressure: MemoryPressure | null
  /** Runnable load per core; null on Windows, where Node does not report it. */
  readonly contention: number | null
}

export const PRESSURE_BACKOFF = 15_000
export const PRESSURE_RECOVERY = 30_000
export const PRESSURE_STALE = 30_000

/**
 * Pace new autonomous work; CPU groups handle work already running. A transient spike changes nothing. Persistent
 * contention backs off one place, while critical memory pressure leaves one place immediately. Recovery is slower.
 * The person's configured cap is never written. Missing/stale observations restore normal admission, not a deadlock.
 * What last lowered it, memory or the CPU, is kept until it is back to the person's number, for the window to say.
 */
export class PressureAdmission {
  private limit: number | undefined
  private cause: PlacesWhy | undefined
  private previous: PressureReading | undefined
  private highSince: number | undefined
  private lowSince: number | undefined

  capacity(configured: number): number {
    return Math.max(1, Math.min(configured, this.limit ?? configured))
  }

  /** Why fewer than `configured` may work for now; null while all may. */
  why(configured: number): PlacesWhy | null {
    return this.capacity(configured) < configured ? (this.cause ?? null) : null
  }

  reset(): boolean {
    const changed = this.limit !== undefined
    this.limit = undefined
    this.cause = undefined
    this.previous = undefined
    this.highSince = undefined
    this.lowSince = undefined
    return changed
  }

  observe(reading: PressureReading, configured: number, active: number): boolean {
    const before = this.capacity(configured)
    const { at, cores, memory, pressure, contention } = reading
    if (
      ![at, cores.busy, cores.total, cores.count, memory.used, memory.total].every(Number.isFinite) ||
      cores.count < 1 ||
      memory.total <= 0 ||
      memory.used < 0 ||
      memory.used > memory.total ||
      (contention !== null && (!Number.isFinite(contention) || contention < 0))
    )
      return this.reset()
    let previous = this.previous
    if (previous !== undefined && at <= previous.at) {
      this.reset()
      // Keep a watermark: a repeatedly cached critical reading must not repeatedly impose its old limit.
      this.previous = previous
      return before !== this.capacity(configured)
    }
    if (
      previous !== undefined &&
      (at - previous.at > PRESSURE_STALE || cores.total < previous.cores.total || cores.busy < previous.cores.busy)
    ) {
      this.reset()
      previous = undefined
    }
    this.previous = reading
    const used = memory.used / memory.total
    const critical = pressure === 'critical' || (pressure === null && used >= 0.95)
    const memoryHigh = pressure === 'warning' || critical || (pressure === null && used >= 0.9)
    const delta = previous === undefined ? 0 : cores.total - previous.cores.total
    const cpu = delta > 0 ? (cores.busy - (previous?.cores.busy ?? 0)) / delta : 0
    const cpuHigh = cpu >= 0.9 && (contention === null ? active > 1 : contention >= 1.25)
    const low = !memoryHigh && (pressure === 'normal' || used <= 0.8) && (contention === null ? cpu <= 0.7 || active <= 1 : contention <= 1)
    if (critical) {
      this.limit = 1
      this.cause = 'memory'
      this.highSince = at
      this.lowSince = undefined
    } else if (memoryHigh || cpuHigh) {
      this.lowSince = undefined
      this.highSince ??= at
      if (at - this.highSince >= PRESSURE_BACKOFF) {
        this.limit = Math.max(1, this.capacity(configured) - 1)
        this.cause = memoryHigh ? 'memory' : 'cpu'
        this.highSince = at
      }
    } else {
      this.highSince = undefined
      if (low && this.limit !== undefined) {
        this.lowSince ??= at
        if (at - this.lowSince >= PRESSURE_RECOVERY) {
          const next = this.capacity(configured) + 1
          this.limit = next >= configured ? undefined : next
          if (this.limit === undefined) this.cause = undefined
          this.lowSince = at
        }
      } else this.lowSince = undefined
    }
    return before !== this.capacity(configured)
  }
}
