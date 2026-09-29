import { AGENTS } from '../../content/facts'
import { clamp, lerp, span } from '../../lib/motion'
import { TASKS, type SiteTask } from '../../content/site'
import { FLOORS, M, PALLET, PANEL, SLING, topOf, Y0, type V } from './model'

/*
 * What the crane does, second by second. Each floor is one cycle: pick a
 * panel off the laydown, hoist, slew round the back of the mast to the
 * building while the trolley runs in, lower, inch it down, let go, hoist
 * and slew back, dropping the hook onto the next panel as it arrives. The
 * moves overlap, as an operator's do, and each one speeds up and slows down
 * on a ramp. After the last floor the crane parks and is left to turn in the
 * wind, the way cranes are left out of service; its plate goes on showing
 * the agents that could take the next task. The load's swing is a damped
 * pendulum driven by how the trolley moves (see Sway).
 */

/** Seconds per floor, and when in each one things happen. */
const PER = 8.5
const PH = {
  up: [0, 1.4],
  slew: [0.8, 4.5],
  trolley: [1.2, 4.2],
  lower: [3.9, 5.5],
  creep: [5.5, 6.3],
  land: 6.3,
  rise: [6.45, 7.3],
  back: [6.5, 8.5],
  trolleyBack: [6.8, 8.3],
  drop: [7.5, 8.5],
} as const

/** Degrees: over the laydown, over the building (going round the back), and parked. */
const PICK = -40
const TO_BUILDING = (Math.atan2(0 - M[2], 0 - M[0]) * 180) / Math.PI - 360
const PARK = -55
const D_PICK = 34
const D_DROP = Math.hypot(M[0], M[2])
const D_PARK = 13
const HOIST = 32

/** Where the panels wait. */
const rad = (PICK * Math.PI) / 180
export const LAYDOWN: V = [M[0] + Math.cos(rad) * D_PICK, 0, M[2] + Math.sin(rad) * D_PICK]

/** The last floor is set; then the scaffold comes off. */
const DONE = (FLOORS - 1) * PER + PH.land
/** When the build has played through and can be played again. */
export const TOTAL = DONE + 2.8

/** A move that speeds up and slows down on sine ramps, cruising between. */
function scurve(t: number, [a, b]: readonly [number, number], r = 0.3): number {
  const u = clamp((t - a) / (b - a))
  const p = (x: number) => x / 2 - (r / (2 * Math.PI)) * Math.sin((Math.PI * x) / r)
  const whole = 1 - r
  if (u <= r) return p(u) / whole
  if (u >= 1 - r) return (whole - p(1 - u)) / whole
  return (r / 2 + (u - r)) / whole
}

const hookOnStack = (left: number) => PALLET + left * PANEL + PANEL + SLING
const hookOnRoof = (k: number) => topOf(k) + PANEL + SLING

/** The wind, turning a parked crane: slow, and never quite still. */
const weather = (s: number) => {
  const ease = 1 - Math.exp(-s / 3)
  return ease * (10 * Math.sin(s / 6.5) + 4 * Math.sin(s / 2.7 + 0.8))
}

export interface State {
  /** Each floor, 0 to 1 as it's set. */
  floors: number[]
  scaffoldTop: number
  scaffoldAlpha: number
  slew: number
  trolley: number
  hook: number
  /** Whether a panel is on the hook. */
  load: boolean
  /** Panels left on the laydown. */
  stack: number
  /** The name on the crane's plate. */
  plate: string
  /** The task on the crane, while there is one. */
  task: SiteTask | null
  /** How hard to damp the swing: an operator steadies the load as it lands or is picked. */
  steady: number
  /** Parked and left to the wind. */
  parked: boolean
}

