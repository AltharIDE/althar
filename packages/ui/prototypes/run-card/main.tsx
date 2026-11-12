import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'

import { CanvasLine, HoverCardProvider, RunCard, StartedTask, TaskStatus, Thread, You } from '@althar/ui'
import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { type CardProps, DIRECTIONS, type Direction } from './directions'
import { type RunState, STATES, whyOf } from './states'
import p from './page.module.css'

/*
 * A calmer card for a running project, a few directions: keys 0 and A–D swap
 * the direction, T the theme, 1–7 the state the thread beside the grid
 * starts at. The grid draws every state of the direction at once, at a narrow
 * thread's width; the thread draws the picked one among its neighbours, and
 * there Stop, Run again and the address do what they would: it stops, starts
 * again and comes up. ?d=a&theme=dark&s=3 opens it so; &shot hides the bar,
 * for screenshots; &only=grid or &only=thread draws one of the two.
 */

/** Today's card, from the kit, as the app gives it a run (runCardOf). */
function Now({ state: s, onOpen, onStop, onRunAgain }: CardProps) {
  const last = whyOf(s)
  const ended =
    s.phase === 'stopped'
      ? { code: null, stopped: true }
      : s.phase === 'failed' || s.phase === 'finished'
        ? { code: s.code ?? null, stopped: false, ...(last === undefined ? {} : { last }) }
        : undefined
  return (
    <RunCard
      where={s.where}
      {...(s.name === undefined ? {} : { name: s.name })}
      command={s.command}
      {...(s.phase === 'up' && s.url !== undefined ? { url: s.url } : {})}
      since={s.since}
      {...(ended === undefined ? {} : { ended })}
      {...(onOpen === undefined ? {} : { onOpen })}
      {...(onStop === undefined ? {} : { onStop })}
      {...(onRunAgain === undefined ? {} : { onRunAgain })}
      className={p.now}
    />
  )
}

const NOW: Direction = { key: 'now', letter: '0', name: 'Now', idea: 'The card as it is today, from the kit.', Card: Now }
const ALL: readonly Direction[] = [NOW, ...DIRECTIONS]

const params = new URLSearchParams(location.search)
const SHOT = params.has('shot')
const ONLY = params.get('only')
const STATE_KEYS = ['1', '2', '3', '4', '5', '6', '7']
const noop = () => {}

/** The picked state, played: Stop stops it, Run again starts it and it comes up, as the runtime would. */
function usePlayed(start: RunState) {
  const [state, setState] = useState(start)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    setState(start)
    return () => window.clearTimeout(timer.current)
  }, [start])
  const up = STATES.find((s) => s.key === (start.name === undefined ? 'unnamed' : 'up'))!
  return {
    state,
    onStop: () => setState((s) => ({ ...s, phase: 'stopped', since: 'just now', code: null })),
    onRunAgain: () => {
      setState((s) => ({ ...s, phase: 'starting', url: undefined, since: '0s', lines: undefined, why: undefined }))
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(
        () =>
          setState((s) => ({ ...up, name: s.name, command: s.command, where: s.where, place: s.place, started: 'just now' }) as RunState),
        1600,
      )
    },
  }
}

/** The picked card in a thread, among the cards around it: what the person asked, a canvas, a task a lead started. */
function InThread({ dir, start }: { dir: Direction; start: RunState }) {
  const played = usePlayed(start)
  const [opened, setOpened] = useState<string | null>(null)
  const project = start.place === 'project'
  return (
    <div className={p.threadWrap}>
      <p className={p.sideHead}>
        {project ? 'The project’s conversation' : 'A task’s thread, under its header:'} <strong>{project ? 'althar' : start.where}</strong>
      </p>
      <Thread label="Thread" className={p.thread}>
        <You at="2:40 pm">Run it so I can click around.</You>
        <CanvasLine
          canvas={{ canvasId: 'c1', name: 'small-change', title: 'Small change card, four directions', kind: 'html', version: 3 }}
          action="published"
        />
        <dir.Card
          key={dir.key + start.key}
          state={played.state}
          onOpen={() => setOpened(played.state.url ?? null)}
          onStop={played.onStop}
          onRunAgain={played.onRunAgain}
        />
        {project && (
          <StartedTask
            title="Review a pull request: Launch screen loses its startup status"
            tone={TaskStatus.Running}
            word="Working"
            detail="4m"
          />
        )}
      </Thread>
      {opened !== null && (
        <p className={p.opened}>
          Opens <code>{opened}</code> beside the conversation.{' '}
          <button type="button" onClick={() => setOpened(null)}>
            Close
          </button>
        </p>
      )}
    </div>
  )
}

function Page() {
  const [dirKey, setDir] = useState(() => ALL.find((d) => d.key === params.get('d'))?.key ?? 'a')
  const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light')
  const [live, setLive] = useState(() => Math.min(STATES.length - 1, Math.max(0, Number(params.get('s') ?? 2) - 1)))
  const dir = ALL.find((d) => d.key === dirKey) ?? NOW
  const state = STATES[live] ?? STATES[0]!

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('d', dirKey)
    url.searchParams.set('theme', theme)
    url.searchParams.set('s', String(live + 1))
    history.replaceState(null, '', url)
  }, [dirKey, theme, live])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('textarea, input, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key.toLowerCase()
      const d = ALL.find((x) => x.letter.toLowerCase() === key)
      const i = STATE_KEYS.indexOf(key)
      if (d) setDir(d.key)
      else if (key === 't') setTheme((x) => (x === 'dark' ? 'light' : 'dark'))
      else if (i >= 0 && i < STATES.length) setLive(i)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  return (
    <HoverCardProvider>
      <div className={p.page} data-shot={SHOT || undefined}>
        <header className={p.head}>
          <h1>{dir.letter === '0' ? 'Now' : `${dir.letter} · ${dir.name}`}</h1>
          <p>{dir.idea}</p>
        </header>
        <main className={p.main} data-only={ONLY ?? undefined}>
          {ONLY !== 'thread' && (
            <section className={p.grid}>
              {STATES.map((s, i) => (
                <figure key={s.key} className={p.cell} data-live={i === live || undefined}>
                  <figcaption>
                    <button type="button" onClick={() => setLive(i)}>
                      <span>{STATE_KEYS[i]}</span> {s.label}
                    </button>
                  </figcaption>
                  <dir.Card key={dir.key} state={s} onOpen={noop} onStop={noop} onRunAgain={noop} />
                </figure>
              ))}
            </section>
          )}
          {ONLY !== 'grid' && (
            <aside className={p.side}>
              <InThread dir={dir} start={state} />
            </aside>
          )}
        </main>
        {!SHOT && (
          <nav className={p.bar} aria-label="Directions">
            {ALL.map((d) => (
              <button key={d.key} type="button" aria-pressed={d.key === dirKey} onClick={() => setDir(d.key)}>
                <kbd>{d.letter}</kbd> {d.name}
              </button>
            ))}
            <span className={p.sep} />
            <span className={p.liveState}>
              <kbd>1–7</kbd> {state.label}
            </span>
            <span className={p.sep} />
            <button type="button" onClick={() => setTheme((x) => (x === 'dark' ? 'light' : 'dark'))}>
              <kbd>T</kbd> {theme === 'dark' ? 'Dark' : 'Light'}
            </button>
          </nav>
        )}
      </div>
    </HoverCardProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
