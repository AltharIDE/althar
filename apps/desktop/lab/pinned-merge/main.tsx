import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@althar/ui/styles.css'
import '../../src/renderer/app.css'

import { type ReactNode, StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react'
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

/*
 * The pinned merge lab (README.md): the merge line held above the composer, so
 * it stays in view while the thread scrolls on, in three directions. The bar
 * along the bottom, or its keys, swaps them in place; the address keeps what
 * is chosen, for shots.
 */

type Direction = 'now' | 'a' | 'b' | 'c'
const DIRECTIONS: ReadonlyArray<{ value: Direction; label: string; kbd: string }> = [
  { value: 'now', label: 'Today', kbd: '0' },
  { value: 'a', label: 'A · A chip on the edge', kbd: 'A' },
  { value: 'b', label: 'B · A bar on the edge', kbd: 'B' },
  { value: 'c', label: 'C · The line sticks', kbd: 'C' },
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
  d: pick(params.get('d'), DIRECTIONS, 'a'),
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

/* ——— A: a chip beside what floats there, opening to the line's rows ——— */

const tone = (row: MergingRow) =>
  row.state === 'merged' ? s.merged : row.state === 'sent_back' || row.state === 'conflict' ? s.back : undefined

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
      return <span className={row.url === null ? s.ringFaint : s.ring} aria-hidden="true" />
  }
}

function MergeChip({ rows, open, onOpen }: { rows: MergingRow[]; open: boolean; onOpen: (open: boolean) => void }) {
  if (open)
    return (
      <div
        className={s.card}
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
        <span key={row.key} className={[s.token, tone(row), row.url === null ? s.later : ''].join(' ')} title={row.label}>
          <span className={s.mark}>
            <Mark row={row} />
          </span>
          <span className={s.tokenLabel}>{row.label}</span>
        </span>
      ))}
    </button>
  )
}

/** For A: what came back says why on the composer's edge, nearest the field. */
const backNotice = (rows: MergingRow[]) => {
  const back = rows.find((row) => row.state === 'sent_back' && row.reason !== undefined)
  if (back === undefined) return null
  return (
    <div className={s.backNotice}>
      <strong>{back.label} sent back.</strong> {back.reason}
    </div>
  )
}

/* ——— B: a bar the composer's width, opening in place ——— */

function MergeBar({ rows, open }: { rows: MergingRow[]; open: boolean }) {
  return (
    <div className={s.bar}>
      <MergingLine key={String(open)} rows={rows} open={open} />
    </div>
  )
}

/* ——— C: the line stays at the thread's foot, and sticks above the composer once the thread scrolls away ——— */

function StickyLine({ rows, open }: { rows: MergingRow[]; open: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = ref.current
    const scroller = el?.closest<HTMLElement>('[data-floats-host]')?.querySelector<HTMLElement>('[class*="TaskFace-module__scroll__"]')
    if (el == null || scroller == null) return
    const check = () => setStuck(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 60)
    check()
    scroller.addEventListener('scroll', check, { passive: true })
    return () => scroller.removeEventListener('scroll', check)
  }, [])
  return (
    <div ref={ref} className={[s.sticky, stuck ? s.stuck : ''].join(' ')}>
      <MergingLine key={String(open)} rows={rows} open={open} />
    </div>
  )
}

/* ——— Leaving: once all are in, the pinned line shows them merged for a moment, then goes; the thread keeps the folded line where it was asked ——— */

function useLeaving(moment: Moment, replay: number) {
  const [phase, setPhase] = useState<'here' | 'leaving' | 'gone'>('here')
  useEffect(() => {
    setPhase('here')
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
  const leaving = phase === 'leaving' ? s.leaving : ''
  const folded = c.m === 'merged' && (c.d === 'now' || !shown)
  const pinned = (node: ReactNode) => shown && <div className={[s.pin, leaving].join(' ')}>{node}</div>

  // Today: the line at the thread's foot, scrolled away with it; gone once all are in.
  const foot =
    c.d === 'now'
      ? c.m !== 'merged' && <MergingLine key={String(c.open)} rows={rows} open={c.open} />
      : c.d === 'c'
        ? pinned(<StickyLine key={`${c.m}-${replay}`} rows={rows} open={c.open} />)
        : null

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
  const behind = <Behind processes={[SITE_RUN]} onStop={noop} onOpenUrl={noop} />
  const above =
    c.d === 'a' ? (
      <>
        {goal}
        {behind}
        {pinned(<MergeChip rows={rows} open={c.open} onOpen={setOpen} />)}
      </>
    ) : c.d === 'b' ? (
      <>
        {behind}
        {goal}
        {pinned(<MergeBar rows={rows} open={c.open} />)}
      </>
    ) : (
      <>
        {goal}
        {behind}
      </>
    )
  const notice = c.d === 'a' && shown && !c.open ? backNotice(rows) : null

  return (
    <TaskFace
      className={s.face}
      composer={
        <Composer
          value={value}
          onChange={setValue}
          onSubmit={() => setValue('')}
          placeholder={c.w === 'task' ? 'Tell the lead' : 'Ask the coordinator'}
          above={above}
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
