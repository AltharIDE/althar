import { Brand, BrandMark, VisuallyHidden } from '@althar/ui'
import { type CSSProperties, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { Agent } from '../../../content/agents'
import { cx } from '../../../lib/cx'
import { AgentMark } from '../../../shared/AgentMark'
import s from './Drawn.module.css'

/*
 * Four of the bento's features drawn as small objects in real 3D, in one of
 * two finishes. Engraved: paper, its sides and its shadows hatched in the
 * footer's cobalt, its edges drawn in fine lines. Glass: frosted panes lit
 * from under by the page's cobalt and violet. Each is a few planes in CSS 3D
 * under one camera that sways a little, so the browser keeps the depth, and
 * what is printed on them is real text. Lengths are in the picture's own
 * units (--u), so it scales with its tile. Each loops only while on screen,
 * and holds still with reduced motion or a held `?t=`.
 */

/** The drawings' finish: engraved on paper, or frosted glass. */
export type Skin = 'ink' | 'glass'

const u = (n: number) => `calc(${n} * var(--u))`

type Tone = 'paper' | 'live' | 'signal' | 'warm' | 'dim'

const unchanging = () => () => {}
const askedStill = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).has('t')

/** Whether it is on screen, so it may move, and whether it holds still: with motion reduced, or a still asked for with `?t=`. */
function useAwake<T extends Element>() {
  const ref = useRef<T>(null)
  const [awake, setAwake] = useState(false)
  const still = useSyncExternalStore(unchanging, askedStill, () => false)
  useEffect(() => {
    const el = ref.current
    if (!el || still) return
    const io = new IntersectionObserver(([e]) => setAwake(e?.isIntersecting ?? false), { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [still])
  return [ref, awake && !still, still] as const
}

/** A count that goes up every `every` ms while awake. */
function useBeat(awake: boolean, every: number) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!awake) return
    const id = window.setInterval(() => setN((k) => k + 1), every)
    return () => clearInterval(id)
  }, [awake, every])
  return n
}

interface Camera {
  /** How far it looks down, in degrees from straight ahead. */
  tilt: number
  /** How far the ground is turned. */
  turn: number
  /** Where the world's centre sits, down from the stage's middle, in units. */
  drop?: number
}

/** A picture: its stage, its camera, and the things in it, placed round the world's centre. `size` is the stage in units. */
function World({
  skin,
  label,
  camera,
  size = [560, 400],
  children,
}: {
  skin: Skin
  label: string
  camera: Camera
  size?: readonly [number, number]
  children: (awake: boolean, still: boolean) => ReactNode
}) {
  const [ref, awake, still] = useAwake<HTMLDivElement>()
  return (
    <div
      ref={ref}
      className={s.art}
      data-skin={skin}
      data-awake={awake || undefined}
      data-still={still || undefined}
      style={{ '--sw': size[0], '--sh': size[1] } as CSSProperties}
    >
      {/* Read as its label: what is printed in it is part of the picture. */}
      <VisuallyHidden>{label}</VisuallyHidden>
      <div className={s.stage} aria-hidden="true">
        <div
          className={s.world}
          style={{ '--tilt': `${camera.tilt}deg`, '--turn': `${camera.turn}deg`, '--drop': u(camera.drop ?? 0) } as CSSProperties}
        >
          {children(awake, still)}
        </div>
      </div>
    </div>
  )
}

/** A box: its corner at x, y, raised z; w along x, d along y, h tall. `top` is printed on its top; `front`, on the face toward you, which is then its face. */
function Box({
  x,
  y,
  z = 0,
  w,
  d,
  h,
  tone = 'paper',
  top,
  front,
  className,
  style,
}: {
  x: number
  y: number
  z?: number
  w: number
  d: number
  h: number
  tone?: Tone
  top?: ReactNode
  front?: ReactNode
  className?: string
  style?: CSSProperties
}) {
  const standing = front !== undefined
  return (
    <div
      className={cx(s.box, className)}
      data-tone={tone}
      style={{ left: u(x), top: u(y), width: u(w), height: u(d), transform: `translateZ(${u(z)})`, '--h': h, ...style } as CSSProperties}
    >
      <i className={cx(s.back, s.side)} />
      <i className={cx(s.right, s.side)} />
      <i className={cx(s.left, s.side, s.shadowed)} />
      <div className={cx(s.front, standing ? s.face : s.side)}>{front}</div>
      <div className={cx(s.top, standing ? cx(s.side, s.lid) : s.face)}>{top}</div>
    </div>
  )
}

