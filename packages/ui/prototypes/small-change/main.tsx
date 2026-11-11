import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'

import { Button, ChangeSet, ChangeState, CheckState, SmallChange, type SmallChangeStep } from '@althar/ui'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { CALM, type Direction } from './calm'
import { type SmallState, SOL, SONNET, STATES } from './states'
import p from './page.module.css'

/*
 * The small change's card, a few directions: keys 0 and A–D swap the
 * direction, T the theme, 1–9 and - = pick the state the thread column shows.
 * The grid draws every state of the direction at once; the column beside it
 * draws the picked one in a thread, between the plan card and the Change card.
 * ?d=a&theme=dark&s=3 opens it so; &shot hides the bar, for screenshots;
 * &only=grid or &only=thread draws one of the two.
 */

/** Today's card, from the kit, in each state, as the runtime would give it. */
function nowSteps(s: SmallState): SmallChangeStep[] {
  const failed = s.key === 'failed'
  return [
    { key: 'started', what: 'Started', at: `2026-11-11T${s.started}:00`, done: true },
    {
      key: 'changed',
      what: s.changed ? `Changed ${s.files} files` : 'Changed',
      at: s.changed ? `2026-11-11T${s.changed}:00` : null,
      done: s.changed !== undefined,
    },
    {
      key: 'checks',
      what: failed ? 'Checks failed' : 'Checks pass',
      at: s.checked ? `2026-11-11T${s.checked}:00` : null,
      done: s.checked !== undefined,
    },
    { key: 'merged', what: 'Merged', at: s.merged ? `2026-11-11T${s.merged}:00` : null, done: s.merged !== undefined },
  ]
}

function Now({ state: s }: { state: SmallState }) {
  const isMerged = s.merged !== undefined
  const review = isMerged || s.key === 'full' ? { title: `Review #${s.pr}: ${s.title}`, onOpen: () => {} } : null
  return (
    <SmallChange
      title={s.title}
      model={SONNET.name}
      skips={['no plan', 'reviewed after it merges']}
      steps={nowSteps(s)}
      change={s.files === undefined ? null : { name: `PR #${s.pr}`, state: isMerged ? 'merged' : 'open' }}
      review={review}
      fullTask={s.key === 'full'}
      busy={s.key === 'merging'}
      {...(s.key === 'ready' || s.key === 'merging' ? { onMerge: () => {} } : {})}
      onMakeFullTask={() => {}}
    />
  )
}

const NOW: Direction = {
  key: 'now',
  letter: '0',
  name: 'Now',
  idea: 'The card as it is today, from the kit.',
  Card: Now,
}

const ALL: readonly Direction[] = [NOW, ...CALM]
const params = new URLSearchParams(location.search)
const SHOT = params.has('shot')
const ONLY = params.get('only')
const STATE_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '-', '=']

/* The card opens the thread; the Change card of another task under it, for the family. */
function Neighbours({ dir, state }: { dir: Direction; state: SmallState }) {
  return (
    <div className={p.thread}>
      <dir.Card key={dir.key + state.key} state={state} />
      <ChangeSet
        state={ChangeState.Ready}
        prs={[
          {
            repo: 'AltharIDE/althar',
            number: 765,
            url: 'https://github.com/AltharIDE/althar/pull/765',
            files: [
              { path: 'packages/ui/src/composer/ContextRing/ContextRing.tsx', add: 88, del: 61 },
              { path: 'packages/ui/src/composer/ContextRing/ContextRing.module.css', add: 40, del: 52 },
              { path: 'packages/ui/tests/ContextRing.test.tsx', add: 120, del: 0 },
            ],
          },
        ]}
        checks={[
          { id: 'lint', name: 'lint', state: CheckState.Passed },
          { id: 'unit', name: 'unit', state: CheckState.Passed },
        ]}
        review={{ state: CheckState.Passed, by: [SOL] }}
        actions={
          <Button size="small" variant="signal" onClick={() => {}}>
            Accept and merge
          </Button>
        }
        onReviewDiff={() => {}}
      />
    </div>
  )
}

function Page() {
  const [dirKey, setDir] = useState(() => ALL.find((d) => d.key === params.get('d'))?.key ?? 'a')
  const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light')
  const [live, setLive] = useState(() => Math.max(0, Number(params.get('s') ?? 5) - 1))
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
      const i = STATE_KEYS.indexOf(key)
      if (d) setDir(d.key)
      else if (key === 't') setTheme((x) => (x === 'dark' ? 'light' : 'dark'))
      else if (i >= 0 && i < STATES.length) setLive(i)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  return (
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
                <dir.Card key={dir.key} state={s} />
              </figure>
            ))}
          </section>
        )}
        {ONLY !== 'grid' && (
          <aside className={p.side}>
            <p className={p.sideHead}>
              In a thread · <strong>{state.label}</strong>
            </p>
            <Neighbours dir={dir} state={state} />
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
            <kbd>1–9 - =</kbd> {state.label}
          </span>
          <span className={p.sep} />
          <button type="button" onClick={() => setTheme((x) => (x === 'dark' ? 'light' : 'dark'))}>
            <kbd>T</kbd> {theme === 'dark' ? 'Dark' : 'Light'}
          </button>
        </nav>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
