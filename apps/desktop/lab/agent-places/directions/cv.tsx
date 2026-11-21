import { Icon, Popover } from '@althar/ui'

import { Pips } from '../parts'
import { words } from '../words'
import { barOf, MacPlaces, sliderOf } from './c'
import type { Ctx, Direction } from './types'
import v from './cv.module.css'

/*
 * C's other takes: the chip and the slider as C has them, and Up next's say
 * in another shape each. C2 keeps today's row, said plainly, folding open to
 * This Mac's places in place. C3 keeps the body for the work: a tag at the
 * end of Up next's heading, opening This Mac's places from there. C4 gives
 * Up next nothing: the chip says the lowered number itself. C5 speaks
 * whenever Up next waits on places, lowered or all in use, in one line.
 * What Up next opens is `ctx.mac` 'upnext'; This Mac's chip, 'bar'.
 */

/** C2: today's row, only while the number is lowered, saying it plainly; it folds open to This Mac's places. */
function Fold({ ctx }: { ctx: Ctx }) {
  const { places } = ctx
  if (places.why === null) return null
  const open = ctx.mac.open === 'upnext'
  return (
    <div className={v.fold} data-open={open || undefined}>
      <button type="button" className={v.foldRow} aria-expanded={open} onClick={() => ctx.mac.set(open ? null : 'upnext')}>
        <Icon name="chevron" size={11} className={v.foldChevron} />
        <span className={v.foldWords}>
          <span className={v.where}>{words.machine} ·</span> {words.atATimeUntil(places)}
        </span>
        <Pips places={places} />
      </button>
      {open && (
        <div className={v.foldBody}>
          <MacPlaces ctx={ctx} close={() => ctx.mac.set(null)} because={false} />
        </div>
      )}
    </div>
  )
}

/** C3: at the end of Up next's heading, only while the number is lowered; This Mac's places open from it. */
function Tag({ ctx }: { ctx: Ctx }) {
  const { places } = ctx
  if (places.why === null) return null
  return (
    <Popover
      label={`${words.machine}’s places`}
      placement="below"
      align="end"
      width={300}
      padded={false}
      initialFocus="panel"
      open={ctx.mac.open === 'upnext'}
      onOpenChange={(open) => ctx.mac.set(open ? 'upnext' : null)}
      trigger={
        <button type="button" className={v.tag} aria-label={`${words.lowered(places)}. ${words.machine}’s places`}>
          <Icon name="load" size={12} />
          <span>{words.forNow(places)}</span>
        </button>
      }
    >
      <div className={v.peek}>
        <div className={v.peekHead}>
          <p className={v.peekTitle}>{words.oneAtATime(places)}</p>
          <p className={v.why}>
            {words.because(places)} {words.startsAs(places)}
          </p>
        </div>
        <MacPlaces ctx={ctx} close={() => ctx.mac.set(null)} because={false} />
      </div>
    </Popover>
  )
}

/** C5: one line whenever Up next waits on places, lowered or all in use; it opens This Mac's chip. */
function Line({ ctx }: { ctx: Ctx }) {
  const { places } = ctx
  if (places.why === null && places.waiting === 0) return null
  const lowered = places.why !== null
  return (
    <button
      type="button"
      className={v.line}
      aria-expanded={ctx.mac.open === 'bar'}
      onClick={() => ctx.mac.set(ctx.mac.open === 'bar' ? null : 'bar')}
    >
      <Pips places={places} />
      <span className={v.lineWords}>
        <span className={v.where}>{words.machine} ·</span>{' '}
        <span data-lowered={lowered || undefined}>{lowered ? words.atATimeUntil(places) : words.allAtWork(places)}</span>
      </span>
      <Icon name="chevron" size={11} className={v.lineChevron} />
    </button>
  )
}

const take = (key: string, kbd: string, label: string, idea: string, rest: Pick<Direction, 'bar' | 'upNext'>): Direction => ({
  key,
  kbd,
  label,
  idea,
  ...rest,
  quick: (ctx) => sliderOf(ctx, true),
  settings: (ctx) => sliderOf(ctx, false),
})

export const C2 = take('c2', '2', 'C2 Fold', 'Today’s row, said plainly, only while lowered; it folds open to This Mac’s places', {
  bar: (ctx) => barOf(ctx),
  upNext: { where: 'body', draw: (ctx) => <Fold ctx={ctx} /> },
})

export const C3 = take(
  'c3',
  '3',
  'C3 Heading',
  'A tag at the end of Up next’s heading, only while lowered; This Mac’s places open from it',
  {
    bar: (ctx) => barOf(ctx),
    upNext: { where: 'head', draw: (ctx) => <Tag ctx={ctx} /> },
  },
)

export const C4 = take('c4', '4', 'C4 Chip only', 'Up next keeps nothing; the chip says the lowered number itself', {
  bar: (ctx) => barOf(ctx, true),
  upNext: null,
})

export const C5 = take(
  'c5',
  '5',
  'C5 While waiting',
  'One line whenever Up next waits on places, lowered or all in use; it opens This Mac',
  {
    bar: (ctx) => barOf(ctx),
    upNext: { where: 'body', draw: (ctx) => <Line ctx={ctx} /> },
  },
)