/** A disc standing on the ground: its rim as rings one over another, its top printed. */
function Disc({
  x = 0,
  y = 0,
  z = 0,
  r,
  h,
  rings = 8,
  tone = 'paper',
  top,
}: {
  x?: number
  y?: number
  z?: number
  r: number
  h: number
  rings?: number
  tone?: Tone
  top?: ReactNode
}) {
  return (
    <div
      className={s.disc}
      data-tone={tone}
      style={{ left: u(x - r), top: u(y - r), width: u(2 * r), height: u(2 * r), transform: `translateZ(${u(z)})` }}
    >
      {Array.from({ length: rings }, (_, i) => (
        <i key={i} className={s.ring} style={{ transform: `translateZ(${u((i / rings) * h)})` }} />
      ))}
      <div className={s.discTop} style={{ transform: `translateZ(${u(h)})` }}>
        {top}
      </div>
    </div>
  )
}

/** Where the ground darkens under something. */
function Shade({ x, y, w, d, soft = 1 }: { x: number; y: number; w: number; d: number; soft?: number }) {
  return <i className={s.shade} style={{ left: u(x), top: u(y), width: u(w), height: u(d), '--soft': soft } as CSSProperties} />
}

/** Linework drawn on the ground, in the world's units round its centre. */
function Ground({ x, y, w, d, z = 0.5, children }: { x: number; y: number; w: number; d: number; z?: number; children: ReactNode }) {
  return (
    <svg
      className={s.ground}
      viewBox={`${x} ${y} ${w} ${d}`}
      style={{ left: u(x), top: u(y), width: u(w), height: u(d), transform: `translateZ(${u(z)})` }}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/* ---- several accounts for one agent: a deck of them, the one in use lifted on top, and the next taking over when it runs out ---- */

const ACCOUNTS = [
  { name: 'Personal', plan: 'ChatGPT Pro', who: 'you@tally.dev' },
  { name: 'Northwind', plan: 'ChatGPT Team', who: 'dana@northwind.io' },
  { name: 'Client', plan: 'ChatGPT Plus', who: '~/.codex-client' },
  { name: 'API key', plan: 'Billed per use', who: 'OpenAI ····4f2a' },
] as const

/** Each place in the deck, from the top: how high it floats. */
const SLOT = [158, 108, 76, 44] as const

export function Accounts({ skin }: { skin: Skin }) {
  return (
    <World
      skin={skin}
      camera={{ tilt: 58, turn: -36, drop: 46 }}
      size={[680, 390]}
      label="Codex signed in four times: Personal, Northwind, a client’s and an API key. When the one in use runs out, the work goes on with the next."
    >
      {(awake) => <Deck awake={awake} />}
    </World>
  )
}

function Deck({ awake }: { awake: boolean }) {
  const beat = useBeat(awake, 3400)
  const inUse = beat % ACCOUNTS.length
  const W = 250
  const D = 156
  return (
    <>
      <Shade x={-210} y={-150} w={420} d={320} soft={1.4} />
      <Box
        x={-168}
        y={-108}
        w={336}
        d={216}
        h={22}
        top={<span className={s.plinthTop} />}
        front={
          <span className={s.plinth}>
            <AgentMark agent={Agent.Codex} size={13} />
            Codex · 4 accounts
          </span>
        }
      />
      {ACCOUNTS.map((a, i) => {
        const place = (i - inUse + ACCOUNTS.length) % ACCOUNTS.length
        // The one that just ran out goes round the deck to its foot.
        const cycling = beat > 0 && place === ACCOUNTS.length - 1
        const state = place === 0 ? 'In use' : cycling ? 'Back at 14:00' : place === 1 ? 'Next' : 'Ready'
        return (
          <div key={a.name} className={cx(s.card, cycling && s.cycling)} style={{ transform: `translateZ(${u(SLOT[place]!)})` }}>
            <Box
              x={-W / 2}
              y={-D / 2}
              w={W}
              d={D}
              h={6}
              tone={place === 0 ? 'live' : cycling ? 'dim' : 'paper'}
              top={
                <span className={s.account}>
                  <span className={s.accountHead}>
                    <AgentMark agent={Agent.Codex} size={20} />
                    <b>{a.plan}</b>
                  </span>
                  <span className={s.accountWho}>{a.who}</span>
                  <span className={s.meter}>
                    {place === 0 ? <i key={beat} className={s.meterUsing} /> : <i style={{ width: cycling ? '100%' : '0%' }} />}
                  </span>
                  <span className={s.accountFoot}>
                    <b>{a.name}</b>
                    <em>{state}</em>
                  </span>
                </span>
              }
            />
          </div>
        )
      })}
    </>
  )
}

/* ---- automations: a dial with its hand going round, the last seven runs standing at its rim, and what it is asked floating over it ---- */

const RUNS = ['made', 'made', 'none', 'made', 'failed', 'made', 'made'] as const
const R = 126

export function Automations({ skin }: { skin: Skin }) {
  // The last seven, round the near half of the rim, oldest on the left; the hand comes round to the newest.
  const at = RUNS.map((_, i) => ((205 - i * 25) * Math.PI) / 180)
  const newest = (at[at.length - 1]! * 180) / Math.PI
  return (
    <World
      skin={skin}
      camera={{ tilt: 58, turn: -32, drop: 40 }}
      size={[440, 410]}
      label="An automation, every weekday at 07:00: review each new pull request. Its last seven runs stand at the dial’s rim: five made a change, one had nothing to do, one failed."
    >
      {() => (
        <>
          <Shade x={-R - 50} y={-R - 50} w={2 * R + 100} d={2 * R + 100} soft={1.2} />
          <Disc
            r={R}
            h={18}
            rings={10}
            top={
              <>
                <i className={s.ticks} />
                <i className={s.ticksMajor} />
                <i className={s.dialFace} />
                <i className={s.sweep} style={{ '--a0': `${newest}deg` } as CSSProperties} />
                <i className={s.hand} style={{ '--a0': `${newest}deg` } as CSSProperties} />
                <i className={s.hub} />
                <i className={s.wave} />
              </>
            }
          />
          {RUNS.map((run, i) => {
            const x = Math.cos(at[i]!) * (R + 30)
            const y = Math.sin(at[i]!) * (R + 30)
            const h = run === 'made' ? 44 : run === 'failed' ? 24 : 10
            return (
              <Box
                key={i}
                x={x - 9}
                y={y - 9}
                w={18}
                d={18}
                h={h}
                tone={run === 'made' ? 'live' : run === 'failed' ? 'warm' : 'paper'}
                className={i === RUNS.length - 1 ? s.fresh : undefined}
              />
            )
          })}
          <i className={s.tether} style={{ left: u(20), top: u(-84), '--tz': 118, '--th': 100 } as CSSProperties} />
          <Box
            x={-130}
            y={-136}
            z={118}
            w={290}
            d={104}
            h={5}
            className={s.bob}
            top={
              <span className={s.auto}>
                <span className={s.autoHead}>
                  <i className={s.clock} />
                  <b>Weekdays at 07:00</b>
                  <em>On</em>
                </span>
                <span className={s.autoAsk}>Review each new pull request</span>
                <span className={s.autoNext}>Next tomorrow at 07:00</span>
              </span>
            }
          />
        </>
      )}
    </World>
  )
}

/* ---- tasks side by side: four floating over the repository, each in a worktree of its own, tethered to main ---- */

const TREES = [
  { task: '431', agent: Agent.Claude, lead: 'Opus 5', x: -132, y: -102, every: 7.2, at: 0.62 },
  { task: '432', agent: Agent.Codex, lead: 'GPT-5.2 Codex', x: 8, y: -102, every: 9.4, at: 0.35 },
  { task: '433', agent: Agent.Gemini, lead: 'Gemini 3 Pro', x: -132, y: 10, every: 8.1, at: 0.8 },
  { task: '434', agent: Agent.Qwen, lead: 'Qwen3 Coder', x: 8, y: 10, every: 10.6, at: 0.15 },
] as const

export function Worktrees({ skin }: { skin: Skin }) {
  return (
    <World
      skin={skin}
      camera={{ tilt: 58, turn: -34, drop: 14 }}
      size={[440, 380]}
      label="Four tasks at once over tally-api, each in a worktree of its own and led by another lab: Opus, GPT, Gemini and Qwen."
    >
      {() => (
        <>
          <Shade x={-180} y={-150} w={360} d={320} soft={1.2} />
          <Box
            x={-150}
            y={-122}
            w={300}
            d={244}
            h={18}
            top={<span className={s.repoTop} />}
            front={
              <span className={s.plinth}>
                <BrandMark brand={Brand.GitHub} size={13} />
                tally-api · main
              </span>
            }
          />
          {TREES.map((tree, i) => (
            <div key={tree.task} className={s.tree} style={{ '--i': i, animationDelay: `${-i * 1.7}s` } as CSSProperties}>
              <i className={s.tether} style={{ left: u(tree.x + 62), top: u(tree.y + 46), '--tz': 96, '--th': 78 } as CSSProperties} />
              <Box
                x={tree.x}
                y={tree.y}
                z={96}
                w={124}
                d={92}
                h={5}
                tone={i === 1 ? 'live' : 'paper'}
                top={
                  <span className={s.treeTop}>
                    <span className={s.treeHead}>
                      <AgentMark agent={tree.agent} size={16} />
                      <b>{tree.task}</b>
                    </span>
                    <span className={s.treeLead}>{tree.lead}</span>
                    <span className={s.meter}>
                      <i
                        className={s.meterTree}
                        style={{ animationDuration: `${tree.every}s`, animationDelay: `${-tree.at * tree.every}s` }}
                      />
                    </span>
                  </span>
                }
              />
            </div>
          ))}
        </>
      )}
    </World>
  )
}

/* ---- workspaces: Linear's, standing side by side, and a project on the ground bound to its own, an issue coming down to it ---- */

const SPACES = [
  { name: 'Northwind', key: 'NOR', bound: true },
  { name: 'Halyard', key: 'HAL', bound: false },
  { name: 'Personal', key: 'YOU', bound: false },
] as const

export function Workspaces({ skin }: { skin: Skin }) {
  const PW = 138
  const PH = 186
  const gap = 26
  const x0 = -((PW * 3 + gap * 2) / 2)
  const py = -96
  const bound = x0 + PW / 2
  return (
    <World
      skin={skin}
      camera={{ tilt: 62, turn: -26, drop: 34 }}
      size={[680, 440]}
      label="Three Linear workspaces side by side, Northwind, Halyard and Personal; the project Tally is bound to Northwind and its issues come in from there."
    >
      {(awake) => (
        <>
          <Shade x={x0 - 40} y={py - 30} w={PW * 3 + gap * 2 + 80} d={90} soft={1} />
          <Shade x={bound - 120} y={60} w={240} d={130} soft={1.2} />
          {SPACES.map((w, i) => (
            <Box
              key={w.name}
              x={x0 + i * (PW + gap)}
              y={py}
              w={PW}
              d={12}
              h={PH}
              tone={w.bound ? 'live' : 'paper'}
              front={
                <span className={s.space} data-bound={w.bound || undefined}>
                  <span className={s.spaceHead}>
                    <BrandMark brand={Brand.Linear} size={15} />
                    <b>{w.name}</b>
                  </span>
                  {[0, 1, 2].map((k) => (
                    <span key={k} className={s.issue}>
                      <em>
                        {w.key}-{14 + i * 9 + k}
                      </em>
                      <i style={{ width: `${70 - k * 14}%` }} />
                    </span>
                  ))}
                </span>
              }
            />
          ))}
          <Ground x={-320} y={-140} w={640} d={380}>
            <path d={`M ${bound} ${py + 22} L ${bound} 76`} className={s.wire} />
            <circle cx={bound} cy={py + 22} r="4" className={s.wireEnd} />
            <path d={`M ${bound + PW + gap} ${py + 22} L ${bound + PW + gap} 94`} className={s.wireQuiet} />
            <circle cx={bound + PW + gap} cy={py + 22} r="3" className={s.wireQuietEnd} />
          </Ground>
          <div className={cx(s.coming, awake && s.comingOn)} style={{ left: u(bound - 30), top: u(py + 20) }}>
            <Box x={0} y={0} w={60} d={34} h={4} tone="live" top={<span className={s.chip}>NOR-14</span>} />
          </div>
          <Box
            x={bound - 110}
            y={78}
            w={220}
            d={96}
            h={16}
            tone="signal"
            top={
              <span className={s.project}>
                <i className={s.projectMark} />
                <b>Tally</b>
                <span>Issues from Northwind</span>
              </span>
            }
          />
          <Box
            x={bound + PW + gap - 70}
            y={96}
            w={206}
            d={72}
            h={12}
            tone="paper"
            top={
              <span className={s.project} data-quiet>
                <i className={s.projectMark} />
                <b>Halyard</b>
                <span>Issues from Halyard</span>
              </span>
            }
          />
        </>
      )}
    </World>
  )
}

/* ---- conflicts settled: a task's change and the default branch disagree over one line; its lead brings them together, and the change is checked again ---- */

export function Conflicts({ skin }: { skin: Skin }) {
  return (
    <World
      skin={skin}
      camera={{ tilt: 58, turn: -34, drop: 40 }}
      size={[600, 420]}
      label="A task’s branch and the default branch change the same line of src/refunds/retry.ts. The task’s lead settles it, keeping both intents, and its checks run again."
    >
      {(awake, still) => <Settle awake={awake} still={still} />}
    </World>
  )
}

const MAIN = ['import { retry } from', '', 'retry(3, { backoff: 2s })', 'export const refund'] as const
const THEIRS = ['import { retry } from', '', 'retry(5, { backoff: after })', 'export const refund'] as const
const BOTH = ['import { retry } from', '', 'retry(5, { backoff: after })', 'export const refund'] as const

function Sheet({ name, lines, mark }: { name: string; lines: readonly string[]; mark: 'old' | 'new' | 'ok' }) {
  return (
    <span className={s.sheet}>
      <span className={s.sheetHead}>
        <em>{name}</em>
        <span>src/refunds/retry.ts</span>
      </span>
      {lines.map((l, k) => (
        <span key={k} className={s.code} data-mark={k === 2 ? mark : undefined}>
          <i>{k + 11}</i>
          {l}
        </span>
      ))}
    </span>
  )
}

function Settle({ awake, still }: { awake: boolean; still: boolean }) {
  // Apart, closing, one, checked, then gone and apart again.
  const beat = useBeat(awake, 1500)
  const phase = still ? 3 : beat % 6
  const apart = phase === 0 || phase === 5
  const closing = phase === 1
  const merged = phase >= 2 && phase <= 4
  const W = 232
  const D = 150
  return (
    <>
      <Shade x={-220} y={-120} w={440} d={300} soft={1.3} />
      <Ground x={-300} y={-200} w={600} d={420}>
        {/* The default branch along the front, the task's branch leaving it and coming back to meet it under the sheets. */}
        <path d="M -260 40 L 220 40" className={s.track} />
        <path d="M -200 40 C -150 40 -150 -50 -100 -50 L -60 -50 C -20 -50 -30 40 0 40" className={s.trackBranch} />
        {[-200, -110, 120, 220].map((x) => (
          <circle key={x} cx={x} cy={40} r="4" className={s.commit} />
        ))}
        <circle cx={-100} cy={-50} r="4" className={s.commitBranch} />
        {merged && <circle key={beat} cx={0} cy={40} r="34" className={s.ripple} />}
        <circle cx={0} cy={40} r="8" className={merged ? s.meetOk : s.meetHot} />
      </Ground>
      <div className={s.sheets} data-phase={apart ? 'apart' : closing ? 'closing' : 'one'} data-gone={phase === 5 || undefined}>
        <div className={cx(s.slab, s.slabMain)}>
          <Box x={-W / 2} y={-D / 2} w={W} d={D} h={5} tone="paper" top={<Sheet name="main" lines={MAIN} mark="old" />} />
        </div>
        <div className={cx(s.slab, s.slabTask)}>
          <Box
            x={-W / 2}
            y={-D / 2}
            w={W}
            d={D}
            h={5}
            tone={merged ? 'live' : 'paper'}
            top={merged ? <Sheet name="settled" lines={BOTH} mark="ok" /> : <Sheet name="task 432" lines={THEIRS} mark="new" />}
          />
        </div>
        <div className={s.badge} data-on={(phase >= 3 && phase <= 4) || undefined}>
          <Box
            x={-100}
            y={-24}
            w={200}
            d={48}
            h={5}
            tone="paper"
            top={
              <span className={s.check}>
                <i />
                Settled by its lead
              </span>
            }
          />
        </div>
      </div>
    </>
  )
}
