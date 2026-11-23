import { useLayoutEffect, useRef } from 'react'

import { useMedia } from '../../lib/browser'
import { useDownload } from '../../lib/download'
import { MARK_DOTS, MARK_EYE } from '../hero/markDots'
import { Rings } from '../hero/Rings'
import s from './Race.module.css'
import { RACE } from './scenes'
import { useScrolled } from './scroll'

/*
 * The race, before the board, pinned and played by the scroll.
 *
 * First a timeline of the year: a new top model every month or so, from one
 * lab then another, and above it the context you build up in a tool,
 * growing, then greyed out and left behind each time you move to the next.
 * Then it hands over to Althar above the race: the project's own context in
 * a ring round the mark, a line running down from it, and each new model
 * branching in for a while and fading as the next arrives. Last, the
 * heading and the branches go, the core moves onto the first screen's
 * orrery (the same rings and agents, the project's notes on its inner
 * orbit) and the models fly into its orbits, under the download.
 *
 * Narrower than a tablet, or with reduced motion, nothing is pinned: the
 * timeline and the branch stand one under the other, whole, and scroll
 * sideways if they need to.
 */

/** The timeline's months, January to September: the year so far. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']
const at = (month: number) => `${((month / 9) * 100).toFixed(3)}%`

/** The context built up in each tool: grown, then left behind at the switch to the next (the last still in use). */
const SEGMENTS = [
  'M0 200 Q50 138.6 100 99.1 L100 200',
  'M100 200 Q216.5 56.9 333 32.8 L333 200',
  'M333 200 Q473 28 613 28 L718 28 L718 200',
  'M718 200 Q809 88.2 900 49.1 L900 200',
]
/** The tool you were in, and when you moved into it and out of it, in months. */
const TOOLS = [
  { name: 'Claude Code', from: 0, to: 1 },
  { name: 'Codex', from: 1, to: 3.33 },
  { name: 'Claude Code', from: 3.33, to: 7.18 },
  { name: 'OpenCode', from: 7.18, to: null },
]
/** The top models as they shipped, in months, on two rows. */
const MODELS = [
  { t: 1, name: 'GPT-5.3 Codex' },
  { t: 2, name: 'GPT-5.4', low: true },
  { t: 3.33, name: 'Opus 4.7' },
  { t: 4.7, name: 'Opus 4.8', low: true },
  { t: 5.1, name: 'Fable 5' },
  { t: 6.6, name: 'Opus 5', low: true },
  { t: 7.85, name: 'Fable 5.1' },
  { t: 8.55, name: 'Opus 5.5', low: true, last: true },
]

/** The models as branches off Althar's line, one after another down it, left and right; and the orbit and angle each flies to at the end. */
const BRANCHES = [
  { name: 'GPT-5.3 Codex', when: 'OpenAI · Feb', orbit: 3, deg: 206 },
  { name: 'GPT-5.4', when: 'OpenAI · Mar', orbit: 3, deg: 344 },
  { name: 'Claude Opus 4.7', when: 'Apr', orbit: 2, deg: 148 },
  { name: 'Claude Opus 4.8', when: 'May', orbit: 2, deg: 24 },
  { name: 'Claude Fable 5', when: 'Jun', orbit: 2, deg: 222 },
  { name: 'Claude Opus 5', when: 'Jul', orbit: 1, deg: 316 },
  { name: 'Claude Fable 5.1', when: 'Aug', orbit: 1, deg: 162 },
  { name: '19 open-weight models', when: 'Jan–Sep', orbit: 0, deg: 52 },
  { name: 'Claude Opus 5.5', when: 'Sep', orbit: 0, deg: 232, now: true },
  { name: 'Next month’s model', when: '', orbit: 3, deg: 58, next: true },
]
const LEFT = (i: number) => i % 2 === 0
const branchY = (i: number) => 168 + i * 36

/** The project's context, round the core: on the inner ring, and as words beside it. */
const NOTES = ['Repo rules', 'Decisions', 'The plan', 'Review notes', 'Open task']
const SATELLITES = [
  [-93.8, 21],
  [-104.6, -10.8],
  [-54.2, -36.3],
  [54.2, -36.3],
  [104.6, -10.8],
]
const WORDS: ReadonlyArray<{ side: 'left' | 'right'; x: number; y: number }> = [
  { side: 'right', x: 281.8, y: 90 },
  { side: 'right', x: 292.6, y: 58 },
  { side: 'right', x: 242.2, y: 32.7 },
  { side: 'left', x: 242.2, y: 32.7 },
  { side: 'left', x: 292.6, y: 58 },
]

