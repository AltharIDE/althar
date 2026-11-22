import { useState } from 'react'
import {
  BrandMark,
  ChromeButton,
  Icon,
  LinkButton,
  Menu,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  Popover,
  SettingGroup,
  SettingList,
} from '@althar/ui'

import lp from '../../../../../packages/ui/src/chrome/LoadMeter/LoadPeek.module.css'
import h from '../../../src/renderer/features/homes/Homes.module.css'
import type { Worker } from '../data'
import { Bar, Gauges, Peek, ShowInBar, Slider } from '../parts'
import { words } from '../words'
import type { Ctx, Take } from './types'
import t from './takes.module.css'

/*
 * Three takes on where the home's workers live, this Mac first. In each, This
 * Mac (what the CPU and MEM meter opens) keeps its load as built and adds its
 * Agents beside CPU and Memory, in their form; and each worker has its own
 * Agents at once in Settings. They differ in where the other workers show:
 *
 * A · under This Mac: in its popover, after its readings, each with the bar's
 *     own meters, opening in place.
 * B · in Homes: the chip's menu lists them; an offline one shows on the chip.
 * C · at the slider: the quick settings and Settings say what each runs now.
 */

const others = (ctx: Ctx) => ctx.workers.filter((one) => !one.here)
const lead = (worker: Worker) => <Icon name={worker.offline === null ? 'computer' : 'unlinked'} size={13} />

/** This Mac, as built, with its Agents; `between` goes before what runs on it. */
const here = (ctx: Ctx, between?: React.ReactNode) => (
  <Peek
    ctx={ctx}
    worker={ctx.here}
    load={ctx.load}
    waiting={ctx.waiting.length}
    between={between}
    {...(between !== undefined && others(ctx).length > 0 ? { running: words.runningHere } : {})}
    foot={<ShowInBar ctx={ctx} />}
    close={() => ctx.peek.set(false)}
  />
)

/** Each other worker's Agents at once, in Settings: calm, saying only what is off; or, at the slider, what each runs now. */
function OtherWorkers({ ctx, live }: { ctx: Ctx; live: boolean }) {
  const rest = others(ctx)
  if (rest.length === 0) return null
  return (
    <SettingGroup title={words.otherWorkers} headingLevel={2}>
      <SettingList>
        {rest.map((one) => (
          <div key={one.id} id={`worker-${one.id}`}>
            <Slider
              ctx={ctx}
              worker={one}
              compact={false}
              title={one.name}
              note={one.offline !== null ? words.line(one) : live ? `${words.line(one)} · ${words.load(one)}` : null}
            />
          </div>
        ))}
      </SettingList>
    </SettingGroup>
  )
}

/* A · under This Mac ------------------------------------------------------------------------------------- */

/** What runs on a worker, opened in place under its row. */
function Opened({ ctx, worker }: { ctx: Ctx; worker: Worker }) {
  const tasks = [...new Map(worker.agents.map((one) => [one.taskId, one])).values()]
  return (
    <div className={t.opened}>
      {worker.offline === null &&
        (tasks.length === 0 ? (
          <span className={lp.meta}>No agents at work</span>
        ) : (
          tasks.map((one) => (
            <button
              key={one.taskId}
              type="button"
              className={t.task}
              onClick={() => {
                ctx.peek.set(false)
                ctx.onOpen(one.taskId)
              }}
            >
              <BrandMark brand={one.mark} size={12} className={lp.mark} />
              <span className={t.taskTitle}>{one.title}</span>
              <span className={lp.meta}>{one.project}</span>
            </button>
          ))
        ))}
      <span className={t.number}>
        {words.atOnce} · {worker.configured}
        <LinkButton
          onClick={() => {
            ctx.peek.set(false)
            ctx.settings(worker.id)
          }}
        >
          Change
        </LinkButton>
      </span>
    </div>
  )
}

