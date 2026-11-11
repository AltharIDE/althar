import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type { ThreadItem } from '@althar/contracts'
import { TaskFace, Thread, ThreadShellProvider } from '@althar/ui'

import { ServicesProvider } from '../../src/renderer/data/services'
import { blocksOf } from '../../src/renderer/shared/thread'
import { ThreadBlocks } from '../../src/renderer/shared/ThreadBlocks'
import { ago } from '../../src/renderer/shared/time'
import { servicesFor } from '../../tests/render'
import { fakeClient, fakeHost, items } from '../../tests/fixtures'
import { describe } from './runtime'
import { type Direction, DIRECTIONS, type OfferState, PlanCard, type Shown } from './directions'
import { proposed, today, type Verdict } from './rules'
import { SCENARIOS } from './scenarios'
import p from './page.module.css'

/*
 * Prototype: the coordinator's offer to keep parts as a preset. Keys: 0 and
 * A–D the direction, 1–4 the scenario, Q W E R the offer's state, T the
 * theme. 0 is today's, through the app's own thread code; A–D answer to the
 * proposed rules, shown working on each scenario's setups beside the thread.
 * ?d=a&s=3&st=offer&theme=dark opens it so; &shot hides the bar.
 */

const params = new URLSearchParams(location.search)
const SHOT = params.has('shot')
const STATES: ReadonlyArray<{ key: OfferState; letter: string; label: string }> = [
  { key: 'offer', letter: 'Q', label: 'Offered' },
  { key: 'editing', letter: 'W', label: 'Editing the name' },
  { key: 'kept', letter: 'E', label: 'Kept' },
  { key: 'dismissed', letter: 'R', label: 'Dismissed' },
]
const NOW = {
  key: '0',
  letter: '0',
  name: 'Today',
  idea: 'As it reaches the window now: the runtime’s offer is dropped on the way, so a plain line with nothing to press.',
}
const ALL: ReadonlyArray<Omit<Direction, 'Thread'> & { Thread?: Direction['Thread'] }> = [NOW, ...DIRECTIONS]
/** When the page opened, for the thread's times. */
const OPENED = new Date().toISOString()

const services = servicesFor(fakeClient().client, fakeHost())
const shell = {}
const session = { agentId: 'claude-code', model: 'claude-opus-5-5', account: null }

/** What the person asked and the coordinator's answer, through the app's own blocks; today's line too, where it fires. */
function Said({ asked, title, line }: { asked: string; title: string; line: ThreadItem | null }) {
  const blocks = useMemo(() => {
    const thread: ThreadItem[] = [items.you(asked), items.says(`Planned it as task 812, **${title}**. It starts when the countdown ends.`)]
    return blocksOf({ items: line === null ? thread : [...thread, line], turnRunning: false, worktree: null }, new Map(), ago, OPENED)
  }, [asked, title, line])
  return <ThreadBlocks blocks={blocks} threadId="coordinator" session={session} />
}

/** Today's notice, as `offerPreset` adds it and `Queries` reads it back: its offer isn't copied, so the window never gets it. */
function todaysLine(verdict: Verdict): ThreadItem | null {
  if (verdict.kind !== 'offer') return null
  const said = items.says('')
  return {
    ...said,
    agentId: null,
    kind: 'notice',
    content: {
      source: 'runtime',
      severity: 'info',
      title: 'You set up these parts twice. Keep them as a preset?',
      description: `${verdict.name}: ${describe(verdict.parts)}.`,
    },
  } as ThreadItem
}

const BY = {
  coordinator: 'The coordinator’s plan, as proposed',
  corrected: 'The coordinator’s plan; you ',
  person: 'You set it up',
} as const

function Verdicts({ was, now }: { was: Verdict; now: Verdict }) {
  return (
    <>
      <div className={p.verdict}>
        <strong>Today’s rule</strong>
        <p>
          {was.kind === 'offer' ? (
            <>
              Offers <code>{was.name}</code>. {was.why}
            </>
          ) : (
            `Nothing. ${was.why}`
          )}
        </p>
      </div>
      <div className={p.verdict}>
        <strong>Proposed rules</strong>
        <p>
          {now.kind === 'offer' ? (
            <>
              Offers “{now.name}”. {now.why}
            </>
          ) : now.kind === 'near' ? (
            <>
              Says it’s {now.preset.name}. {now.why}
            </>
          ) : (
            `Nothing. ${now.why}`
          )}
        </p>
      </div>
    </>
  )
}

