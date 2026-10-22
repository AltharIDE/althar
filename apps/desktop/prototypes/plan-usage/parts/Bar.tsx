// Scrappy: plan usage beside CPU and memory, three ways. A: a third gauge of its own, after the load meter, with its own peek. B: a third gauge inside the load meter, its peek the load peek with the plan under the machine. C: a figure, not steps, and a peek that leads with the tightest limit. In each, once an agent is under a tenth, the bar says who and until when beside it, as the meter says memory running short.
import { LoadPeek, type LoadMeterProps, loadMeterText, Popover } from '@althar/ui'
import { useSyncExternalStore } from 'react'

import { usePlanUsage } from '../../../src/renderer/features/usage/useUsage'
import { pctWords, SAY_UNDER, whenShort } from '../usage'
import { firstOf, Gauge, PeekByAgent, PeekTightest, PlanSection, STEPS } from './Plan'
import s from './plan.module.css'

/** The bar's ⌘U, for B: the bar hands its Usage button's open state here, and the load meter opens on it. */
let bridge: { readonly expanded: boolean; readonly toggle: () => void } = { expanded: false, toggle: () => {} }
const listeners = new Set<() => void>()
/** What was last asked of the bar before it answered: a close said twice in one go (pointer down outside, then focus leaving) toggles once. */
let asked: boolean | null = null
const askOpen = (next: boolean) => {
  if (next === (asked ?? bridge.expanded)) return
  asked = next
  bridge.toggle()
}
export const setBridge = (next: typeof bridge) => {
  if (next.expanded === bridge.expanded && next.toggle === bridge.toggle) return
  asked = null
  bridge = next
  queueMicrotask(() => listeners.forEach((one) => one()))
}
const useBridge = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    () => bridge,
  )

/** What the bar says beside the gauge once the agent closest to running out is under a tenth: "Codex 3% · 14:00". */
function Said() {
  const first = firstOf(usePlanUsage())
  if (first === null || first.route.room.left > SAY_UNDER) return null
  const { room } = first.route
  return (
    <output className={s.said}>
      {first.name} {pctWords(room.left)}
      {room.resetsAt !== null && <span className={s.saidUntil}> · {whenShort(room.resetsAt)}</span>}
    </output>
  )
}

const labelOf = (first: ReturnType<typeof firstOf>) =>
  first === null
    ? 'Plan usage: nothing read yet'
    : `Plan usage: ${first.name} has ${first.route.room.left}% left${first.route.room.resetsAt === null ? '' : `, until ${whenShort(first.route.room.resetsAt)}`}`

/** A: a third gauge after the load meter, PLAN, with its own peek. */
export function PlanGauge({ expanded, onToggle }: { readonly expanded: boolean; readonly onToggle: () => void }) {
  const usage = usePlanUsage()
  const first = firstOf(usage)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <Popover
        label="Plan usage"
        placement="below"
        align="end"
        width={300}
        padded={false}
        initialFocus="panel"
        open={expanded}
        onOpenChange={(open) => {
          if (open !== expanded) onToggle()
        }}
        trigger={
          <button type="button" className={s.button} aria-label={labelOf(first)}>
            <Gauge name="Plan" left={first?.route.room.left ?? 100} />
          </button>
        }
      >
        <PeekByAgent usage={usage} />
      </Popover>
      <Said />
    </span>
  )
}

/** C: a figure beside CPU and memory, in their type: PLAN 62%, its ink deeper once under a tenth. */
export function PlanFigure({ expanded, onToggle }: { readonly expanded: boolean; readonly onToggle: () => void }) {
  const usage = usePlanUsage()
  const first = firstOf(usage)
  const left = first?.route.room.left ?? null
  const low = left !== null && left <= SAY_UNDER
  return (
    <Popover
      label="Plan usage"
      placement="below"
      align="end"
      width={280}
      padded={false}
      initialFocus="panel"
      open={expanded}
      onOpenChange={(open) => {
        if (open !== expanded) onToggle()
      }}
      trigger={
        <button type="button" className={s.button} aria-label={labelOf(first)} style={{ gap: 5 }}>
          <span className={s.short}>{low ? first!.name : 'Plan'}</span>
          <span className={[s.figure, low && s.figureLow].filter(Boolean).join(' ')}>{left === null ? '—' : pctWords(left)}</span>
          {low && first!.route.room.resetsAt !== null && <span className={s.saidUntil}>· {whenShort(first!.route.room.resetsAt)}</span>}
        </button>
      }
    >
      <PeekTightest usage={usage} />
    </Popover>
  )
}

const stepsOf = (share: number) => Math.min(STEPS, Math.round(share * STEPS))

/** B: the load meter with the plan as its third gauge, and one peek: the machine, then the plan. */
export function MeterWithPlan({ load, slots, onOpen, text }: LoadMeterProps) {
  const t = { ...loadMeterText, ...text }
  const usage = usePlanUsage()
  const first = firstOf(usage)
  // Open as the bar's ⌘U state is, so a click, ⌘U and closing all go through one place, as in A and C.
  const { expanded: open } = useBridge()
  const setOpen = askOpen
  const machine = (name: string, share: number) => (
    <span className={s.gauge}>
      <span className={s.short}>{name}</span>
      <span className={s.steps} aria-hidden="true">
        {Array.from({ length: STEPS }, (_, i) => (
          <i key={i} data-lit={i < stepsOf(share) ? '' : undefined} />
        ))}
      </span>
    </span>
  )
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <Popover
        label="This Mac’s load and plan usage"
        placement="below"
        align="end"
        width={300}
        padded={false}
        initialFocus="panel"
        open={open}
        onOpenChange={setOpen}
        trigger={
          <button
            type="button"
            className={s.button}
            aria-label={`${t.label(Math.round(load.cpu * 100), Math.round(load.memory * 100))}. ${labelOf(first)}`}
          >
            {machine(t.cpuShort, load.cpu)}
            {machine(t.memoryShort, load.memory)}
            <Gauge name="Plan" left={first?.route.room.left ?? 100} />
          </button>
        }
      >
        <LoadPeek
          load={load}
          slots={slots}
          text={t}
          {...(onOpen === undefined
            ? {}
            : {
                onOpen: (id: string) => {
                  setOpen(false)
                  onOpen(id)
                },
              })}
        />
        <PlanSection usage={usage} />
      </Popover>
      <Said />
    </span>
  )
}