function WorkersUnder({ ctx }: { ctx: Ctx }) {
  const [open, setOpen] = useState<string | null>(null)
  const rest = others(ctx)
  if (rest.length === 0) return null
  return (
    <section className={lp.rows}>
      <span className={lp.rowsHead}>
        <h3 className={lp.eyebrow}>{words.otherWorkers}</h3>
        <span className={lp.eyebrow}>{words.agents}</span>
      </span>
      <ul className={lp.list}>
        {rest.map((one) => {
          const lowered = words.lowered(one)
          return (
            <li key={one.id}>
              <button
                type="button"
                className={`${lp.share} ${lp.way} ${t.worker}`}
                aria-expanded={open === one.id}
                onClick={() => setOpen(open === one.id ? null : one.id)}
              >
                <span className={`${lp.mark} ${one.offline === null ? '' : t.danger}`}>{lead(one)}</span>
                <span className={lp.words}>
                  <span className={lp.title}>{one.name}</span>
                  {one.offline === null ? (
                    <span className={t.gauges}>
                      <Gauges load={ctx.loadOf(one)} />
                    </span>
                  ) : (
                    <span className={t.problem}>
                      <span className={t.danger}>{words.away(one)}</span> · {words.holding(one)}
                    </span>
                  )}
                  {lowered !== null && <span className={t.problem}>{lowered}</span>}
                </span>
                <span className={lp.figures}>{one.offline === null && <span className={lp.figure}>{words.of(one)}</span>}</span>
              </button>
              {open === one.id && <Opened ctx={ctx} worker={one} />}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export const A: Take = {
  key: 'a',
  kbd: 'a',
  label: 'A · Under This Mac',
  idea: 'A · This Mac first; the other workers under it, each with the bar’s CPU and MEM, opening in place',
  opens: 'peek',
  bar: (ctx) => <Bar ctx={ctx}>{here(ctx, <WorkersUnder ctx={ctx} />)}</Bar>,
  slider: (ctx, compact) => <Slider ctx={ctx} worker={ctx.here} compact={compact} />,
  settings: (ctx) => <OtherWorkers ctx={ctx} live={false} />,
}

/* B · in Homes ------------------------------------------------------------------------------------------- */

/** A worker's line in the menu: what is off, or how hard it works. */
const described = (one: Worker) =>
  one.offline !== null ? (
    <>
      <span className={t.danger}>{words.away(one)}</span> · {words.holding(one)}
    </>
  ) : (
    (words.lowered(one) ?? words.load(one))
  )

function Homes({ ctx }: { ctx: Ctx }) {
  const [shown, setShown] = useState<string | null>(null)
  const down = ctx.workers.filter((one) => one.offline !== null)
  const worker = ctx.workers.find((one) => one.id === shown)
  const trigger =
    down.length === 0 ? (
      <ChromeButton icon="plug" label="Homes" compact />
    ) : (
      <button
        type="button"
        className={h.chip}
        data-down
        aria-label={`${down.length === 1 ? down[0]!.name : `${down.length} workers`} offline. Homes`}
      >
        <Icon name="unlinked" size={13} />
        <span className={h.chipName}>{down.length === 1 ? down[0]!.name : `${down.length} workers`}</span>
        <span className={h.chipDown}>{words.offline}</span>
      </button>
    )
  return (
    <span className={h.chipRow}>
      <Menu
        label="Homes"
        trigger={trigger}
        align="end"
        width={300}
        descriptions="under"
        open={ctx.homes.open}
        onOpenChange={ctx.homes.set}
        {...(ctx.waiting.length > 0 && ctx.workers.length > 1 ? { note: words.waiting(ctx.waiting.length) } : {})}
      >
        {ctx.workers.length > 1 && (
          <>
            <MenuGroup label={words.workers}>
              {ctx.workers.map((one) => (
                <MenuItem
                  key={one.id}
                  lead={<span className={one.offline === null ? undefined : t.danger}>{lead(one)}</span>}
                  {...(one.offline === null ? { hint: words.of(one) } : {})}
                  description={described(one)}
                  onSelect={() => (one.here ? ctx.peek.set(true) : setShown(one.id))}
                >
                  {one.name}
                </MenuItem>
              ))}
            </MenuGroup>
            <MenuSeparator />
          </>
        )}
        <MenuGroup label="Homes">
          <MenuItem lead={<Icon name="computer" />} hint="This window" onSelect={() => undefined}>
            This computer
          </MenuItem>
          <MenuItem
            lead={<Icon name="home" />}
            hint="2 h ago"
            description={<span className={h.target}>studio.tail9c2e.ts.net</span>}
            onSelect={() => ctx.say('Opens the studio home in a window of its own')}
          >
            studio
          </MenuItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem icon="plus" onSelect={() => ctx.say('Connect a home…, as it is')}>
          Connect a home…
        </MenuItem>
        <MenuItem icon="gear" onSelect={() => ctx.say('Manage homes…, as it is')}>
          Manage homes…
        </MenuItem>
      </Menu>
      {/* Another worker, chosen from the menu: This Mac's popover, drawn for it, from the chip. */}
      <Popover
        label={worker?.name ?? ''}
        placement="below"
        align="end"
        width={300}
        padded={false}
        initialFocus="panel"
        open={worker !== undefined}
        onOpenChange={(open) => {
          if (!open) setShown(null)
        }}
        trigger={<button type="button" tabIndex={-1} aria-hidden="true" className={t.anchor} />}
      >
        {worker !== undefined && (
          <Peek
            ctx={ctx}
            worker={worker}
            load={ctx.loadOf(worker)}
            side={worker.system}
            foot={
              <div className={t.foot}>
                <Slider ctx={ctx} worker={worker} compact />
              </div>
            }
            close={() => setShown(null)}
          />
        )}
      </Popover>
    </span>
  )
}

export const B: Take = {
  key: 'b',
  kbd: 'b',
  label: 'B · In Homes',
  idea: 'B · The Homes chip lists the workers, This Mac first; an offline one shows on the chip; each opens as This Mac does',
  opens: 'homes',
  bar: (ctx) => (
    <Bar ctx={ctx} homes={<Homes ctx={ctx} />}>
      {here(ctx)}
    </Bar>
  ),
  slider: (ctx, compact) => <Slider ctx={ctx} worker={ctx.here} compact={compact} />,
  settings: (ctx) => <OtherWorkers ctx={ctx} live={false} />,
}

/* C · at the slider -------------------------------------------------------------------------------------- */

/** Under This Mac's slider in the quick settings: each other worker, a line, what it runs now; pressed, its number in Settings. */
function AtTheSlider({ ctx }: { ctx: Ctx }) {
  const rest = others(ctx)
  if (rest.length === 0) return null
  return (
    <div className={t.atSlider}>
      <ul className={lp.list}>
        {rest.map((one) => (
          <li key={one.id}>
            <button
              type="button"
              className={`${lp.share} ${lp.way} ${t.line}`}
              onClick={() => {
                ctx.quick.set(false)
                ctx.settings(one.id)
              }}
            >
              <span className={`${lp.mark} ${one.offline === null ? '' : t.danger}`}>{lead(one)}</span>
              <span className={lp.words}>
                <span className={lp.title}>{one.name}</span>
                <span className={lp.meta}>
                  {one.offline !== null ? (
                    <>
                      <span className={t.danger}>{words.away(one)}</span> · {words.holding(one)}
                    </>
                  ) : (
                    (words.lowered(one) ?? words.load(one))
                  )}
                </span>
              </span>
              <span className={lp.figures}>{one.offline === null && <span className={lp.figure}>{words.of(one)}</span>}</span>
            </button>
          </li>
        ))}
      </ul>
      {ctx.waiting.length > 0 && (
        <span className={lp.other}>
          <span>{words.waiting(ctx.waiting.length)}</span>
        </span>
      )}
    </div>
  )
}

export const C: Take = {
  key: 'c',
  kbd: 'c',
  label: 'C · At the slider',
  idea: 'C · Agents at once says what each worker runs now: This Mac’s slider, then a line a worker, in the quick settings and Settings',
  opens: 'quick',
  bar: (ctx) => <Bar ctx={ctx}>{here(ctx)}</Bar>,
  slider: (ctx, compact) => (
    <Slider
      ctx={ctx}
      worker={ctx.here}
      compact={compact}
      {...(compact
        ? { short: others(ctx).length > 0 ? `${ctx.here.name} · ${words.line(ctx.here)}` : words.line(ctx.here) }
        : { note: words.line(ctx.here) })}
    />
  ),
  quick: (ctx) => <AtTheSlider ctx={ctx} />,
  settings: (ctx) => <OtherWorkers ctx={ctx} live />,
}
