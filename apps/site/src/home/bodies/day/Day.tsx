import { Brand, BrandMark } from '@althar/ui'
import { Launch as Opening } from '@althar/ui/screens'
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'

import { LINKS } from '../../../content/facts'
import { cx } from '../../../lib/cx'
import { Get } from '../../../shared/Close'
import { Handover, HomeWindow, IslandOpen, Launch, Limit, ProjectWindow, SettingsPanel, useAssembling } from '../kit/app'
import { Desktop, EditorWindow, MacWindow, type Wallpaper } from '../kit/Mac'
import { Shot } from '../kit/Shot'
import t from '../kit/type.module.css'
import s from './Day.module.css'

/*
 * A day: one Mac, one working day, played like a short film. The screen
 * stays; the day moves on it, a moment every few seconds while it is in
 * view: the window opening in the morning, the lead putting a team
 * together, a limit handed over without you, a permission answered from
 * the notch while you're in your editor, the screen gone dark at evening
 * with the work still running, and the pull requests waiting in the
 * morning. Each moment is the real app. The times under the screen are
 * how you move through it yourself.
 */

interface Moment {
  at: string
  clock: string
  label: string
  title: ReactNode
  line: string
  wallpaper: Wallpaper
  /** How long it stays, in ms. */
  stays: number
  scene: (active: boolean) => ReactNode
  /** On a phone: the app laid out for a narrow screen, not a Mac's shrunk. */
  phoneScene: (active: boolean) => ReactNode
}

const WINDOW: CSSProperties = { left: 70, top: 26, width: 1300, height: 820 }
/** A phone's picture: a narrow screen, and the window nearly filling it. */
const PHONE = { w: 420, h: 760 }
const PHONE_WINDOW: CSSProperties = { left: 8, top: 10, width: PHONE.w - 16, height: PHONE.h - 32 - 18 }

function Asking({ active, talkOnly = false }: { active: boolean; talkOnly?: boolean }) {
  const steps = useAssembling(active)
  return <ProjectWindow talkOnly={talkOnly} conversation={<Launch steps={steps} />} />
}

const handedOver = (
  <>
    <Limit />
    <Handover after />
  </>
)

const MOMENTS: Moment[] = [
  {
    at: '09:12',
    clock: 'Thu 09:12',
    label: 'Open it',
    title: (
      <>
        Open it <b>in the morning.</b>
      </>
    ),
    line: 'Every project in one window: what needs you on top, what runs under it.',
    wallpaper: 'light',
    stays: 7600,
    scene: (active) => (
      <MacWindow style={WINDOW}>
        {active ? (
          <div style={{ height: '100%' }}>
            <Opening ready>
              <HomeWindow />
            </Opening>
          </div>
        ) : (
          <HomeWindow />
        )}
      </MacWindow>
    ),
    phoneScene: (active) => (
      <MacWindow style={PHONE_WINDOW}>
        {active ? (
          <div style={{ height: '100%' }}>
            <Opening ready>
              <HomeWindow narrow />
            </Opening>
          </div>
        ) : (
          <HomeWindow narrow />
        )}
      </MacWindow>
    ),
  },
  {
    at: '09:15',
    clock: 'Thu 09:15',
    label: 'Say what you want',
    title: (
      <>
        Say what you want. <b>The lead picks the team.</b>
      </>
    ),
    line: 'Opus to write, Codex to dry-run, Sonnet and Gemini to review, and the security review your rule asks for.',
    wallpaper: 'light',
    stays: 7000,
    scene: (active) => (
      <MacWindow style={WINDOW}>
        <Asking active={active} />
      </MacWindow>
    ),
    phoneScene: (active) => (
      <MacWindow style={PHONE_WINDOW}>
        <Asking active={active} talkOnly />
      </MacWindow>
    ),
  },
  {
    at: '11:31',
    clock: 'Thu 11:31',
    label: 'A limit',
    title: (
      <>
        Claude runs out. <b>Codex carries on.</b>
      </>
    ),
    line: 'Same thread, same plan, same branch, on your ChatGPT plan. You didn’t have to be there.',
    wallpaper: 'light',
    stays: 6400,
    scene: () => (
      <MacWindow style={WINDOW}>
        <ProjectWindow conversation={handedOver} />
      </MacWindow>
    ),
    phoneScene: () => (
      <MacWindow style={PHONE_WINDOW}>
        <ProjectWindow talkOnly conversation={handedOver} />
      </MacWindow>
    ),
  },
  {
    at: '14:02',
    clock: 'Thu 14:02',
    label: 'One question',
    title: (
      <>
        In your editor, <b>one question.</b>
      </>
    ),
    line: 'Only what it can’t settle reaches you, round the notch. Answer it there and carry on.',
    wallpaper: 'light',
    stays: 6400,
    scene: () => <EditorWindow style={{ left: 120, top: 50, width: 1200, height: 780 }} />,
    phoneScene: () => <EditorWindow style={{ left: -60, top: 60, width: 640, height: 700 }} />,
  },
  {
    at: '18:40',
    clock: 'Thu 18:40',
    label: 'Go home',
    title: (
      <>
        Go home. <b>It keeps going.</b>
      </>
    ),
    line: 'Three tasks still running: implemented, reviewed by another lab, fixed and reviewed again.',
    wallpaper: 'dark',
    stays: 5600,
    scene: () => null,
    phoneScene: () => null,
  },
  {
    at: '08:30',
    clock: 'Fri 08:30',
    label: 'Next morning',
    title: (
      <>
        Morning. <b>Pull requests, waiting.</b>
      </>
    ),
    line: 'What happened since you looked, and what is ready for you to merge.',
    wallpaper: 'light',
    stays: 7000,
    scene: () => (
      <MacWindow style={WINDOW}>
        <HomeWindow looked="14 h ago" />
      </MacWindow>
    ),
    phoneScene: () => (
      <MacWindow style={PHONE_WINDOW}>
        <HomeWindow narrow looked="14 h ago" />
      </MacWindow>
    ),
  },
]