function Page() {
  const [dirKey, setDir] = useState(() => ALL.find((d) => d.key === params.get('d'))?.key ?? 'c1')
  const [scene, setScene] = useState(() => Math.max(0, Math.min(SCENARIOS.length, Number(params.get('s') ?? 3)) - 1))
  const [state, setState] = useState<OfferState>(() => STATES.find((one) => one.key === params.get('st'))?.key ?? 'offer')
  const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light')
  const scenario = SCENARIOS[scene] ?? SCENARIOS[0]!
  const was = today(scenario.setups)
  const now = proposed(scenario.setups)
  // The name as the person typed it, by scenario; until then, the plain one, or a typed one while the state shown is editing.
  const [typed, setTyped] = useState<Readonly<Record<string, string>>>({})
  const plain = now.kind === 'offer' ? now.name : ''
  const name = typed[scenario.key] ?? (state === 'editing' && plain !== '' ? 'Quick local fix' : plain)
  const setName = (value: string) => setTyped((was) => ({ ...was, [scenario.key]: value }))

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('d', dirKey)
    url.searchParams.set('s', String(scene + 1))
    url.searchParams.set('st', state)
    url.searchParams.set('theme', theme)
    history.replaceState(null, '', url)
  }, [dirKey, scene, state, theme])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable], [role="menu"]') || event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      const d = ALL.find((one) => one.letter.toLowerCase() === key)
      const st = STATES.find((one) => one.letter.toLowerCase() === key)
      const n = Number(key)
      if (d !== undefined) setDir(d.key)
      else if (st !== undefined) setState(st.key)
      else if (key === 't') setTheme((x) => (x === 'dark' ? 'light' : 'dark'))
      else if (n >= 1 && n <= SCENARIOS.length) setScene(n - 1)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const dir = ALL.find((d) => d.key === dirKey) ?? ALL[0]!
  const Offer = dir.Thread
  const last = scenario.setups.at(-1)!
  const planPreset = last.by === 'person' ? 'Change' : 'Change'
  const shown: Shown | null = now.kind === 'none' ? null : now

  return (
    <div className={p.page} data-shot={SHOT || undefined}>
      <header className={p.head}>
        <h1>{dir.letter === '0' ? 'Today' : `${dir.letter} · ${dir.name}`}</h1>
        <p>{dir.idea}</p>
      </header>
      <main className={p.main}>
        <TaskFace className={p.face} composer={<div className={p.composer}>Ask the coordinator</div>}>
          <Thread label="Coordinator">
            <ThreadShellProvider value={shell}>
              <div className={p.stack}>
                <Said asked={scenario.asked} title={scenario.title} line={null} />
                {Offer !== undefined ? (
                  shown === null ? (
                    <PlanCard title={scenario.title} parts={last.parts} preset={planPreset} />
                  ) : (
                    <Offer
                      key={`${dir.key}-${scenario.key}`}
                      verdict={shown}
                      state={state}
                      setState={setState}
                      name={name}
                      setName={setName}
                      title={scenario.title}
                      planParts={last.parts}
                      planPreset={planPreset}
                    />
                  )
                ) : (
                  <>
                    <PlanCard title={scenario.title} parts={last.parts} preset={planPreset} />
                    <TodayLine verdict={was} />
                  </>
                )}
              </div>
            </ThreadShellProvider>
          </Thread>
        </TaskFace>
        <aside className={p.rules}>
          <h2>{scenario.label}: the plans that started</h2>
          <ol className={p.setups}>
            {scenario.setups.map((one, at) => (
              <li key={at}>
                <b>{one.title}</b>
                <span className={p.by} data-by={one.by}>
                  {BY[one.by]}
                  {one.by === 'corrected' ? one.changed : ''} · {describe(one.parts)}
                </span>
              </li>
            ))}
          </ol>
          <Verdicts was={was} now={now} />
        </aside>
      </main>
      <nav className={p.bar} aria-label="Directions, scenarios, states">
        {ALL.map((d) => (
          <button key={d.key} type="button" aria-pressed={d.key === dirKey} onClick={() => setDir(d.key)}>
            <kbd>{d.letter}</kbd>
            {d.name}
          </button>
        ))}
        <span className={p.sep} />
        {SCENARIOS.map((one, at) => (
          <button key={one.key} type="button" aria-pressed={at === scene} onClick={() => setScene(at)}>
            <kbd>{at + 1}</kbd>
            {one.label}
          </button>
        ))}
        <span className={p.sep} />
        {STATES.map((one) => (
          <button key={one.key} type="button" aria-pressed={one.key === state} onClick={() => setState(one.key)}>
            <kbd>{one.letter}</kbd>
            {one.label}
          </button>
        ))}
        <span className={p.sep} />
        <button type="button" onClick={() => setTheme((x) => (x === 'dark' ? 'light' : 'dark'))}>
          <kbd>T</kbd>
          {theme === 'dark' ? 'Dark' : 'Light'}
        </button>
      </nav>
    </div>
  )
}

/** Today's line, drawn by the app's own blocks. */
function TodayLine({ verdict }: { verdict: Verdict }) {
  const line = todaysLine(verdict)
  const blocks = line === null ? [] : blocksOf({ items: [line], turnRunning: false, worktree: null }, new Map(), ago, OPENED)
  return <ThreadBlocks blocks={blocks} threadId="coordinator-today" session={session} />
}

const root = document.getElementById('root')
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <ServicesProvider value={services}>
        <Page />
      </ServicesProvider>
    </StrictMode>,
  )
