import type { ReactNode } from 'react'
import { Icon, LoadMeter, Popover } from '@althar/ui'

import h from '../../../src/renderer/features/homes/Homes.module.css'
import { SLOTS, type Worker } from '../data'
import { Pips, WorkerBars, WorkerPips } from '../parts'
import { LiveAtOnce } from '../slider'
import { words } from '../words'
import type { Ctx, Direction } from './types'

/*
 * The chip. In this computer's window the bar's home chip names it, This
 * Mac, with no other words. Beside the name, as the lab's chip switch has it:
 * this computer's places alone (the CPU and memory meters beside it are this
 * computer's too), every worker's places as a group of cells each, or every
 * worker as a short bar. With no other worker, each is This Mac's cells. Up
 * next keeps nothing of today's banner; its rows say why they wait, and which
 * worker a task waits for where it can start on one alone. What the chip
 * opens is what the takes try (popovers.tsx).
 */

const said = (one: Worker) =>
  [
    one.name,
    one.away !== null ? words.stateShort(one) : words.atWork(one.places.held.length, one.places.configured),
    one.away === null ? words.stateShort(one) : null,
  ]
    .filter((part) => part !== null)
    .join(', ')

/** The chip itself, as the trigger of whatever it opens. */
export const chipTrigger = (ctx: Ctx) => {
  const { workers, here } = ctx
  const several = workers.length > 1
  return (
    // As wide as its cells need: the kit's chip stops at 220px, which would cut the name short.
    <button
      type="button"
      className={h.chip}
      style={{ maxWidth: 'none' }}
      aria-label={`${words.machine}. ${workers.map(said).join('; ')}. Homes and workers`}
    >
      <Icon name="computer" size={13} />
      <span className={h.chipName}>{words.machine}</span>
      {!several || ctx.chip === 'mac' ? (
        <Pips places={here.places} />
      ) : ctx.chip === 'groups' ? (
        <WorkerPips workers={workers} />
      ) : (
        <WorkerBars workers={workers} />
      )}
    </button>
  )
}

/** The chip, opening a popover. */
export function PopoverChip({ ctx, width = 340, children }: { ctx: Ctx; width?: number; children: ReactNode }) {
  return (
    <Popover
      label="Homes and workers"
      placement="below"
      align="end"
      width={width}
      padded={false}
      initialFocus="panel"
      open={ctx.peek.open === 'bar'}
      onOpenChange={(open) => ctx.peek.set(open ? 'bar' : null)}
      trigger={chipTrigger(ctx)}
    >
      {children}
    </Popover>
  )
}

/** Agents at once on a worker, with a lowered number marked on its track; a cloud says its month in place of the default. */
export const workerSlider = (ctx: Ctx, one: Worker, compact: boolean, title?: string) => {
  const line = words.stateOf(one) ?? words.spend(one)
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

/** Agents at once on this computer, in the quick settings, in Settings, or in what the chip opens. */
export const sliderOf = (ctx: Ctx, compact: boolean) => workerSlider(ctx, ctx.here, compact)

/** A take: the chip opening what it draws, then the load meter as it is; the slider as the chip has it. */
export const take = (key: string, kbd: string, label: string, idea: string, chip: (ctx: Ctx) => ReactNode): Direction => ({
  key,
  kbd,
  label,
  idea,
  bar: (ctx) => (
    <>
      {chip(ctx)}
      <LoadMeter load={ctx.load} slots={SLOTS} onOpen={() => undefined} onHide={() => undefined} />
    </>
  ),
  quick: (ctx) => sliderOf(ctx, true),
  settings: (ctx) => sliderOf(ctx, false),
})
