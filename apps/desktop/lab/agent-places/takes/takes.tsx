import { useId } from 'react'
import { LinkButton, Switch } from '@althar/ui'

import { percent } from '../../../../../packages/ui/src/chrome/LoadMeter/load'
import m from '../../../../../packages/ui/src/chrome/LoadMeter/LoadMeter.module.css'
import lp from '../../../../../packages/ui/src/chrome/LoadMeter/LoadPeek.module.css'
import { isLowered } from '../data'
import { Bar, Cells, Figures, LoadGauges, Meter, Running, Trace, WorkRow } from '../parts'
import { LiveAtOnce } from '../slider'
import { words } from '../words'
import type { Ctx, Take } from './types'
import t from './takes.module.css'

/*
 * Three takes on where this computer's agents live, once the board's banner
 * goes: how many work and for what, the number, and the number lowered for
 * now and why. Homes and plan usage stay as they are in every take; so does
 * Up next, with nothing (the lab's U puts one line back to compare).
 *
 * A puts the agents in the bar, a gauge before CPU and MEM in the same
 * button, and leads what it opens. B leaves the bar as it is and makes This
 * Mac a list of its agents and what waits for one. C puts it all on the
 * slider: wherever Agents at once is, its track shows the agents at work.
 */

/** The label the meter's button reads out, in every take. */
const labelOf = (ctx: Ctx) =>
  [
    `${words.agents}: ${words.atWork(ctx.places)}`,
    words.lowered(ctx.places),
    ctx.waiting.length > 0 ? words.waiting(ctx.waiting.length) : null,
    `CPU ${percent(ctx.load.cpu)}%, memory ${percent(ctx.load.memory)}%`,
  ]
    .filter(Boolean)
    .join('. ')

/** Opens the quick settings, where the slider is, from the meter's popover. */
const toSlider = (ctx: Ctx) => () => {
  ctx.peek.set(false)
  ctx.quick.set(true)
}

/** The kit's foot: the switch that takes the meter out of the bar. */
function Foot({ ctx }: { ctx: Ctx }) {
  const id = useId()
  return (
    <div className={lp.foot}>
      <span className={lp.footWords}>
        <span id={`${id}-show`} className={lp.footTitle}>
          Show in the bar
        </span>
        <span className={lp.footNote}>Settings brings it back.</span>
      </span>
      <Switch checked onChange={() => ctx.say('Takes the meter out of the bar')} labelledBy={`${id}-show`} />
    </div>
  )
}

/* ---- A · in the bar ------------------------------------------------------------------ */

/** The agents as a gauge, in the meters' manner: a cell an agent, at work in cobalt, closed for now faded; then what waits. */
function AgentsGauge({ ctx }: { ctx: Ctx }) {
  const waits = ctx.waiting.length
  return (
    <span className={`${m.gauge} ${t.gauge}`}>
      <span className={m.name}>{words.gauge}</span>
      <Cells places={ctx.places} />
      {waits > 0 && <span className={t.waits}>+{waits}</span>}
    </span>
  )
}

function PeekA({ ctx }: { ctx: Ctx }) {
  const { places, load } = ctx
  const lowered = words.lowered(places)
  return (
    <div className={`${lp.peek} ${t.scroll}`}>
      <span className={lp.head}>
        <h2 className={lp.heading}>{words.thisMac}</h2>
      </span>
      <div className={lp.row}>
        <span className={lp.name}>{words.agents}</span>
        <span className={lp.figure}>{words.atWork(places)}</span>
        <Cells places={places} size="large" />
        {lowered !== null && (
          <span className={t.why}>
            {lowered}. {words.loweredNext(places)}
          </span>
        )}
        <span className={t.under}>
          <span>{ctx.waiting.length > 0 ? words.waiting(ctx.waiting.length) : null}</span>
          <LinkButton onClick={toSlider(ctx)}>{words.atOnce}…</LinkButton>
        </span>
      </div>
      <Trace points={load.history} />
      <Figures load={load} />
      <Running ctx={ctx} rows={load.rows ?? []} />
      <Foot ctx={ctx} />
    </div>
  )
}

export const A: Take = {
  key: 'a',
  kbd: 'a',
  label: 'A · In the bar',
  idea: 'A: an AGENTS gauge before CPU and MEM, one button; This Mac leads with its agents; the slider marks a lowered number',
  bar: (ctx) => (
    <Bar ctx={ctx}>
      <Meter
        ctx={ctx}
        label={labelOf(ctx)}
        width={300}
        trigger={
          <>
            <AgentsGauge ctx={ctx} />
            <LoadGauges load={ctx.load} />
          </>
        }
      >
        <PeekA ctx={ctx} />
      </Meter>
    </Bar>
  ),
  slider: (ctx, compact) => <LiveAtOnce places={ctx.places} most={ctx.most} onChange={ctx.setCount} compact={compact} />,
}

/* ---- B · a list in This Mac ------------------------------------------------------------- */

