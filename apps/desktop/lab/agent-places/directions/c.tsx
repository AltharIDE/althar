import { useId } from 'react'
import { Brand, Icon, LinkButton, LoadMeter, Popover } from '@althar/ui'

import h from '../../../src/renderer/features/homes/Homes.module.css'
import { type Places, SLOTS } from '../data'
import { HeldRows, Pips } from '../parts'
import { LiveAtOnce } from '../slider'
import { words } from '../words'
import type { Ctx, Direction } from './types'
import s from './c.module.css'

/*
 * C · The computer. Places belong to the computer the agents run on, so they
 * live on the window's home chip, which names it: This Mac, its places as
 * cells beside its name. The chip opens to each home with its places, this
 * one with the work in them and its number; a home's window shows the
 * home's. The slider marks a lowered number on its track.
 *
 * Its takes (cv.tsx) differ in what Up next keeps, and C4 in the chip. C1,
 * the card: nothing while the work waits for places as usual, each row
 * saying why; only a lowered number, which nothing else explains, gets a
 * card, with the way to This Mac.
 */

/** A home's places, as its window last read them. */
const STUDIO: Places = {
  configured: 8,
  atOnce: 8,
  why: null,
  machine: { count: 8, memory: 64, cores: 24 },
  own: false,
  waiting: 0,
  held: [],
}
const studio: Places = {
  ...STUDIO,
  held: [
    {
      id: 'x',
      taskId: 'x',
      title: 'Nightly dependency check',
      project: 'Ferrous',
      role: 'lead',
      agent: 'Claude Code',
      mark: Brand.ClaudeCode,
      doing: { kind: 'turn' },
      cpu: 0,
      memory: '0',
    },
  ],
}

/**
 * This Mac's places: how many work, the cells, why fewer for now, the work in them and the number, with the way to
 * change it. `close` closes whatever it's drawn in before it opens a task or the quick settings.
 */
export function MacPlaces({ ctx, close, because = true }: { ctx: Ctx; close: () => void; because?: boolean }) {
  const { places } = ctx
  const why = words.because(places)
  return (
    <>
      <div className={s.meter}>
        <Pips places={places} size="large" />
        <span className={s.count}>{words.atWork(places.held.length, places.configured)}</span>
      </div>
      {because && why !== null && (
        <p className={s.because}>
          <Icon name="load" size={13} className={s.warm} />
          <span>
            {why} {words.lowered(places)}.
          </span>
        </p>
      )}
      <HeldRows
        places={places}
        onOpen={(taskId) => {
          close()
          ctx.onOpen(taskId)
        }}
      />
      <p className={s.number}>
        <span>{words.title}</span>
        <span className={s.numberValue}>{places.configured}</span>
        <LinkButton
          onClick={() => {
            close()
            ctx.quick.set(true)
          }}
        >
          {words.change}
        </LinkButton>
      </p>
    </>
  )
}

function Homes({ ctx }: { ctx: Ctx }) {
  const id = useId()
  return (
    <div className={s.peek}>
      <section className={s.home} aria-labelledby={`${id}-mac`}>
        <div className={s.homeHead}>
          <Icon name="computer" size={14} className={s.homeIcon} />
          <h2 id={`${id}-mac`} className={s.homeName}>
            {words.machine}
          </h2>
          <span className={s.hint}>This window</span>
        </div>
        <MacPlaces ctx={ctx} close={() => ctx.mac.set(null)} />
      </section>
      <section className={s.home}>
        <button type="button" className={s.other}>
          <span className={s.homeHead}>
            <Icon name="home" size={14} className={s.homeIcon} />
            <span className={s.homeName}>studio-vps</span>
            <span className={s.hint}>Open</span>
          </span>
          <span className={s.meter}>
            <Pips places={studio} />
            <span className={s.countQuiet}>{words.atWork(studio.held.length, studio.configured)}</span>
          </span>
        </button>
      </section>
      <div className={s.menu}>
        <button type="button">
          <Icon name="plus" size={14} />
          Connect a home…
        </button>
        <button type="button">
          <Icon name="gear" size={14} />
          Manage homes…
        </button>
      </div>
    </div>
  )
}

/**
 * The window's home chip, in this computer's window: its name and its places. With `speaks`, while the number is
 * lowered it says so itself, in warm, beside the cells.
 */
export function Chip({ ctx, speaks = false }: { ctx: Ctx; speaks?: boolean }) {
  const { places } = ctx
  const saying = speaks && places.why !== null
  return (
    <Popover
      label="Homes"
      placement="below"
      align="end"
      width={320}
      padded={false}
      initialFocus="panel"
      open={ctx.mac.open === 'bar'}
      onOpenChange={(open) => ctx.mac.set(open ? 'bar' : null)}
      trigger={
        <button
          type="button"
          className={`${h.chip} ${saying ? s.chipSays : ''}`}
          aria-label={`${words.machine}, ${words.atWork(places.held.length, places.configured)}${places.why === null ? '' : `, ${words.lowered(places)}`}. Homes`}
        >
          <Icon name="computer" size={13} />
          <span className={h.chipName}>{words.machine}</span>
          <Pips places={places} />
          {saying && <span className={s.chipWords}>{words.forNow(places)}</span>}
        </button>
      }
    >
      <Homes ctx={ctx} />
    </Popover>
  )
}

/** The window's bar in C: the chip, then the load meter as it is. */
export const barOf = (ctx: Ctx, speaks = false) => (
  <>
    <Chip ctx={ctx} speaks={speaks} />
    <LoadMeter load={ctx.load} slots={SLOTS} onOpen={() => undefined} onHide={() => undefined} />
  </>
)

/** Agents at once in C, in the quick settings and in Settings: a lowered number marked on its track. */
export const sliderOf = (ctx: Ctx, compact: boolean) => (
  <LiveAtOnce
    places={ctx.places}
    count={ctx.count}
    most={ctx.most}
    onChange={ctx.setCount}
    compact={compact}
    show="limit"
    {...(ctx.places.why === null ? {} : { note: words.lowered(ctx.places) })}
  />
)

/** Up next, only while the number is lowered: to what, why, and the way to This Mac. */
function Banner({ ctx }: { ctx: Ctx }) {
  const { places } = ctx
  if (places.why === null) return null
  return (
    <div className={s.banner} role="status">
      <Icon name="load" size={15} className={s.bannerIcon} />
      <div className={s.bannerWords}>
        <p className={s.bannerTitle}>{words.oneAtATime(places)}</p>
        <p className={s.bannerLine}>
          {words.because(places)} {words.startsAs(places)} <LinkButton onClick={() => ctx.mac.set('bar')}>See {words.machine}</LinkButton>
        </p>
      </div>
    </div>
  )
}

export const C: Direction = {
  key: 'c1',
  kbd: '1',
  label: 'C1 Card',
  idea: 'A card over Up next, only while the number is lowered: how many, why, the way to This Mac',
  bar: (ctx) => barOf(ctx),
  upNext: { where: 'body', draw: (ctx) => <Banner ctx={ctx} /> },
  quick: (ctx) => sliderOf(ctx, true),
  settings: (ctx) => sliderOf(ctx, false),
}
