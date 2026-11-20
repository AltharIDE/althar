import { useId } from 'react'
import { ChromeButton, Icon, LoadMeter, Popover } from '@althar/ui'

import { SLOTS } from '../data'
import { HeldRows, Pips } from '../parts'
import { LiveAtOnce } from '../slider'
import { words } from '../words'
import type { Ctx, Direction } from './types'
import s from './b.module.css'

/*
 * B · The slider. Agents at once is the meter: under its track, a cell under
 * each number up to the person's, cobalt where an agent works in it and
 * hatched where it is closed for now, so the number and what fills it read
 * as one. Settings lists the work in the places under it. Up next keeps one
 * row, the cells and a count, that opens the same slider and the work in
 * the places, so the number changes from where the wait shows. The window's
 * bar and This Mac's peek stay as they are.
 */

/** The note under the slider: the number lowered for now, or how many work. */
const noteOf = (ctx: Ctx) => words.lowered(ctx.places) ?? words.atWork(ctx.places.held.length, ctx.places.configured)

/** The slider with its cells, and the work in them: what Up next's row opens, and what Settings shows. */
function Places({ ctx, compact, onOpen }: { ctx: Ctx; compact: boolean; onOpen: (taskId: string) => void }) {
  const id = useId()
  return (
    <div className={compact ? s.sheet : s.setting}>
      <LiveAtOnce
        places={ctx.places}
        count={ctx.count}
        most={ctx.most}
        onChange={ctx.setCount}
        compact={compact}
        show="cells"
        note={noteOf(ctx)}
      />
      <section className={s.well} aria-labelledby={`${id}-now`}>
        <h3 id={`${id}-now`} className={s.eyebrow}>
          {words.inUse}
        </h3>
        <HeldRows places={ctx.places} onOpen={onOpen} />
      </section>
    </div>
  )
}

/** Up next's row: the cells, how many work, and, while it is lowered, to what. It opens the slider. */
function UpNextRow({ ctx }: { ctx: Ctx }) {
  const open = ctx.mac.open === 'upnext'
  const setOpen = (now: boolean) => ctx.mac.set(now ? 'upnext' : null)
  const { places } = ctx
  // Only while something waits for a place, or the number is lowered: otherwise Up next has nothing to explain.
  if (places.waiting === 0 && places.why === null) return null
  return (
    <Popover
      label={words.title}
      placement="below"
      align="start"
      width={340}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={s.row}>
          <Pips places={places} size="large" />
          <span className={s.rowWords}>{words.atWork(places.held.length, places.configured)}</span>
          {places.why !== null && <span className={s.rowLowered}>{words.short(places)}</span>}
          <Icon name="chevronD" size={12} className={s.chevron} />
        </button>
      }
    >
      <Places
        ctx={ctx}
        compact
        onOpen={(taskId) => {
          setOpen(false)
          ctx.onOpen(taskId)
        }}
      />
    </Popover>
  )
}

export const B: Direction = {
  key: 'b',
  label: 'The slider',
  idea: 'Agents at once shows its places filling; Up next keeps a row that opens it',
  bar: (ctx) => (
    <>
      <ChromeButton icon="plug" label="Homes" compact />
      <LoadMeter
        load={ctx.load}
        slots={SLOTS}
        onOpen={() => undefined}
        onHide={() => undefined}
        open={ctx.mac.open === 'bar'}
        onOpenChange={(open) => ctx.mac.set(open ? 'bar' : null)}
      />
    </>
  ),
  upNext: { where: 'body', draw: (ctx) => <UpNextRow ctx={ctx} /> },
  quick: (ctx) => (
    <LiveAtOnce places={ctx.places} count={ctx.count} most={ctx.most} onChange={ctx.setCount} compact show="cells" note={noteOf(ctx)} />
  ),
  settings: (ctx) => <Places ctx={ctx} compact={false} onOpen={ctx.onOpen} />,
}
