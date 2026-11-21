import type { ReactNode } from 'react'
import { Icon, LoadMeter, Popover } from '@althar/ui'

import h from '../../../src/renderer/features/homes/Homes.module.css'
import { SLOTS } from '../data'
import { Pips } from '../parts'
import { LiveAtOnce } from '../slider'
import { words } from '../words'
import type { Ctx, Direction } from './types'

/*
 * The chip. In this computer's window the bar's home chip names it, This
 * Mac, with its places as cells beside the name, and nothing more: a lowered
 * number shows in the cells and in what the chip opens. Up next keeps
 * nothing of today's banner; its rows say why they wait. The slider marks a
 * lowered number on its track. What the chip opens is what the takes try
 * (popovers.tsx).
 */

/** The chip itself, as the trigger of whatever it opens. */
export const chipTrigger = (ctx: Ctx) => {
  const { places } = ctx
  return (
    <button
      type="button"
      className={h.chip}
      aria-label={`${words.machine}, ${words.atWork(places.held.length, places.configured)}${places.why === null ? '' : `, ${words.lowered(places)}`}. Homes`}
    >
      <Icon name="computer" size={13} />
      <span className={h.chipName}>{words.machine}</span>
      <Pips places={places} />
    </button>
  )
}

/** The chip, opening a popover. */
export function PopoverChip({ ctx, width = 320, children }: { ctx: Ctx; width?: number; children: ReactNode }) {
  return (
    <Popover
      label="Homes"
      placement="below"
      align="end"
      width={width}
      padded={false}
      initialFocus="panel"
      open={ctx.mac.open === 'bar'}
      onOpenChange={(open) => ctx.mac.set(open ? 'bar' : null)}
      trigger={chipTrigger(ctx)}
    >
      {children}
    </Popover>
  )
}

/** Agents at once, in the quick settings, in Settings, or in what the chip opens: a lowered number marked on its track. */
export const sliderOf = (ctx: Ctx, compact: boolean) => (
  <LiveAtOnce
    places={ctx.places}
    count={ctx.count}
    most={ctx.most}
    onChange={ctx.setCount}
    compact={compact}
    {...(ctx.places.why === null ? {} : { note: words.lowered(ctx.places) })}
  />
)

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
