import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { Component, createRef, type ReactNode, StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'

import {
  Behind,
  Composer,
  Goal,
  Icon,
  LiveDot,
  Markdown,
  MergeLine,
  MergingLine,
  mergingLineText,
  MOTION,
  type MergingRow,
  type ModelInfo,
  type RunningProcess,
  Segmented,
  TaskFace,
  Thread,
  ThreadShellProvider,
  Turn,
  You,
} from '@althar/ui'

import { coordinatorSigned } from '../../src/renderer/shared/signed'
import { foldedOf, type Moment, rowsOf, type Where } from './data'
import s from './lab.module.css'
import { play, type Shot, shoot } from './morph'

/*
 * The pinned merge lab (README.md): the merge line held above the composer as
 * a pill, so it stays in view while the thread scrolls on, opening into a card
 * of its pull requests. The bar along the bottom, or its keys, swaps what is
 * shown in place; the address keeps what is chosen, for shots.
 */

type Direction = 'now' | 'first' | 'pill'
const DIRECTIONS: ReadonlyArray<{ value: Direction; label: string; kbd: string }> = [
  { value: 'now', label: 'Today', kbd: '0' },
  { value: 'first', label: 'Pill, first pass', kbd: 'F' },
  { value: 'pill', label: 'Pill', kbd: 'A' },
]
const MOMENTS: ReadonlyArray<{ value: Moment; label: string; kbd: string }> = [
  { value: 'one', label: 'One', kbd: '1' },
  { value: 'several', label: 'Several', kbd: '2' },
  { value: 'back', label: 'Sent back', kbd: '3' },
  { value: 'merged', label: 'All merged', kbd: '4' },
]
const WHERES: ReadonlyArray<{ value: Where; label: string; kbd: string }> = [
  { value: 'coordinator', label: 'Coordinator', kbd: 'T' },
  { value: 'task', label: 'Task', kbd: 'T' },
]

interface Chosen {
  d: Direction
  m: Moment
  w: Where
  open: boolean
  narrow: boolean
  up: boolean
  dark: boolean
}

const params = new URLSearchParams(location.search)
const pick = <T extends string>(value: string | null, from: ReadonlyArray<{ value: T }>, fallback: T): T =>
  from.some((one) => one.value === value) ? (value as T) : fallback
const first: Chosen = {
  d: pick(params.get('d'), DIRECTIONS, 'pill'),
  m: pick(params.get('m'), MOMENTS, 'several'),
  w: pick(params.get('w'), WHERES, 'coordinator'),
  open: params.get('open') === '1',
  narrow: params.get('narrow') === '1',
  up: params.get('up') !== '0',
  dark: params.get('theme') === 'dark',
}
const remember = (c: Chosen) => {
  const p = new URLSearchParams({ d: c.d, m: c.m, w: c.w, open: c.open ? '1' : '0', narrow: c.narrow ? '1' : '0', up: c.up ? '1' : '0' })
  if (c.dark) p.set('theme', 'dark')
  history.replaceState(null, '', `?${p}`)
}

const OPUS: ModelInfo = { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', short: 'Opus 5.5', runtime: 'claude-code', efforts: [] }
const SITE_RUN: RunningProcess = {
  id: 'site',
  name: 'Site dev server',
  command: 'node_modules/.bin/vp dev',
  url: 'localhost:5173',
  since: '41m',
}
const noop = () => {}

/* ——— The thread, long enough that what was asked has scrolled away ——— */

const P = (text: string) => <Markdown source={text} />

function CoordinatorThread({ moment, folded, foot }: { moment: Moment; folded: boolean; foot: ReactNode }) {
  const asked = moment === 'one' ? 'Merge #1232 once it’s green.' : 'See everything through to main.'
  const reply =
    moment === 'one'
      ? '#1232 is green and in the merge queue. I’ll tell you if it comes back.'
      : 'Three are green and going in one after another: #1232, #1168 and #1270. Workers readiness joins them once its checks pass. I’ll keep an eye on them and tell you if one comes back.'
  return (
    <>
      <You at="14:52">Where are we with the release branches?</You>
      <Turn {...coordinatorSigned} at="14:52">
        {P(
          '**Release branches** is in review: the cascade into main works, and the review asked for one more test, which its lead added. #1168 is green.\n\n**Site release notes** is done, #1270, waiting for you.',
        )}
      </Turn>
      <You at="14:58">{asked}</You>
      <Turn {...coordinatorSigned} at="14:59" copy={reply}>
        {P(reply)}
        {folded && <MergeLine rows={foldedOf('coordinator').slice(0, moment === 'one' ? 1 : undefined)} />}
      </Turn>
      <You at="15:04">While that goes: why did the board show Workers readiness as blocked this morning?</You>
      <Turn {...coordinatorSigned} at="15:05">
        {P(
          'It waited on **Workers: a doctor per project**, which merged at 9:40. The board read the old state for a few minutes because its refresh had stopped after the laptop slept.\n\nThat refresh is fixed on main since #1229; you won’t see it again after the next update.',
        )}
      </Turn>
      <You at="15:11">Ok. Draft a task for the merge line: I want it to stay in view.</You>
      <Turn {...coordinatorSigned} at="15:12">
        {P(
          'Drafted **Prototype: the merge line pinned above the composer**. It reads the end-gap task first, since that changes how the thread clears what floats on the composer.\n\n- Prototype preset, no review\n- Opus 5.5 at xhigh, as your note says for a few directions\n\nIt starts in 30 seconds unless you hold it.',
        )}
      </Turn>
      <You at="15:16">And what’s left on Mobile this week?</You>
      <Turn {...coordinatorSigned} at="15:17">
        {P(
          'Two things:\n\n1. **Composer clears the phone’s home bar**: in review, one finding left.\n2. **Pairing a second Mac**: running, about half done.\n\nNothing waits on you there.',
        )}
      </Turn>
      {foot}
    </>
  )
}

function TaskThread({ moment, folded, foot }: { moment: Moment; folded: boolean; foot: ReactNode }) {
  const reply =
    moment === 'one'
      ? 'Shipped. #1232 is in the merge queue; I’ll say if it comes back.'
      : 'Shipped. #1232 is in the merge queue, and mobile #41 goes in once its checks pass.'
  return (
    <>
      <Turn model={OPUS} at="14:31">
        {P(
          'Both flakies come from the same race: `changesMergeNeeds` read the branch before the merge had written it, and `backToWork` resumed a session the test had already closed.\n\n- The merge read waits for the write it follows\n- The test closes its session last\n\nI ran each test 200 times on one worker; neither failed.',
        )}
      </Turn>
      <You at="14:40">Nice. Ship it, and merge it once it’s green.</You>
      <Turn model={OPUS} at="14:41" copy={reply}>
        {P(reply)}
        {folded && <MergeLine rows={foldedOf('task').slice(0, moment === 'one' ? 1 : undefined)} />}
      </Turn>
      <You at="14:47">While it goes: is the same race anywhere else?</You>
      <Turn model={OPUS} at="14:49">
        {P(
          'One more place reads a branch right after writing it: **settle** in `runtime/src/tasks/settle.ts`. It hasn’t failed in CI, but it can, the same way.\n\nIt’s outside this task, so it’s in my report rather than fixed here.',
        )}
      </Turn>
      <You at="14:55">Fine. How long did the stress runs take?</You>
      <Turn model={OPUS} at="14:55">
        {P('About four minutes each, on one worker: 200 runs of each test, 1.2 seconds a run.')}
      </Turn>
      {foot}
    </>
  )
}

/* ——— The pill's marks: a check for what merged, a live dot while it runs, a ring for what waits, a cross for what came back ——— */

const tone = (row: MergingRow) =>
  row.state === 'merged'
    ? s.merged
    : row.state === 'sent_back' || row.state === 'conflict'
      ? s.back
      : row.state === 'checks' || row.state === 'merging'
        ? s.live
        : undefined
const later = (row: MergingRow) => row.url === null || row.once !== undefined
const said = (row: MergingRow) => (later(row) && row.state === 'waiting' ? mergingLineText.later : mergingLineText.state[row.state])

function Mark({ row }: { row: MergingRow }) {
  switch (row.state) {
    case 'merged':
      return <Icon name="check" size={11} />
    case 'checks':
    case 'merging':
      return <LiveDot ping />
    case 'sent_back':
    case 'conflict':
      return <Icon name="close" size={11} />
    default:
      return <span className={later(row) ? s.ringFaint : s.ring} aria-hidden="true" />
  }
}

/* ——— First pass: the chip as first shown, swapped for the line's card when opened ——— */

function FirstChip({ rows, open, onOpen }: { rows: MergingRow[]; open: boolean; onOpen: (open: boolean) => void }) {
  if (open)
    return (
      <div
        className={s.firstCard}
        // Its head folds it back to the chip.
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('button[aria-controls]') !== null) {
            event.stopPropagation()
            onOpen(false)
          }
        }}
      >
        <MergingLine rows={rows} open />
      </div>
    )
  return (
    <button type="button" className={s.chip} aria-expanded={false} onClick={() => onOpen(true)}>
      <span className={s.chipName}>Merging</span>
      {rows.map((row) => (
        <span key={row.key} className={[s.token, tone(row), later(row) ? s.later : ''].join(' ')} title={row.label}>
          <span className={s.mark}>
            <Mark row={row} />
          </span>
          <span className={s.tokenLabel}>{row.label}</span>
        </span>
      ))}
    </button>
  )
}