/** The orbits the models fly to, as the first screen's orrery has them (its 3rd to 6th). */
const RINGS = [
  [318, 123],
  [420, 162],
  [540, 208],
  [680, 262],
] as const

const clamp = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (v: number) => v * v * (3 - 2 * v)
const all = (root: Element, q: string) => [...root.querySelectorAll<HTMLElement | SVGElement>(q)]

/** Draws the race at `p`, 0 to 1. Unpinned (`live` false), it clears what the scroll set and stands whole. */
function draw(sec: HTMLElement, p: number, live: boolean) {
  const one = <T extends Element>(q: string) => sec.querySelector<T>(q)!
  const A = one<HTMLElement>('[data-before]')
  const B = one<HTMLElement>('[data-after]')
  const moved = [A, B, ...all(sec, '[data-moved]')]
  sec.toggleAttribute('data-live', live)
  if (!live) {
    for (const el of moved) el.removeAttribute('style')
    for (const el of all(sec, '[data-t], [data-seg], [data-tool], [data-bi]')) {
      el.toggleAttribute('data-on', true)
      el.removeAttribute('data-orb')
    }
    for (const el of all(sec, '[data-seg], [data-tool]')) el.toggleAttribute('data-lost', el.dataset.last === undefined)
    for (const el of all(sec, '[data-bi]')) el.toggleAttribute('data-gone', Number(el.dataset.bi) < 7)
    one<SVGRectElement>('[data-clip]').setAttribute('width', '900')
    one<HTMLElement>('[data-line]').style.setProperty('--x', '100%')
    return
  }

  // 0–0.46 builds the timeline, January to September (T, in months); 0.46–0.55 hands over; 0.53–0.82 grows the branch; 0.84–0.96 the last beat.
  const a = clamp(p / 0.46)
  const b = clamp((p - 0.53) / 0.29)
  const k = smooth(clamp((p - 0.84) / 0.12))
  const T = a * 9
  const out = smooth(clamp((p - 0.46) / 0.045))
  const inn = smooth(clamp((p - 0.5) / 0.05))
  A.style.opacity = (1 - out).toFixed(3)
  A.style.transform = `translateY(${(-36 * out).toFixed(1)}px)`
  A.style.pointerEvents = out > 0.5 ? 'none' : ''
  B.style.opacity = inn.toFixed(3)
  B.style.transform = `translateY(${(28 * (1 - inn)).toFixed(1)}px)`
  B.style.pointerEvents = inn > 0.5 ? 'auto' : 'none'

  one<HTMLElement>('[data-line]').style.setProperty('--x', `${(a * 100).toFixed(3)}%`)
  for (const el of all(sec, '[data-t]')) el.toggleAttribute('data-on', T >= Number(el.dataset.t))
  one<SVGRectElement>('[data-clip]').setAttribute('width', (a * 900).toFixed(1))
  all(sec, '[data-seg]').forEach((g, i) => g.toggleAttribute('data-lost', TOOLS[i]!.to !== null && T >= TOOLS[i]!.to!))
  all(sec, '[data-tool]').forEach((el, i) => {
    el.toggleAttribute('data-on', T >= TOOLS[i]!.from + 0.12)
    el.toggleAttribute('data-lost', TOOLS[i]!.to !== null && T >= TOOLS[i]!.to!)
  })

  const core = one<HTMLElement>('[data-core]')
  core.toggleAttribute('data-on', b > 0.02)
  one<SVGPathElement>('[data-trunk]').style.strokeDashoffset = (1 - clamp((b - 0.12) / 0.4)).toFixed(3)
  for (const el of all(sec, '[data-bi]')) {
    const i = Number(el.dataset.bi)
    const from = 0.28 + i * 0.075
    el.toggleAttribute('data-on', b >= from)
    el.toggleAttribute('data-gone', i < 7 && b >= from + 0.15)
  }

  // The last beat: the core moves onto the orrery and hands over to it, the heading gives way to the closing line, and the models fly into its orbits.
  const branch = one<HTMLElement>('[data-branch]').getBoundingClientRect()
  const room = B.getBoundingClientRect()
  const fin = one<HTMLElement>('[data-fin]')
  const W = branch.width
  const zone = 44 + fin.offsetHeight + 24
  const scale = Math.min(1, (room.width + 100) / 1400, (room.height - zone - 16) / 560)
  const middle = zone + (room.height - zone) / 2
  const cx = room.left - branch.left + room.width / 2
  const cy = room.top - branch.top + middle
  const orr = one<HTMLElement>('[data-orrery]')
  orr.style.top = `${middle.toFixed(1)}px`
  orr.style.transform = `scale(${scale.toFixed(4)})`
  const move = smooth(clamp(k / 0.6))
  const orrIn = smooth(clamp((k - 0.45) / 0.45))
  const fade = smooth(clamp((k - 0.2) / 0.5))
  const f = scale / 0.7222
  const ty = cy + 2.5 * scale + 2 * f
  core.style.transform =
    move > 0
      ? `translate(${((cx - W / 2) * move).toFixed(1)}px, ${((ty - 80) * move).toFixed(1)}px) scale(${(1 + (f - 1) * move).toFixed(3)})`
      : ''
  core.style.opacity = k > 0 ? (1 - orrIn).toFixed(3) : ''
  for (const w of all(sec, '[data-word]')) w.style.opacity = k > 0 ? (1 - fade).toFixed(3) : ''
  orr.style.opacity = orrIn.toFixed(3)
  one<SVGSVGElement>('[data-lines]').style.opacity = (1 - move).toFixed(3)
  const headOut = smooth(clamp(k / 0.22))
  const finIn = smooth(clamp((k - 0.17) / 0.25))
  const head = one<HTMLElement>('[data-head]')
  head.style.opacity = (1 - headOut).toFixed(3)
  head.style.transform = headOut > 0 ? `translateY(${(-60 * headOut).toFixed(1)}px)` : ''
  fin.style.opacity = finIn.toFixed(3)
  fin.style.transform = `translateY(${(16 * (1 - finIn)).toFixed(1)}px)`
  fin.style.pointerEvents = finIn > 0.5 ? 'auto' : 'none'
  for (const el of all(sec, '[data-lab]')) {
    const i = Number(el.dataset.lab)
    const m = BRANCHES[i]!
    const [rx, ry] = RINGS[m.orbit]!
    const th = (m.deg * Math.PI) / 180
    const ax = W / 2 + (LEFT(i) ? -196 : 196)
    const ay = branchY(i) - 2
    const tx = cx + rx * scale * Math.cos(th)
    const tyy = cy + 10 * scale + ry * scale * Math.sin(th)
    el.style.transform = move > 0 ? `translate(${((tx - ax) * move).toFixed(1)}px, ${((tyy - ay) * move).toFixed(1)}px)` : ''
    el.style.opacity = k > 0 ? (1 - fade).toFixed(3) : ''
    el.toggleAttribute('data-orb', k > 0.15)
  }
}

