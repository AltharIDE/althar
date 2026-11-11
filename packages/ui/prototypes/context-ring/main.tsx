import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'

import { Composer, ContextRing, ModelPick, Popover, UsageLines } from '@althar/ui'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import ring from '../../src/composer/ContextRing/ContextRing.module.css'
import pop from '../../src/primitives/Popover/Popover.module.css'
import { DIRECTIONS, type Direction, NOW, percentOf, Ring } from './directions'
import { type CardState, STATES } from './states'
import p from './page.module.css'

/*
 * The context ring card, a few directions: keys 0 and A–D swap the direction,
 * 1–8 the state of the live composer at the foot, T the theme. The grid draws
 * every state of the direction at once. ?d=a&theme=dark&s=3 opens it so;
 * &shot hides the composer and the bar, for screenshots.
 */

const ALL: readonly Direction[] = [NOW, ...DIRECTIONS]
const params = new URLSearchParams(location.search)
const SHOT = params.has('shot')
/** Opens the live card from the start, for a screenshot of it in place. */
const OPEN = params.has('open')
/** Where the grid shows a direction's other view: what folds open, or the usage tab. */
const OPENED = new Set(['several', 'estimate', 'long'])

function Live({ dir, state }: { dir: Direction; state: CardState }) {
  const [compacting, setCompacting] = useState(false)
  useEffect(() => {
    if (!compacting) return
    const done = setTimeout(() => setCompacting(false), 4000)
    return () => clearTimeout(done)
  }, [compacting])
  const s = { ...state, compacting: state.compacting === true || compacting }
  const compact = () => setCompacting(true)
  const clear = () => {}
  if (dir.key === 'now')
    return (
      <ContextRing
        used={s.used}
        total={s.total}
        model={s.model}
        onCompact={compact}
        compacting={s.compacting}
        onClear={clear}
        defaultOpen={OPEN}
        {...(s.usage === undefined ? {} : { usage: <UsageLines lines={s.usage.lines} heading={s.usage.heading} /> })}
      />
    )
  return (
    <Popover
      hover
      label="Context"
      placement="above"
      align="end"
      width={dir.width(s)}
      defaultOpen={OPEN}
      trigger={
        <button type="button" className={ring.ring} aria-label={`Context ${percentOf(s)}% used`}>
          <Ring pct={s.used / s.total} />
        </button>
      }
    >
      <dir.Card state={s} onCompact={compact} onClear={clear} />
    </Popover>
  )
}

function Page() {
  const [dirKey, setDir] = useState(() => ALL.find((d) => d.key === params.get('d'))?.key ?? 'a')
  const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light')
  const [live, setLive] = useState(() => Math.max(0, Number(params.get('s') ?? 1) - 1))
  const [text, setText] = useState('')
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
      const t = e.target as HTMLElement
      if (t.closest('textarea, input, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key.toLowerCase()
      const d = ALL.find((x) => x.letter.toLowerCase() === key)
      if (d) setDir(d.key)
      else if (key === 't') setTheme((x) => (x === 'dark' ? 'light' : 'dark'))
      else if (/^[1-8]$/.test(key)) setLive(Number(key) - 1)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const noop = () => {}
  return (
    <div className={p.page} data-shot={SHOT || undefined}>
      <header className={p.head}>
        <h1>{dir.letter === '0' ? 'Now' : `${dir.letter} · ${dir.name}`}</h1>
        <p>{dir.idea}</p>
      </header>
      <main className={p.grid}>
        {STATES.map((s, i) => (
          <figure key={s.key} className={p.cell} data-live={i === live || undefined}>
            <figcaption>
              <button type="button" onClick={() => setLive(i)}>
                <span>{i + 1}</span> {s.label}
              </button>
            </figcaption>
            <div className={`${pop.panel} ${pop.padded} ${p.surface}`} style={{ width: dir.width(s) }}>
              <dir.Card key={dir.key} state={s} onCompact={noop} onClear={noop} opened={OPENED.has(s.key)} />
            </div>
          </figure>
        ))}
      </main>
      {!SHOT && (
        <footer className={p.foot}>
          <div className={p.composer}>
            <Composer
              value={text}
              onChange={setText}
              onSubmit={() => setText('')}
              placeholder="Tell the lead"
              picker={
                <ModelPick
                  model={state.model}
                  pinned={[]}
                  effort="High"
                  defaultEffort="High"
                  owner="Lead"
                  onChange={noop}
                  onEffort={noop}
                />
              }
              meter={<Live key={`${dir.key}-${state.key}`} dir={dir} state={state} />}
            />
          </div>
          <nav className={p.bar} aria-label="Directions">
            {ALL.map((d) => (
              <button key={d.key} type="button" aria-pressed={d.key === dirKey} onClick={() => setDir(d.key)}>
                <kbd>{d.letter}</kbd> {d.name}
              </button>
            ))}
            <span className={p.sep} />
            <span className={p.liveState}>
              <kbd>1–8</kbd> {state.label}
            </span>
            <span className={p.sep} />
            <button type="button" onClick={() => setTheme((x) => (x === 'dark' ? 'light' : 'dark'))}>
              <kbd>T</kbd> {theme === 'dark' ? 'Dark' : 'Light'}
            </button>
          </nav>
        </footer>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
