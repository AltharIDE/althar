import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'

import {
  BoardCard,
  Brand,
  ChangeSet,
  ChangeState,
  CheckState,
  type CodeHost,
  MergeButton,
  type ModelInfo,
  PullChip,
  SmallChange,
  TaskKind,
  TaskStatus,
  reducedMotion,
} from '@althar/ui'
import { type ReactNode, StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { DIRECTIONS, SETTLE } from './directions'
import { again, configure, land, type Place, press, pressAll, register, type Stage, useStage } from './feel'
import p from './page.module.css'

/*
 * What pressing Merge feels like: keys 0 and A–E pick a direction (and start
 * it over), Space starts it over, M merges the board's four one after
 * another, L lands what is in the queue, Q switches landing on its own or
 * on L, R less motion. ?d=b&reduce&manual&shot opens it so; &shot hides the bar.
 */

const params = new URLSearchParams(location.search)
const SHOT = params.has('shot')
const noop = () => {}
const at = (time: string) => `2026-11-15T${time}:00`
const GITHUB: CodeHost = { name: 'GitHub', brand: Brand.GitHub }
const TERRA: ModelInfo = {
  id: 'gpt-6.1-terra',
  name: 'GPT-6.1 Terra',
  short: 'GPT-6.1 Terra',
  mark: Brand.OpenAI,
  runtime: 'codex',
  efforts: ['Low', 'Medium', 'High'],
}
const open = (stage: Stage) => stage === 'ready' || stage === 'merging'

/** A place that offers Merge, with a layer over it where the feel plays. */
function Feel({ id, place, children }: { id: string; place: Place; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const hold = useRef<HTMLDivElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => register({ id, place, root: root.current!, hold: hold.current!, layer: layer.current! }), [id, place])
  return (
    <div ref={root} className={p.feel}>
      <div ref={hold}>{children}</div>
      <div ref={layer} className={p.layer} aria-hidden="true" />
    </div>
  )
}

/** The small change's card, in its thread, as the person's screenshot has it. */
function Thread() {
  const stage = useStage('thread')
  return (
    <Feel id="thread" place="thread">
      <SmallChange
        title="Changelog shows 0.9.0’s publish time"
        started={at('17:02')}
        changed={{ at: at('17:06'), words: '1 line in apps/site/src/changelog.ts' }}
        checks={{ state: 'passed', passed: 5, total: 5, failing: null, at: at('17:13') }}
        merge={{ state: stage, at: stage === 'merged' ? at('17:21') : null }}
        review={{ when: 'before', state: 'clear', findings: 0, at: at('17:10') }}
        text={{ fullTask: 'Small change', clear: 'Reviewed before Ship' }}
        explain="Starts at once on Sonnet 5.5. GPT-6.1 Terra reads the change before Ship."
        team="Claude Sonnet 5.5 · Low, GPT-6.1 Terra reviews"
        onTeam={noop}
        onMerge={() => press('thread')}
      />
    </Feel>
  )
}

/** The task's change, as its Outputs page has it. */
function Outputs() {
  const stage = useStage('outputs')
  return (
    <Feel id="outputs" place="outputs">
      <ChangeSet
        state={open(stage) ? ChangeState.Ready : stage === 'queued' ? ChangeState.Queued : ChangeState.Merged}
        host={GITHUB}
        prs={[
          {
            repo: 'AltharIDE/althar',
            number: 964,
            url: 'https://github.com/AltharIDE/althar/pull/964',
            files: [
              { path: 'apps/site/src/changelog.ts', add: 1, del: 1 },
              { path: 'apps/site/tests/changelog.test.ts', add: 14, del: 0 },
            ],
          },
        ]}
        checks={['lint', 'types', 'unit', 'e2e', 'CodeQL'].map((name) => ({ id: name, name, state: CheckState.Passed }))}
        review={{ state: CheckState.Passed, by: [TERRA] }}
        {...(open(stage)
          ? {
              actions: (
                <MergeButton variant="signal" busy={stage === 'merging'} onMerge={() => press('outputs')}>
                  Accept and merge
                </MergeButton>
              ),
            }
          : {})}
        onReviewDiff={noop}
      />
    </Feel>
  )
}

const LANE = [
  { id: 'b1', title: 'Usage card drops the time breakdown', number: 767, add: 1, del: 42, at: '2m' },
  { id: 'b2', title: 'Plan usage reads the weekly limit', number: 771, add: 64, del: 9, at: '9m' },
  { id: 'b3', title: 'Tab titles stay on one line', number: 773, add: 12, del: 30, at: '14m' },
  { id: 'b4', title: 'Board lanes keep their scroll', number: 775, add: 88, del: 17, at: '21m' },
] as const

function Card({ card }: { card: (typeof LANE)[number] }) {
  const stage = useStage(card.id)
  return (
    <Feel id={card.id} place="board">
      <BoardCard
        status={open(stage) ? TaskStatus.Yours : stage === 'queued' ? TaskStatus.Running : TaskStatus.Done}
        word={open(stage) ? 'Ready to accept' : stage === 'queued' ? 'In the merge queue' : 'Merged'}
        kind={TaskKind.Change}
        at={card.at}
        title={card.title}
        object={<PullChip host={GITHUB} repo="althar" number={card.number} add={card.add} del={card.del} />}
        next={
          open(stage) && (
            <MergeButton strip busy={stage === 'merging'} aria-label={`Accept and merge #${card.number}`} onMerge={() => press(card.id)}>
              Accept and merge
            </MergeButton>
          )
        }
      />
    </Feel>
  )
}

function Page() {
  const [dirKey, setDir] = useState(
    () => DIRECTIONS.find((d) => d.key === params.get('d') || d.letter.toLowerCase() === params.get('d'))?.key ?? SETTLE.key,
  )
  const [reduce, setReduce] = useState(params.has('reduce'))
  const [auto, setAuto] = useState(!params.has('manual'))
  const dir = DIRECTIONS.find((d) => d.key === dirKey) ?? SETTLE
  configure({ dir, forceReduce: reduce, auto })

  const pick = (key: string) => {
    again()
    setDir(key)
  }
  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('d', dir.letter.toLowerCase())
    for (const [k, on] of [
      ['reduce', reduce],
      ['manual', !auto],
    ] as const)
      if (on) url.searchParams.set(k, '')
      else url.searchParams.delete(k)
    history.replaceState(null, '', url.toString().replaceAll('=&', '&').replace(/=$/, ''))
  }, [dir, reduce, auto])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('textarea, input, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return
      const key = e.key.toLowerCase()
      const d = DIRECTIONS.find((x) => x.letter.toLowerCase() === key)
      if (d !== undefined) pick(d.key)
      else if (key === ' ') {
        // Not the focused button's press: Space starts it over.
        e.preventDefault()
        ;(document.activeElement as HTMLElement | null)?.blur()
        again()
      } else if (key === 'm') pressAll(LANE.map((c) => c.id))
      else if (key === 'l') land()
      else if (key === 'q') setAuto((x) => !x)
      else if (key === 'r') setReduce((x) => !x)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const system = reducedMotion()
  return (
    <div className={p.page} data-shot={SHOT || undefined} data-reduce={reduce || undefined}>
      <header className={p.head}>
        <div className={p.named}>
          <h1>{dir.letter === '0' ? 'Now' : `${dir.letter} · ${dir.name}`}</h1>
          <p>{dir.idea}</p>
        </div>
        <ol className={p.moments}>
          <li>
            <span>Press</span>
            {dir.press}
          </li>
          <li>
            <span>Into the queue</span>
            {dir.queue}
          </li>
          <li>
            <span>Lands</span>
            {dir.land}
          </li>
        </ol>
      </header>
      <main className={p.main}>
        <div className={p.col}>
          <section className={p.place}>
            <h2>In the thread</h2>
            <Thread />
          </section>
          <section className={p.place}>
            <h2>Outputs</h2>
            <Outputs />
          </section>
        </div>
        <section className={p.lane}>
          <h2>
            Board, many at once
            <button type="button" onClick={() => pressAll(LANE.map((c) => c.id))}>
              <kbd>M</kbd> Merge all four
            </button>
          </h2>
          <p className={p.rule}>The first to land after a quiet spell plays in full; the rest settle quietly, one after another.</p>
          <div className={p.cards}>
            {LANE.map((card) => (
              <Card key={card.id} card={card} />
            ))}
          </div>
        </section>
      </main>
      {!SHOT && (
        <nav className={p.bar} aria-label="Directions">
          {DIRECTIONS.map((d) => (
            <button key={d.key} type="button" aria-pressed={d.key === dirKey} onClick={() => pick(d.key)}>
              <kbd>{d.letter}</kbd> {d.name}
            </button>
          ))}
          <span className={p.sep} />
          <button type="button" onClick={again}>
            <kbd>Space</kbd> Again
          </button>
          <button type="button" onClick={() => land()}>
            <kbd>L</kbd> Land now
          </button>
          <button type="button" onClick={() => setAuto((x) => !x)}>
            <kbd>Q</kbd> {auto ? 'Lands on its own' : 'Lands on L'}
          </button>
          <span className={p.sep} />
          <button type="button" aria-pressed={reduce || system} onClick={() => setReduce((x) => !x)}>
            <kbd>R</kbd> {reduce || system ? 'Less motion' : 'Full motion'}
            {system && ' (system)'}
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