export function stateAt(t: number): State {
  const i = clamp(Math.floor(t / PER), 0, FLOORS - 1)
  const a = i * PER
  const u = t - a
  const last = i === FLOORS - 1

  const slew =
    u < PH.back[0]
      ? lerp(PICK, TO_BUILDING, scurve(u, PH.slew, 0.42))
      : last
        ? lerp(TO_BUILDING, PARK, scurve(u, [PH.back[0], PH.back[0] + 3.4], 0.42)) + weather(Math.max(0, u - PH.back[0] - 3.4))
        : lerp(TO_BUILDING, PICK, scurve(u, PH.back, 0.4))
  const trolley =
    u < PH.trolleyBack[0]
      ? lerp(D_PICK, D_DROP, scurve(u, PH.trolley))
      : lerp(D_DROP, last ? D_PARK : D_PICK, scurve(u, last ? [PH.trolleyBack[0], PH.trolleyBack[0] + 3] : PH.trolleyBack))

  const left = FLOORS - 1 - i
  const roof = hookOnRoof(i)
  let hook: number
  if (u < PH.up[1]) hook = lerp(hookOnStack(left), HOIST, scurve(u, PH.up, 0.35))
  else if (u < PH.lower[0]) hook = HOIST
  else if (u < PH.creep[0]) hook = lerp(HOIST, roof + 1.4, scurve(u, PH.lower))
  else if (u < PH.land) hook = lerp(roof + 1.4, roof, span(u, PH.creep[0], PH.creep[1]))
  else if (u < PH.rise[1]) hook = lerp(roof, HOIST, scurve(u, PH.rise, 0.4))
  else if (last || u < PH.drop[0]) hook = HOIST
  else hook = lerp(HOIST, hookOnStack(left - 1), scurve(u, PH.drop, 0.4))

  const steady =
    (u > PH.lower[1] - 0.45 && u < PH.land + 0.1) || (!last && u > PH.drop[1] - 0.3) || u < 0.12
      ? 1
      : u > PH.rise[0] && u < PH.rise[1]
        ? 0.3
        : 0

  const reach = (k: number) => topOf(k) + 1
  const scaffoldTop =
    t < DONE + 0.6 ? lerp(reach(i), reach(i + 1), span(t, a + 0.5, a + 2.6)) : lerp(reach(FLOORS), 0, span(t, DONE + 0.6, DONE + 2.4))

  const idle = t - DONE - 0.8
  const plate = idle < 0 ? (TASKS[i]?.who ?? '') : (AGENTS[Math.floor(idle / 2.4) % AGENTS.length] ?? '')

  return {
    floors: TASKS.map((_, k) => span(t, k * PER + PH.land, k * PER + PH.land + 0.5)),
    scaffoldTop,
    scaffoldAlpha: 1 - span(t, DONE + 2.1, DONE + 2.5),
    slew,
    trolley,
    hook,
    load: u < PH.land,
    stack: t < DONE ? left : 0,
    plate,
    task: t < DONE ? (TASKS[i] ?? null) : null,
    steady,
    parked: last && u > PH.back[0] + 3.4,
  }
}

/** When floor k was set, for the notes that point at it. */
export const setAt = (k: number) => k * PER + PH.land

/** Where the hook hangs from: under the trolley. */
function hangPoint(st: State): [number, number] {
  const r = (st.slew * Math.PI) / 180
  return [M[0] + Math.cos(r) * st.trolley, M[2] + Math.sin(r) * st.trolley]
}

/*
 * The swing: the hook and load as a pendulum under the trolley, pushed by
 * the trolley's acceleration and damped, harder while it's being steadied.
 * The timeline runs faster than a real crane, so gravity and the push are
 * scaled to give a swing you can see without it looking wild. Stepped at a
 * fixed rate from the start, so any moment can be drawn.
 */
const G = 30
const PUSH = 0.026
const DT = 1 / 120

export class Sway {
  private t = 0
  private s: [number, number] = [0, 0]
  private v: [number, number] = [0, 0]

  at(t: number): readonly [number, number] {
    if (t < this.t - 1e-6) this.reset()
    // After a long pause, catch up without running for seconds at a time.
    if (t - this.t > 40) this.t = t - 40
    while (this.t + DT <= t) this.step()
    return this.s
  }

  private reset() {
    this.t = 0
    this.s = [0, 0]
    this.v = [0, 0]
  }

  private step() {
    const t = this.t
    const s0 = stateAt(Math.max(0, t - DT))
    const s1 = stateAt(t)
    const s2 = stateAt(t + DT)
    const [p0, p1, p2] = [hangPoint(s0), hangPoint(s1), hangPoint(s2)]
    const acc = [(p2[0] - 2 * p1[0] + p0[0]) / (DT * DT), (p2[1] - 2 * p1[1] + p0[1]) / (DT * DT)]
    const w2 = G / Math.max(3, Y0 - s1.hook)
    const damp = 0.35 + 1.2 * s1.steady
    // Steadying brings the load back under the trolley, not just slows it.
    const settle = 2.6 * s1.steady
    const wind = s1.parked ? [0.5 * Math.sin(t * 0.8), 0.35 * Math.sin(t * 1.3 + 1.1)] : [0, 0]
    for (const k of [0, 1] as const) {
      const f = -w2 * this.s[k] - PUSH * (acc[k] ?? 0) - damp * this.v[k] + (wind[k] ?? 0)
      this.v[k] += f * DT
      this.v[k] -= this.v[k] * settle * DT
      this.s[k] = clamp(this.s[k] + this.v[k] * DT - this.s[k] * settle * DT, -2.6, 2.6)
    }
    // A panel picked up off the stack starts still.
    if (!s1.load && s2.load) {
      this.s = [0, 0]
      this.v = [0, 0]
    }
    this.t = t + DT
  }
}