function PeekB({ ctx }: { ctx: Ctx }) {
  const { places, load, waiting } = ctx
  const rows = (load.rows ?? []).filter((row) => places.agents.some((one) => one.taskId === row.id))
  const rest = words.rest(places)
  const others = (load.rows ?? []).filter((row) => !rows.includes(row)).reduce((sum, row) => sum + row.cpu, 0)
  return (
    <div className={`${lp.peek} ${t.scroll}`}>
      <span className={lp.head}>
        <h2 className={lp.heading}>{words.thisMac}</h2>
        <span className={t.count}>{words.ofAgents(places)}</span>
      </span>
      <section className={lp.rows}>
        <span className={lp.rowsHead}>
          <h3 className={lp.eyebrow}>{words.atWorkHead}</h3>
          <span className={lp.eyebrow}>CPU</span>
        </span>
        <ul className={lp.list}>
          {rows.map((row) => (
            <li key={row.id}>
              <WorkRow row={row} places={places} onOpen={ctx.onOpen} />
            </li>
          ))}
          {rows.length === 0 && <li className={lp.none}>{words.nothing}</li>}
        </ul>
        {rest !== null && (
          <span className={t.rest} data-closed={isLowered(places) || undefined}>
            <span className={t.slots} aria-hidden="true">
              {Array.from({ length: Math.min(6, places.configured - Math.min(places.agents.length, places.configured)) }, (_, i) => (
                <i key={i} />
              ))}
            </span>
            {rest}
          </span>
        )}
      </section>
      {waiting.length > 0 && (
        <section className={lp.rows}>
          <span className={lp.rowsHead}>
            <h3 className={lp.eyebrow}>{words.waitingHead}</h3>
          </span>
          <ul className={lp.list}>
            {waiting.map((one, i) => (
              <li key={one.taskId}>
                <button type="button" className={`${lp.share} ${lp.way} ${t.waitRow}`} onClick={() => ctx.onOpen(one.taskId)}>
                  <span className={t.ring} aria-hidden="true" />
                  <span className={lp.words}>
                    <span className={lp.title}>{one.title}</span>
                    <span className={lp.meta}>{one.project}</span>
                  </span>
                  <span className={lp.held}>{i === 0 ? 'Next' : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className={t.machine}>
        <Trace points={load.history} width={296} height={32} />
        <Figures load={load} />
        <span className={lp.other}>
          <span>Coordinators, Althar and other apps</span>
          <span className={lp.figure}>{percent(load.cpu - (load.work ?? 0) + others)}%</span>
        </span>
      </div>
      <div className={`${lp.foot} ${t.atOnce}`}>
        <span className={lp.footWords}>
          <span className={lp.footTitle}>
            {words.atOnce} · {places.configured}
          </span>
          <span className={lp.footNote}>
            {words.lowered(places) ?? `Default for ${places.machine.memory} GB and ${places.machine.cores} cores`}
          </span>
        </span>
        <LinkButton onClick={toSlider(ctx)}>{words.change}</LinkButton>
      </div>
    </div>
  )
}

export const B: Take = {
  key: 'b',
  kbd: 'b',
  label: 'B · A list in This Mac',
  idea: 'B: the bar as it is; This Mac lists its agents, what is free or closed for now and why, and what waits; the slider marks a lowered number',
  bar: (ctx) => (
    <Bar ctx={ctx}>
      <Meter ctx={ctx} label={labelOf(ctx)} width={320} trigger={<LoadGauges load={ctx.load} />}>
        <PeekB ctx={ctx} />
      </Meter>
    </Bar>
  ),
  slider: (ctx, compact) => <LiveAtOnce places={ctx.places} most={ctx.most} onChange={ctx.setCount} compact={compact} />,
}

/* ---- C · on the slider ------------------------------------------------------------------ */

function PeekC({ ctx }: { ctx: Ctx }) {
  const { load } = ctx
  return (
    <div className={`${lp.peek} ${t.scroll}`}>
      <span className={lp.head}>
        <h2 className={lp.heading}>{words.thisMac}</h2>
      </span>
      <div className={t.sheet}>
        <LiveAtOnce places={ctx.places} most={ctx.most} onChange={ctx.setCount} compact work={{ waiting: ctx.waiting.length }} bare />
      </div>
      <Trace points={load.history} />
      <Figures load={load} />
      <Running ctx={ctx} rows={load.rows ?? []} />
      <Foot ctx={ctx} />
    </div>
  )
}

export const C: Take = {
  key: 'c',
  kbd: 'c',
  label: 'C · On the slider',
  idea: 'C: the bar as it is; wherever Agents at once is (This Mac, quick settings, Settings) its track shows the agents at work and a lowered number',
  bar: (ctx) => (
    <Bar ctx={ctx}>
      <Meter ctx={ctx} label={labelOf(ctx)} width={300} trigger={<LoadGauges load={ctx.load} />}>
        <PeekC ctx={ctx} />
      </Meter>
    </Bar>
  ),
  slider: (ctx, compact) => (
    <LiveAtOnce places={ctx.places} most={ctx.most} onChange={ctx.setCount} compact={compact} work={{ waiting: ctx.waiting.length }} />
  ),
}