/* ——— The pill: one line on the composer's edge, beside what else floats there; opened, it grows into a card of its pull requests ——— */

/**
 * Reads where everything on the composer's edge stands just before `step`
 * changes, and glides it from there once it has (morph.ts). A class, as only a
 * class hears of a change before the page is: getSnapshotBeforeUpdate.
 */
class Morph extends Component<{ step: string; children: ReactNode }> {
  private ref = createRef<HTMLDivElement>()
  private scope = () => this.ref.current?.closest<HTMLElement>('[class*="Composer-module__floats"]') ?? null
  override getSnapshotBeforeUpdate(was: Readonly<{ step: string }>): Shot | null {
    return was.step === this.props.step ? null : shoot(this.scope())
  }
  override componentDidUpdate(_was: unknown, _state: unknown, shot: Shot | null) {
    if (shot !== null) play(shot, this.scope())
  }
  override render() {
    return (
      <div ref={this.ref} className={s.contents}>
        {this.props.children}
      </div>
    )
  }
}

function Pill({ rows, open, onOpen, leaving }: { rows: MergingRow[]; open: boolean; onOpen: (open: boolean) => void; leaving: boolean }) {
  const pill = useRef<HTMLButtonElement>(null)
  const head = useRef<HTMLButtonElement>(null)
  const card = useRef<HTMLDivElement>(null)
  // Focus follows what was pressed into what it became.
  const handed = useRef(false)
  const toggle = (next: boolean) => {
    handed.current = true
    onOpen(next)
  }
  useEffect(() => {
    if (!handed.current) return
    handed.current = false
    ;(open ? head : pill).current?.focus({ preventScroll: true })
  }, [open])
  // Escape folds it back, from anywhere but a field.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (event.target instanceof HTMLElement && event.target.closest('textarea, input, [contenteditable]')) return
      event.preventDefault()
      toggle(false)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })
  // It arrives from --scale-pop with a fade, as an overlay grows from what opened it; it goes the same way, quicker.
  useLayoutEffect(() => {
    const el = open ? card.current : pill.current
    el?.animate(
      [
        { opacity: 0, transform: 'scale(0.96)' },
        { opacity: 1, transform: 'none' },
      ],
      MOTION.enter,
    )
    // Only as it first shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!open)
    return (
      <button
        ref={pill}
        type="button"
        className={[s.pill, leaving ? s.going : ''].join(' ')}
        aria-expanded={false}
        aria-label={`Merging: ${rows.map((row) => `${row.label} ${said(row).toLowerCase()}`).join(', ')}`}
        onClick={() => toggle(true)}
        data-m-ghost=""
      >
        <span className={s.surface} data-m-box="merge" />
        <span className={s.pillName} data-m="name">
          Merging
        </span>
        {rows.map((row) => (
          <span key={row.key} className={[s.token, tone(row), later(row) ? s.later : ''].join(' ')}>
            <span className={s.mark} data-m={`mark-${row.key}`} data-m-at="center">
              <Mark row={row} />
            </span>
            <span className={s.tokenLabel} data-m={`label-${row.key}`}>
              {row.label}
            </span>
          </span>
        ))}
      </button>
    )

  return (
    <section ref={card} className={[s.card, leaving ? s.going : ''].join(' ')} aria-label="Merging" data-m-ghost="">
      <span className={s.surface} data-m-box="merge" />
      <button ref={head} type="button" className={s.head} aria-expanded onClick={() => toggle(false)}>
        <span className={s.headName} data-m="name">
          Merging
        </span>
        <span className={s.fold} data-m-in="">
          <Icon name="chevronD" size={12} />
        </span>
      </button>
      <ol className={s.rows}>
        {rows.map((row) => {
          const note = row.state === 'sent_back' || row.state === 'conflict' ? row.reason : row.once
          const words = (
            <>
              <span className={s.rowMark} data-m={`mark-${row.key}`} data-m-at="center">
                <Mark row={row} />
              </span>
              <span className={s.rowName}>
                <span className={[s.number, later(row) ? s.unnumbered : ''].join(' ')} data-m={`label-${row.key}`}>
                  {row.label}
                </span>
                {row.title !== '' && (
                  <span className={s.title} data-m-in="">
                    {row.title}
                  </span>
                )}
              </span>
              <span className={s.state} data-m-in="">
                {said(row)}
              </span>
              {note !== undefined && note !== '' && (
                <span className={s.note} data-m-in="">
                  {`${note.charAt(0).toUpperCase()}${note.slice(1)}`}
                </span>
              )}
            </>
          )
          return (
            <li key={row.key} className={tone(row)}>
              {row.url === null ? (
                <div className={s.row}>{words}</div>
              ) : (
                <a
                  className={[s.row, s.rowLink].join(' ')}
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  title={`${row.label} ${row.title}`}
                >
                  {words}
                </a>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** What came back says why on the composer's edge, nearest the field, while the pill is folded. */
const backNotice = (rows: MergingRow[]) => {
  const back = rows.find((row) => row.state === 'sent_back' && row.reason !== undefined)
  if (back === undefined) return null
  return (
    <div className={s.backNotice} data-m-in="" data-m-ghost="parent">
      <strong>{back.label} sent back.</strong> {back.reason}
    </div>
  )
}

/* ——— Leaving: once all are in, the pill shows them merged for a moment, then goes; the thread keeps the folded line where it was asked ——— */

function useLeaving(moment: Moment, replay: number) {
  const [phase, setPhase] = useState<'here' | 'leaving' | 'gone'>('here')
  // The face is drawn afresh for each moment and replay, so it starts here.
  useEffect(() => {
    if (moment !== 'merged') return
    const leave = setTimeout(() => setPhase('leaving'), 1800)
    const gone = setTimeout(() => setPhase('gone'), 1800 + 200)
    return () => {
      clearTimeout(leave)
      clearTimeout(gone)
    }
  }, [moment, replay])
  return phase
}

/* ——— The face ——— */

function Face({ c, replay, setOpen }: { c: Chosen; replay: number; setOpen: (open: boolean) => void }) {
  const [value, setValue] = useState('')
  const rows = rowsOf(c.w, c.m).slice(0, c.m === 'one' ? 1 : undefined)
  const phase = useLeaving(c.m, replay)
  const shown = phase !== 'gone'
  const folded = c.m === 'merged' && (c.d === 'now' || !shown)

  // Today: the line at the thread's foot, scrolled away with it; gone once all are in.
  const foot = c.d === 'now' && c.m !== 'merged' && <MergingLine key={String(c.open)} rows={rows} open={c.open} />

  const goal =
    c.w === 'task' ? (
      <Goal
        goal={{
          objective: 'Get every runtime test passing on all three platforms.',
          status: 'active',
          rounds: 3,
          roundLimit: 12,
          progress: 'Flakies fixed on macOS and Linux.',
          detail: null,
          waiting: false,
        }}
        objectiveLimit={4000}
        expanded={false}
        onExpand={noop}
        onPause={noop}
        onResume={noop}
        onEdit={noop}
        onClear={noop}
      />
    ) : null
  // The run chip glides too, where what opens or folds moves it.
  const behind = (
    <div className={s.behind} data-m="behind">
      <Behind processes={[SITE_RUN]} onStop={noop} onOpenUrl={noop} />
    </div>
  )
  const pinned =
    !shown || c.d === 'now' ? null : c.d === 'first' ? (
      <div className={[s.firstPin, phase === 'leaving' ? s.firstGoing : ''].join(' ')}>
        <FirstChip rows={rows} open={c.open} onOpen={setOpen} />
      </div>
    ) : (
      <Morph step={String(c.open)}>
        <Pill rows={rows} open={c.open} onOpen={setOpen} leaving={phase === 'leaving'} />
      </Morph>
    )
  const notice = c.d !== 'now' && shown && !c.open ? backNotice(rows) : null

  return (
    <TaskFace
      className={s.face}
      composer={
        <Composer
          value={value}
          onChange={setValue}
          onSubmit={() => setValue('')}
          placeholder={c.w === 'task' ? 'Tell the lead' : 'Ask the coordinator'}
          above={
            <>
              {goal}
              {behind}
              {pinned}
            </>
          }
          notice={notice}
        />
      }
    >
      <Thread label="Conversation">
        <ThreadShellProvider value={{}}>
          {c.w === 'task' ? (
            <TaskThread moment={c.m} folded={folded} foot={foot} />
          ) : (
            <CoordinatorThread moment={c.m} folded={folded} foot={foot} />
          )}
        </ThreadShellProvider>
      </Thread>
    </TaskFace>
  )
}

/* ——— The lab ——— */

function Toggle({ on, label, kbd, onChange }: { on: boolean; label: string; kbd: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" className={s.toggle} aria-pressed={on} onClick={() => onChange(!on)}>
      {label}
      <kbd className={s.kbd}>{kbd}</kbd>
    </button>
  )
}

function Lab() {
  const [c, setC] = useState<Chosen>(first)
  const [replay, setReplay] = useState(0)
  const set = (patch: Partial<Chosen>) => setC((was) => ({ ...was, ...patch }))
  const frame = useRef<HTMLDivElement>(null)

  useEffect(() => remember(c), [c])
  useEffect(() => {
    document.documentElement.dataset.theme = c.dark ? 'dark' : 'light'
  }, [c.dark])

  // Scrolled up: what was asked is out of view, the place the pinned line earns its keep.
  useLayoutEffect(() => {
    const scroller = frame.current?.querySelector<HTMLElement>('[class*="TaskFace-module__scroll__"]')
    if (scroller == null) return
    const go = () => {
      scroller.scrollTop = c.up ? Math.max(0, scroller.scrollHeight - scroller.clientHeight - 420) : scroller.scrollHeight
    }
    go()
    const again = setTimeout(go, 80)
    return () => clearTimeout(again)
  }, [c.up, c.w, c.d, c.m, c.narrow, replay])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('textarea, input, [contenteditable]')) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      const d = DIRECTIONS.find((one) => one.kbd.toLowerCase() === key)
      const m = MOMENTS.find((one) => one.kbd === key)
      if (d) set({ d: d.value })
      else if (m) set({ m: m.value })
      else if (key === 't') setC((was) => ({ ...was, w: was.w === 'task' ? 'coordinator' : 'task' }))
      else if (key === 'o') setC((was) => ({ ...was, open: !was.open }))
      else if (key === 'n') setC((was) => ({ ...was, narrow: !was.narrow }))
      else if (key === 'u') setC((was) => ({ ...was, up: !was.up }))
      else if (key === 'd') setC((was) => ({ ...was, dark: !was.dark }))
      else if (key === 'r') setReplay((n) => n + 1)
      else return
      event.preventDefault()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={s.page}>
      <div className={s.stage}>
        <div ref={frame} className={[s.frame, c.narrow ? s.narrow : ''].join(' ')}>
          <Face key={`${c.d}-${c.w}-${c.m}-${replay}`} c={c} replay={replay} setOpen={(open) => set({ open })} />
        </div>
      </div>
      <div className={s.switcher}>
        <Segmented label="Direction" options={DIRECTIONS} value={c.d} onChange={(d) => set({ d })} />
        <Segmented label="Moment" options={MOMENTS} value={c.m} onChange={(m) => set({ m })} />
        <Segmented label="Thread" options={WHERES} value={c.w} onChange={(w) => set({ w })} />
        <div className={s.toggles}>
          <Toggle on={c.open} label="Opened" kbd="O" onChange={(open) => set({ open })} />
          <Toggle on={c.up} label="Scrolled up" kbd="U" onChange={(up) => set({ up })} />
          <Toggle on={c.narrow} label="Narrow" kbd="N" onChange={(narrow) => set({ narrow })} />
          <Toggle on={c.dark} label="Dark" kbd="D" onChange={(dark) => set({ dark })} />
          {c.m === 'merged' && (
            <button type="button" className={s.toggle} onClick={() => setReplay((n) => n + 1)}>
              Replay
              <kbd className={s.kbd}>R</kbd>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
)
