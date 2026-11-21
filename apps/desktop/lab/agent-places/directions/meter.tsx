import { type ReactNode, useState } from 'react'
import { ChromeButton, Gauge, PlanGauge, Popover } from '@althar/ui'

import { heldSteps, percent, STEPS, strained } from '../../../../../packages/ui/src/chrome/LoadMeter/load'
import m from '../../../../../packages/ui/src/chrome/LoadMeter/LoadMeter.module.css'
import { CLAUDE_PLENTY, CODEX_PLENTY } from '../../../../../packages/ui/src/fixtures/plan'
import { poolOf, type Worker } from '../data'
import { Track, WorkerPips } from '../parts'
import { LiveAtOnce } from '../slider'
import { words } from '../words'
import type { Ctx, Direction } from './types'
import s from './meter.module.css'

/*
 * The meter. The bar's Homes stays as it is: which home this window is, and
 * the others to open. CPU and MEM were this computer's load, and its places
 * were this computer's too; now both are one meter, for every computer this
 * home's agents work on, and what it opens says the rest. As the lab's switch
 * has it, the meter draws an AGENTS gauge before CPU and MEM, in their manner;
 * or a cell a place, a group a computer, with what waits after them; or one
 * track, a part a computer, as wide whatever the numbers. Plan usage stays
 * after it, as it is: the model's quota, apart from the computers' work.
 */

/** How many steps a share lights, held still near a step's edge, as the kit's meter holds its own. */
const useSteps = (share: number) => {
  const [held, setHeld] = useState(() => heldSteps(share, STEPS, null))
  const steps = heldSteps(share, STEPS, held)
  if (steps !== held) setHeld(steps)
  return steps
}

/**
 * Every computer's places as one gauge of five steps, in the meters' manner: the share at work lit in cobalt, the
 * share closed for now faded at its end; in full ink while work waits for a place, as a full CPU is.
 */
function AgentsGauge({ workers, waits }: { workers: readonly Worker[]; waits: boolean }) {
  const pool = poolOf(workers)
  const lit = useSteps(pool.all === 0 ? 0 : pool.busy / pool.all)
  const shut = Math.min(STEPS - lit, heldSteps(pool.all === 0 ? 0 : pool.closed / pool.all, STEPS, null))
  return (
    <span className={`${m.gauge} ${waits ? m.full : ''}`}>
      <span className={m.name}>{words.gauge}</span>
      <span className={m.steps} aria-hidden="true">
        {Array.from({ length: STEPS }, (_, i) => (
          <i key={i} data-lit={i < lit ? (waits ? 'rest' : 'ours') : undefined} className={i >= STEPS - shut ? s.shut : undefined} />
        ))}
      </span>
    </span>
  )
}

/** This computer's CPU and memory, as the kit's meter draws them. */
function LoadGauges({ ctx }: { ctx: Ctx }) {
  const { load } = ctx
  const cpu = useSteps(load.cpu)
  const work = useSteps(load.work ?? 0)
  const memory = useSteps(load.memory)
  const workMemory = useSteps(load.workMemory ?? 0)
  return (
    <>
      <Gauge name="CPU" lit={cpu} ours={work} full={cpu === STEPS} />
      <Gauge name="MEM" lit={memory} ours={workMemory} full={strained(load.pressure)} />
    </>
  )
}

/** How many tasks wait to start, after the places, while any do. Its room is kept, so the meter doesn't shift. */
function Waits({ n }: { n: number }) {
  return (
    <span className={s.waits} aria-hidden="true">
      {n > 0 ? `+${n}` : ''}
    </span>
  )
}

const labelOf = (ctx: Ctx) => {
  const pool = poolOf(ctx.workers)
  return [
    `${words.agents}: ${words.pool(pool.busy, pool.free)}`,
    ctx.waiting.length > 0 ? `${ctx.waiting.length} waiting` : null,
    ...ctx.workers.filter((one) => words.stateShort(one) !== null).map((one) => `${one.name} ${words.stateShort(one)!.toLowerCase()}`),
    `CPU ${percent(ctx.load.cpu)}%, memory ${percent(ctx.load.memory)}%`,
  ]
    .filter((part) => part !== null)
    .join('. ')
}

/** The meter itself, as the trigger of what it opens. */
const meterTrigger = (ctx: Ctx) => {
  const waits = ctx.waiting.length
  return (
    <button type="button" className={`${m.button} ${s.meter}`} aria-label={labelOf(ctx)}>
      {ctx.bar === 'gauges' ? (
        <>
          <AgentsGauge workers={ctx.workers} waits={waits > 0 && ctx.waiting.some((one) => one.only === null)} />
          <LoadGauges ctx={ctx} />
        </>
      ) : (
        <span className={s.places}>
          {ctx.bar === 'cells' ? <WorkerPips workers={ctx.workers} /> : <Track workers={ctx.workers} />}
          <Waits n={waits} />
        </span>
      )}
    </button>
  )
}

/** The bar as a take has it: Homes as it is, the meter opening what the take tries, then plan usage as it is. */
export const barOf = (ctx: Ctx, peek: ReactNode, width: number) => (
  <>
    <ChromeButton icon="plug" label="Homes" compact onClick={() => ctx.say('Opens the homes menu, as it is')} />
    <span className={m.meter}>
      <Popover
        label={words.agents}
        placement="below"
        align="end"
        width={width}
        padded={false}
        initialFocus="panel"
        open={ctx.peek.open}
        onOpenChange={ctx.peek.set}
        trigger={meterTrigger(ctx)}
      >
        {peek}
      </Popover>
    </span>
    <PlanGauge agents={[CLAUDE_PLENTY, CODEX_PLENTY]} />
  </>
)

/** Agents at once on a computer, with a lowered number marked on its track; the cloud says its month in place of the default. */
export const workerSlider = (ctx: Ctx, one: Worker, compact: boolean, title?: string) => {
  const line = words.stateOf(one, true) ?? (one.spend === null ? null : words.quietOf(one))
  return (
    <LiveAtOnce
      places={one.places}
      count={one.places.configured}
      most={one.kind === 'cloud' ? 10 : ctx.most}
      onChange={(n) => ctx.setCountOf(one.id, n)}
      compact={compact}
      where={one.kind === 'this' ? 'this Mac' : one.kind === 'cloud' ? 'your plan' : one.name}
      {...(title === undefined ? {} : { title })}
      {...(line === null ? {} : { note: line })}
    />
  )
}

/** A take: the bar with the meter opening `peek`; this computer's slider in the quick settings and in Settings. */
export const take = (key: string, kbd: string, label: string, idea: string, width: number, peek: (ctx: Ctx) => ReactNode): Direction => ({
  key,
  kbd,
  label,
  idea,
  bar: (ctx) => barOf(ctx, peek(ctx), width),
  quick: (ctx) => workerSlider(ctx, ctx.here, true),
  settings: (ctx) => workerSlider(ctx, ctx.here, false),
})
