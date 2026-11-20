import { useId } from 'react'
import { AgentsAtOnce, BrandMark, ChromeButton, Gauge, LinkButton, LoadPeek, MemoryPressure, Popover, Switch } from '@althar/ui'

import m from '../../../../../packages/ui/src/chrome/LoadMeter/LoadMeter.module.css'
import { text as settingsText } from '../../../src/renderer/features/settings/text'
import { NO_PLACE, SLOTS } from '../data'
import { HeldRows, Lowered, Pips } from '../parts'
import { words } from '../words'
import type { Ctx, Direction } from './types'
import s from './a.module.css'

/*
 * A · This Mac. The places are part of how hard this computer works: a third
 * meter in the window's bar, after CPU and memory, a cell a place. Its peek,
 * This Mac, says how many are at work and holds the work in them, each with
 * what it takes of the computer, so a lowered number sits beside the memory
 * or CPU that lowered it. Up next keeps only the meter, small, at the end of
 * its heading, opening the same peek. Settings stays calm: the slider only
 * says when its number is lowered for now.
 */

const steps = (share: number) => Math.max(0, Math.min(5, Math.round(share * 5 - 0.2)))

/** This Mac: the kit's peek of its load, then its agents at once and what holds them, then what else of Althar's runs. */
function MacPeek({ ctx }: { ctx: Ctx }) {
  const { places, load } = ctx
  const id = useId()
  const other = Math.max(0, load.cpu - (load.work ?? 0))
  return (
    <div className={s.peek}>
      <LoadPeek load={{ ...load, rows: null }} slots={SLOTS} headingLevel={2} />
      <section className={s.section} aria-labelledby={`${id}-places`}>
        <div className={s.head}>
          <h3 id={`${id}-places`} className={s.eyebrow}>
            {words.title}
          </h3>
          <span className={s.count}>
            {words.atWork(places.held.length, places.configured)}
            {' · '}
            <LinkButton
              onClick={() => {
                ctx.mac.set(null)
                ctx.quick.set(true)
              }}
            >
              {words.change}
            </LinkButton>
          </span>
        </div>
        <Pips places={places} size="large" />
        <Lowered places={places} />
        <HeldRows
          places={places}
          figures
          onOpen={(taskId) => {
            ctx.mac.set(null)
            ctx.onOpen(taskId)
          }}
        />
      </section>
      <section className={s.section} aria-labelledby={`${id}-also`}>
        <h3 id={`${id}-also`} className={s.eyebrow}>
          No place needed
        </h3>
        <ul className={s.also}>
          {NO_PLACE.map((row) => (
            <li key={row.id}>
              {row.mark === undefined ? <span /> : <BrandMark brand={row.mark} size={11} className={s.mark} />}
              <span className={s.alsoTitle}>
                {row.title}
                {row.project !== undefined && <span className={s.quiet}> · {row.project}</span>}
              </span>
              <span className={s.figure}>{Math.round(row.cpu * 100)}%</span>
              <span className={s.quiet}>{row.memory}</span>
            </li>
          ))}
          <li className={s.other}>
            <span />
            <span className={s.alsoTitle}>Other apps</span>
            <span className={s.figure}>{Math.round(other * 100)}%</span>
            <span />
          </li>
        </ul>
      </section>
      <div className={s.foot}>
        <span id={`${id}-show`}>Show in the bar</span>
        <Switch checked onChange={() => undefined} labelledBy={`${id}-show`} />
      </div>
    </div>
  )
}

function Peek({ ctx, from, trigger }: { ctx: Ctx; from: string; trigger: React.ReactElement }) {
  return (
    <Popover
      label={`${words.machine}’s load`}
      placement="below"
      align="end"
      width={320}
      padded={false}
      initialFocus="panel"
      open={ctx.mac.open === from}
      onOpenChange={(open) => ctx.mac.set(open ? from : null)}
      trigger={trigger}
    >
      <MacPeek ctx={ctx} />
    </Popover>
  )
}

/** The bar's meter: CPU, memory, and the places, a cell each, while there are eight or fewer; past that, a count. */
function Meter({ ctx }: { ctx: Ctx }) {
  const { load, places } = ctx
  const label = `CPU ${Math.round(load.cpu * 100)}%, MEM ${Math.round(load.memory * 100)}%, ${words.atWork(places.held.length, places.configured)}`
  return (
    <span className={m.meter}>
      <Peek
        ctx={ctx}
        from="bar"
        trigger={
          <button type="button" className={m.button} aria-label={label}>
            <Gauge name="CPU" lit={steps(load.cpu)} ours={steps(load.work ?? 0)} full={steps(load.cpu) === 5} />
            <Gauge
              name="MEM"
              lit={steps(load.memory)}
              ours={steps(load.workMemory ?? 0)}
              full={load.pressure === MemoryPressure.Warning || load.pressure === MemoryPressure.Critical}
            />
            <span className={m.gauge}>
              <span className={m.name}>AGENTS</span>
              {places.configured <= 8 ? (
                <Pips places={places} />
              ) : (
                <span className={s.figures}>
                  {places.held.length}/{places.configured}
                </span>
              )}
            </span>
          </button>
        }
      />
    </span>
  )
}

/** At the end of Up next's heading: the same meter, small, and the same peek. */
function UpNextHead({ ctx }: { ctx: Ctx }) {
  const { places } = ctx
  return (
    <Peek
      ctx={ctx}
      from="upnext"
      trigger={
        <button
          type="button"
          className={s.headButton}
          aria-label={`${words.atWork(places.held.length, places.configured)}${places.why === null ? '' : `, ${words.lowered(places)}`}`}
        >
          <Pips places={places} />
          <span className={s.headWords} data-lowered={places.why !== null || undefined}>
            {words.short(places)}
          </span>
        </button>
      }
    />
  )
}

export const A: Direction = {
  key: 'a',
  label: 'This Mac',
  idea: 'A meter beside CPU and memory; Up next keeps it small in its heading',
  bar: (ctx) => (
    <>
      <ChromeButton icon="plug" label="Homes" compact />
      <Meter ctx={ctx} />
    </>
  ),
  upNext: { where: 'head', draw: (ctx) => <UpNextHead ctx={ctx} /> },
  quick: (ctx) => {
    const lowered = words.lowered(ctx.places)
    return (
      <AgentsAtOnce
        compact
        count={ctx.count}
        own={ctx.places.own}
        machine={ctx.places.machine}
        most={ctx.most}
        onChange={ctx.setCount}
        text={{ value: settingsText.atOnceValue, ...(lowered === null ? {} : { short: lowered }) }}
      />
    )
  },
  settings: (ctx) => {
    const lowered = words.lowered(ctx.places)
    return (
      <AgentsAtOnce
        count={ctx.count}
        own={ctx.places.own}
        machine={ctx.places.machine}
        most={ctx.most}
        onChange={ctx.setCount}
        text={{
          note: lowered === null ? settingsText.atOnceNote : () => lowered,
          mark: settingsText.atOnceMark,
          value: settingsText.atOnceValue,
        }}
      />
    )
  },
}