export function Race() {
  const box = useRef<HTMLElement>(null)
  const narrow = useMedia('(max-width: 900px)')
  const download = useDownload()
  const live = useRef(false)
  const still = useScrolled(box, { pin: narrow ? 0 : 4.4 }, (p) => {
    if (box.current) draw(box.current, p, live.current)
  })
  useLayoutEffect(() => {
    live.current = !narrow && !still
  })

  return (
    <section ref={box} id="race" className={s.race} aria-labelledby="race-h">
      <div className={s.stick} data-stick="">
        <div className={s.wrap}>
          <div className={s.before} data-before="">
            <div className={s.head}>
              <h2 id="race-h" className={s.title}>
                {RACE.before.title}
              </h2>
              <p className={s.lead}>{RACE.before.lead}</p>
            </div>
            <div className={s.scroll}>
              <div className={s.line} role="img" aria-label={RACE.before.label} data-line="">
                <p className={s.key} aria-hidden="true">
                  <span>
                    <i className={s.k1} />
                    {RACE.key[0]}
                  </span>
                  <span>
                    <i className={s.k2} />
                    {RACE.key[1]}
                  </span>
                </p>
                <svg className={s.chart} viewBox="0 0 900 200" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <clipPath id="race-clip">
                      <rect data-clip="" x="0" y="0" width="900" height="200" />
                    </clipPath>
                  </defs>
                  <g clipPath="url(#race-clip)">
                    {SEGMENTS.map((d, i) => (
                      <g
                        key={d}
                        className={s.seg}
                        data-seg=""
                        data-last={i === SEGMENTS.length - 1 || undefined}
                        data-lost={i < SEGMENTS.length - 1 || undefined}
                      >
                        <path className={s.area} d={`${d} Z`} />
                        <path className={s.stroke} d={d} />
                      </g>
                    ))}
                  </g>
                </svg>
                {TOOLS.map((tool, i) => (
                  <span
                    key={i}
                    className={s.tool}
                    data-tool=""
                    data-on=""
                    data-last={tool.to === null || undefined}
                    data-lost={tool.to !== null || undefined}
                    style={{ left: at(tool.from) }}
                  >
                    {tool.name}
                  </span>
                ))}
                <div className={s.base} />
                {MONTHS.map((m, i) => (
                  <span key={m}>
                    <span className={s.tick} style={{ left: at(i) }} />
                    <span className={s.month} style={{ left: at(i) }}>
                      {m}
                    </span>
                  </span>
                ))}
                <div className={s.fill} />
                {MODELS.map((m) => (
                  <span key={m.name}>
                    <span className={s.dot} data-t={m.t} data-on="" style={{ left: at(m.t) }} />
                    <span
                      className={s.model}
                      data-t={m.t}
                      data-on=""
                      data-low={m.low || undefined}
                      data-last={m.last || undefined}
                      style={{ left: at(m.t) }}
                    >
                      {m.name}
                    </span>
                  </span>
                ))}
                <div className={s.now} />
              </div>
            </div>
          </div>

          <div className={s.after} data-after="">
            <div className={s.head} data-head="">
              <h2 className={s.title}>{RACE.after.title}</h2>
              <p className={s.lead}>{RACE.after.lead}</p>
            </div>
            <div className={s.scroll}>
              <div className={s.branch} role="img" aria-label={RACE.after.label} data-branch="">
                <svg className={s.lines} viewBox="-400 0 800 500" aria-hidden="true" data-lines="">
                  <path className={s.trunk} pathLength={1} d="M0 140 L0 500" data-trunk="" />
                  {BRANCHES.map((m, i) => {
                    const y = branchY(i)
                    const side = LEFT(i) ? -1 : 1
                    return (
                      <g key={m.name} className={m.next ? s.next : s.fork} data-bi={i} data-on="" data-gone={i < 7 || undefined}>
                        <path pathLength={1} d={`M0 ${y - 18} C0 ${y - 6} ${30 * side} ${y} ${70 * side} ${y} L${196 * side} ${y}`} />
                        <circle cx={196 * side} cy={y} r="3.5" />
                      </g>
                    )
                  })}
                </svg>
                {BRANCHES.map((m, i) => (
                  <div
                    key={m.name}
                    className={s.lab}
                    data-bi={i}
                    data-lab={i}
                    data-moved=""
                    data-on=""
                    data-gone={i < 7 || undefined}
                    data-side={LEFT(i) ? 'left' : 'right'}
                    data-next={m.next || undefined}
                    style={{ top: branchY(i) - 8 }}
                  >
                    <s className={s.pt} />
                    <b>{m.name}</b>
                    {m.when && <span>{m.when}</span>}
                    {m.now && <i>Now</i>}
                  </div>
                ))}
                <div className={s.core} data-core="" data-on="" data-moved="">
                  <svg className={s.coreSvg} viewBox="-180 -75 360 150" aria-hidden="true">
                    <ellipse className={s.ring} cx="0" cy="0" rx="108.3" ry="41.9" />
                    {SATELLITES.map(([x, y]) => (
                      <circle key={`${x},${y}`} className={s.sat} cx={x} cy={y} r="2.6" data-word="" />
                    ))}
                    <svg x="-65" y="-58" width="130" height="112" viewBox="-90 -85 180 155">
                      <g fill="var(--cobalt)">
                        {Array.from({ length: MARK_DOTS.length / 3 }, (_, d) => (
                          <circle key={d} cx={MARK_DOTS[d * 3]!} cy={MARK_DOTS[d * 3 + 1]!} r={MARK_DOTS[d * 3 + 2]!} />
                        ))}
                        <circle cx={MARK_EYE.x} cy={MARK_EYE.y} r={MARK_EYE.r} />
                      </g>
                    </svg>
                  </svg>
                  {NOTES.map((note, i) => (
                    <span key={note} className={s.word} data-word="" style={{ [WORDS[i]!.side]: WORDS[i]!.x, top: WORDS[i]!.y }}>
                      {note}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            {/* The first screen's orrery, with the project's notes on its inner orbit: where the core and the models end up. */}
            <div className={s.orrery} aria-hidden="true" data-orrery="" data-moved="">
              <Rings className={s.rings} notes={NOTES} />
            </div>
            <div className={s.fin} data-fin="" data-moved="">
              <p className={s.title}>{RACE.end}</p>
              <a className={s.get} href={download.href}>
                {download.pending ? 'Download' : download.label}
                <svg
                  aria-hidden="true"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 4v12M6 11l6 6 6-6M5 20h14" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