const island = (i: number) =>
  i === 3 ? <IslandOpen /> : i === 4 ? <IslandOpen open={false} waiting={0} running={3} /> : <IslandOpen open={false} />

const still = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).has('t'))

const useNarrow = () => {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 700px)').matches)
  useEffect(() => {
    const q = window.matchMedia('(max-width: 700px)')
    const on = () => setNarrow(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return narrow
}

export function Day() {
  const narrow = useNarrow()
  const [at, setAt] = useState(() => {
    const n = Number(new URLSearchParams(window.location.search).get('moment'))
    return Number.isInteger(n) && n >= 0 && n < MOMENTS.length ? n : 0
  })
  const [was, setWas] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [held, setHeld] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const moving = !still()

  // Plays while it is in view.
  useEffect(() => {
    const el = stage.current
    if (!el || !moving) return
    const io = new IntersectionObserver(([e]) => setPlaying(e?.isIntersecting ?? false), { threshold: 0.45 })
    io.observe(el)
    return () => io.disconnect()
  }, [moving])

  const go = (i: number) => {
    setWas(at)
    setAt(i)
  }

  useEffect(() => {
    if (!playing || held) return
    const timer = window.setTimeout(() => go((at + 1) % MOMENTS.length), MOMENTS[at]!.stays)
    return () => window.clearTimeout(timer)
  })

  // The one it left fades out, then goes.
  useEffect(() => {
    if (was === null) return
    const timer = window.setTimeout(() => setWas(null), 700)
    return () => window.clearTimeout(timer)
  }, [was])

  const now = MOMENTS[at]!
  const shown = [...new Set([was, at].filter((x): x is number => x !== null))]

  return (
    <main id="main" tabIndex={-1} className={s.body}>
      <section className={s.film} aria-labelledby="day-h">
        <div className={s.head}>
          <p className={t.kicker}>
            <i aria-hidden="true" />A day with Althar
          </p>
          <div className={s.captions} aria-live="polite">
            {MOMENTS.map((m, i) => (
              <div key={m.at} className={cx(s.caption, i === at && s.on)} aria-hidden={i !== at}>
                <h2 id={i === at ? 'day-h' : undefined} className={t.title}>
                  {m.title}
                </h2>
                <p className={t.lead}>{m.line}</p>
              </div>
            ))}
          </div>
        </div>

        <div ref={stage} className={s.stage} onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
          <div className={s.bezel}>
            <div className={s.layers}>
              {shown.map((i) => {
                const m = MOMENTS[i]!
                return (
                  <div key={i} className={cx(s.layer, i === at ? s.in : s.out)}>
                    {narrow ? (
                      <Shot
                        w={i === 3 ? 480 : PHONE.w}
                        h={i === 3 ? (480 * PHONE.h) / PHONE.w : PHONE.h}
                        label={`${m.at}: ${m.label}`}
                        frame={s.screen}
                      >
                        <Desktop
                          compact
                          wallpaper={m.wallpaper}
                          clock={m.clock.slice(4)}
                          app={i === 3 ? 'Code' : 'Althar'}
                          island={island(i)}
                        >
                          {m.phoneScene(i === at)}
                        </Desktop>
                      </Shot>
                    ) : (
                      <Shot w={1440} h={900} label={`${m.at}: ${m.label}`} frame={s.screen}>
                        <Desktop wallpaper={m.wallpaper} clock={m.clock} app={i === 3 ? 'Code' : 'Althar'} island={island(i)}>
                          {m.scene(i === at)}
                        </Desktop>
                      </Shot>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <ol className={s.moments}>
          {MOMENTS.map((m, i) => (
            <li key={m.at}>
              <button
                type="button"
                className={cx(s.moment, i === at && s.current, i < at && s.past)}
                aria-current={i === at ? 'step' : undefined}
                onClick={() => go(i)}
              >
                <span className={s.track}>
                  <i
                    key={`${at}-${i}`}
                    style={
                      { animationDuration: `${m.stays}ms`, animationPlayState: playing && !held ? 'running' : 'paused' } as CSSProperties
                    }
                  />
                </span>
                <time>{m.at}</time>
                <span>{m.label}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className={s.now}>
          {now.at} · {now.label}
        </p>
      </section>

      <SetUp />

      <section className={s.end} aria-labelledby="end-h">
        <h2 id="end-h" className={cx(t.title, t.big)}>
          Tomorrow, <b>bring all of them.</b>
        </h2>
        <p className={t.lead}>Claude Code, Codex and OpenCode, on the plans you already have. Free and open source.</p>
        <Get tone="paper" />
        <footer className={s.foot}>
          <a href={LINKS.repo}>GitHub</a>
          <a href="/thesis">Thesis</a>
          <a href="/shifts">Shifts</a>
          <span>macOS first</span>
        </footer>
      </section>
    </main>
  )
}

/* ---- set up once: Settings, the Control Center, with what each part is for beside it ---- */

const NOTES = [
  {
    title: 'Every account you have',
    body: 'Two Claude plans, three Codex accounts, a key and a coding plan for OpenCode. Work goes to whichever has room.',
  },
  {
    title: 'Your hosts and trackers',
    body: 'GitHub, GitLab and Bitbucket, self-hosted too. Linear, Jira and Trello.',
    marks: [Brand.GitHub, Brand.GitLab, Brand.Bitbucket, Brand.Linear, Brand.Jira, Brand.Trello],
  },
  {
    title: 'The rest is a switch',
    body: 'Keep the Mac awake while work runs. Talk instead of typing. Round the notch, or in the menu bar.',
  },
]

function SetUp() {
  return (
    <section className={s.setup} aria-labelledby="setup-h">
      <div className={s.setupHead}>
        <p className={t.kicker}>
          <i aria-hidden="true" />
          Set up once
        </p>
        <h2 id="setup-h" className={t.title}>
          The whole setup. <b>One panel.</b>
        </h2>
      </div>
      <div className={s.annotated}>
        <div className={s.panels}>
          <div className={s.glance}>
            <Shot
              w={440}
              label="Settings at a glance: agents and their accounts, code hosts and trackers, the app icon, and two switches"
              maxScale={1.15}
              frame={s.settingsFrame}
            >
              <SettingsPanel />
            </Shot>
          </div>
          <div className={s.detail}>
            <Shot
              w={900}
              phoneW={440}
              label="The agents opened out: Codex with three accounts, and its models"
              maxScale={1}
              frame={s.settingsFrame}
            >
              <SettingsPanel open="agents" agent="codex" />
            </Shot>
          </div>
        </div>
        <ol className={s.notes}>
          {NOTES.map((n, i) => (
            <li key={n.title}>
              <span className={s.n}>{String(i + 1).padStart(2, '0')}</span>
              <b>{n.title}</b>
              <span>{n.body}</span>
              {n.marks && (
                <span className={s.noteMarks}>
                  {n.marks.map((m) => (
                    <BrandMark key={m} brand={m} size={16} />
                  ))}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
