import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'

import { BackCrumb, BoardCard, ProjectTabs, SmallChange, TaskHeader, TaskKind, TaskStatus, TitleBar } from '@althar/ui'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { MARKED } from '../../src/fixtures/marks'
import { force, TAKES, type Take, useTyped, withCaret } from './typed'
import p from './page.module.css'

/*
 * A renamed title types itself in: keys A–C swap the take, N has the agent
 * rename the task (the next title), R replays it, P is the person renaming
 * (shows at once), M forces reduced motion, T the theme.
 * Everything below is the kit's own header, tab, board card and thread
 * card; only the title string they are given is typed.
 * ?d=b&theme=dark opens it so; &shot hides the bar.
 */

const params = new URLSearchParams(location.search)
const SHOT = params.has('shot')
const TITLES = [
  'Repair token refresh on privilege change',
  'Repair token refresh when a role is demoted',
  'Fix stale sessions after a role change',
  'Sessions follow role changes at once',
]
const noop = () => {}
const iso = '2026-11-11T09:10:00'

interface Named {
  title: string
  by: 'agent' | 'person'
  at: number
}

function Surface({
  label,
  who,
  small,
  take,
  named,
  tick,
  children,
}: {
  label: string
  who: string
  small?: boolean
  take: Take
  named: Named
  tick: boolean
  children: (title: string) => ReactNode
}) {
  const typed = useTyped(named.title, named.by, named.at, take, small)
  const pulse = small && take.small === 'pulse' && named.by === 'agent' && named.at > 0
  return (
    <figure className={p.fig}>
      <figcaption>
        {label}
        {typed.typing &&
          take.signed &&
          (small && label.startsWith('Tab') ? (
            <span className={p.dot} title={who} />
          ) : (
            <span className={p.who}>
              <i />
              {who} is typing
            </span>
          ))}
      </figcaption>
      <div className={pulse ? p.pulse : p.surface} key={pulse ? named.at : 'still'}>
        {children(withCaret(typed, take, tick))}
      </div>
    </figure>
  )
}

function Page() {
  const [key, setKey] = useState(() => TAKES.find((t) => t.key === params.get('d'))?.key ?? 'plain')
  const [theme, setTheme] = useState(params.get('theme') === 'dark' ? 'dark' : 'light')
  const [named, setNamed] = useState<Named>({ title: TITLES[0]!, by: 'person', at: 0 })
  const [reduce, setReduce] = useState(false)
  const [tick, setTick] = useState(true)
  const take = TAKES.find((t) => t.key === key) ?? TAKES[0]!
  force.reduced = reduce

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    const id = setInterval(() => setTick((x) => !x), 480)
    return () => clearInterval(id)
  }, [])

  const next = (by: 'agent' | 'person') =>
    setNamed((n) => ({ title: TITLES[(TITLES.indexOf(n.title) + 1) % TITLES.length]!, by, at: n.at + 1 }))
  const replay = useCallback(() => {
    setNamed((n) => ({ title: TITLES[0]!, by: 'person', at: n.at + 1 }))
    setTimeout(() => setNamed((n) => ({ title: TITLES[1]!, by: 'agent', at: n.at + 1 })), 700)
  }, [])
  useEffect(() => {
    if (params.has('auto')) replay()
  }, [replay])
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('d', key)
    url.searchParams.set('theme', theme)
    history.replaceState(null, '', url)
  }, [key, theme])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      const t = TAKES.find((x) => x.letter.toLowerCase() === k)
      if (t) setKey(t.key)
      else if (k === 'n') next('agent')
      else if (k === 'r') replay()
      else if (k === 'p') next('person')
      else if (k === 'm') setReduce((x) => !x)
      else if (k === 't') setTheme((x) => (x === 'dark' ? 'light' : 'dark'))
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [replay])

  const who = 'Opus 5.5'
  const common = { who, take, named, tick }
  return (
    <div className={p.page} data-shot={SHOT || undefined}>
      <header className={p.head}>
        <h1>
          {take.letter} · {take.name}
        </h1>
        <p>{take.idea}</p>
      </header>
      <main className={p.main}>
        <div className={p.row}>
          <Surface label="Task header" {...common}>
            {(title) => (
              <div className={p.wide}>
                <TitleBar
                  lights="none"
                  end={<TaskHeader title={title} status={TaskStatus.Running} state="Implementing" took="4m" elapsed="12m" />}
                >
                  <BackCrumb to="meridian" kbd="esc" title={title} titleLevel={1} onBack={noop} />
                </TitleBar>
              </div>
            )}
          </Surface>
        </div>
        <div className={p.row}>
          <Surface label="Tab (too small)" small {...common}>
            {(title) => (
              <div className={p.wide}>
                <ProjectTabs
                  lights="none"
                  tabs={MARKED.slice(0, 2).map((m) => ({ id: m.id, name: m.name, seed: m.id, ink: m.ink, running: m.running, yours: 0 }))}
                  current="task_1"
                  onSelect={noop}
                  onClose={noop}
                  pages={[{ id: 'task_1', title, current: true, onSelect: noop, onClose: noop }]}
                />
              </div>
            )}
          </Surface>
        </div>
        <div className={p.row}>
          <Surface label="Board card" {...common}>
            {(title) => (
              <div className={p.lane}>
                <BoardCard status={TaskStatus.Running} word="Implementing" kind={TaskKind.Change} at="4m" title={title} onOpen={noop} />
              </div>
            )}
          </Surface>
          <Surface label="Board card, narrow lane (too small)" small {...common}>
            {(title) => (
              <div className={p.narrow}>
                <BoardCard status={TaskStatus.Running} word="Implementing" kind={TaskKind.Change} at="4m" title={title} onOpen={noop} />
              </div>
            )}
          </Surface>
          <Surface label="Thread card" {...common}>
            {(title) => (
              <div className={p.thread}>
                <SmallChange
                  title={title}
                  started={iso}
                  changed={{ at: null, words: null }}
                  checks={{ state: 'waiting', passed: 0, total: 0, failing: null, at: null }}
                  merge={{ state: 'waiting', at: null }}
                  review={{ when: 'after', state: 'waiting', findings: 0, at: null }}
                  explain="Starts at once, with no plan."
                  onMerge={noop}
                />
              </div>
            )}
          </Surface>
        </div>
        <p className={p.note}>
          Reduced motion {reduce ? 'is forced on: every title shows at once' : 'follows the system; M forces it'}. A rename the person made
          (P) never plays.
        </p>
      </main>
      {!SHOT && (
        <nav className={p.bar} aria-label="Takes">
          {TAKES.map((t) => (
            <button key={t.key} type="button" aria-pressed={t.key === key} onClick={() => setKey(t.key)}>
              <kbd>{t.letter}</kbd> {t.name}
            </button>
          ))}
          <span className={p.sep} />
          <button type="button" onClick={() => next('agent')}>
            <kbd>N</kbd> Agent renames
          </button>
          <button type="button" onClick={replay}>
            <kbd>R</kbd> Replay
          </button>
          <button type="button" onClick={() => next('person')}>
            <kbd>P</kbd> Person renames
          </button>
          <span className={p.sep} />
          <button type="button" aria-pressed={reduce} onClick={() => setReduce((x) => !x)}>
            <kbd>M</kbd> Reduced motion
          </button>
          <button type="button" onClick={() => setTheme((x) => (x === 'dark' ? 'light' : 'dark'))}>
            <kbd>T</kbd> {theme === 'dark' ? 'Dark' : 'Light'}
          </button>
        </nav>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Page />)
