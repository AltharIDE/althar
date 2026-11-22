import { useState } from 'react'
import { BrandMark, Icon, LinkButton } from '@althar/ui'

import lp from '../../../../packages/ui/src/chrome/LoadMeter/LoadPeek.module.css'
import type { Worker } from './data'
import { Bar, Gauges, Peek, ShowInBar, Slider } from './parts'
import type { Ctx } from './types'
import { words } from './words'
import b from './base.module.css'

/*
 * The base, as picked from the last round (A + C): the home first, in the
 * popover the bar's CPU and MEM meter opens, with its Agents beside CPU and
 * Memory, and the other workers under its readings, each with the bar's own
 * meters, opening in place (A); in the quick settings, the home's Agents at
 * once saying what is so now, and a line a worker under it (C). On this
 * computer the home is This Mac; connected to studio, studio.
 */

const others = (ctx: Ctx) => ctx.workers.filter((one) => !one.home)
const lead = (worker: Worker) => <Icon name={worker.offline === null ? 'computer' : 'unlinked'} size={13} />

/** What runs on a worker, opened in place under its row, and its number. */
function Opened({ ctx, worker }: { ctx: Ctx; worker: Worker }) {
  const tasks = [...new Map(worker.agents.map((one) => [one.taskId, one])).values()]
  return (
    <div className={b.opened}>
      {worker.offline === null &&
        (tasks.length === 0 ? (
          <span className={lp.meta}>No agents at work</span>
        ) : (
          tasks.map((one) => (
            <button
              key={one.taskId}
              type="button"
              className={b.task}
              onClick={() => {
                ctx.peek.set(false)
                ctx.onOpen(one.taskId)
              }}
            >
              <BrandMark brand={one.mark} size={12} className={lp.mark} />
              <span className={b.taskTitle}>{one.title}</span>
              <span className={lp.meta}>{one.project}</span>
            </button>
          ))
        ))}
      <span className={b.number}>
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
          const paused = one.offline === null && !ctx.taking(one.id)
          return (
            <li key={one.id}>
              <button
                type="button"
                className={`${lp.share} ${lp.way} ${b.worker}`}
                aria-expanded={open === one.id}
                onClick={() => setOpen(open === one.id ? null : one.id)}
              >
                <span className={`${lp.mark} ${one.offline === null ? '' : b.danger}`}>{lead(one)}</span>
                <span className={lp.words}>
                  <span className={lp.title}>{one.name}</span>
                  {one.offline === null ? (
                    <span className={b.gauges}>
                      <Gauges load={ctx.loadOf(one)} />
                    </span>
                  ) : (
                    <span className={b.problem}>
                      <span className={b.danger}>{words.away(one)}</span> · {words.holding(one)}
                    </span>
                  )}
                  {lowered !== null && <span className={b.problem}>{lowered}</span>}
                  {paused && <span className={b.problem}>{words.notTaking}</span>}
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

/** The bar: the home's popover, the other workers under its readings. */
export const bar = (ctx: Ctx) => (
  <Bar ctx={ctx}>
    <Peek
      ctx={ctx}
      worker={ctx.home}
      load={ctx.load}
      waiting={ctx.waiting.length}
      between={<WorkersUnder ctx={ctx} />}
      {...(others(ctx).length > 0 ? { running: words.runningOn(ctx.home.name) } : {})}
      foot={<ShowInBar ctx={ctx} />}
      close={() => ctx.peek.set(false)}
    />
  </Bar>
)

/** Under the home's slider in the quick settings: each other worker, a line, what it runs now; pressed, it in Settings. */
function AtTheSlider({ ctx }: { ctx: Ctx }) {
  const rest = others(ctx)
  if (rest.length === 0) return null
  return (
    <div className={b.atSlider}>
      <ul className={lp.list}>
        {rest.map((one) => (
          <li key={one.id}>
            <button
              type="button"
              className={`${lp.share} ${lp.way} ${b.line}`}
              onClick={() => {
                ctx.quick.set(false)
                ctx.settings(one.id)
              }}
            >
              <span className={`${lp.mark} ${one.offline === null ? '' : b.danger}`}>{lead(one)}</span>
              <span className={lp.words}>
                <span className={lp.title}>{one.name}</span>
                <span className={lp.meta}>
                  {one.offline !== null ? (
                    <>
                      <span className={b.danger}>{words.away(one)}</span> · {words.holding(one)}
                    </>
                  ) : !ctx.taking(one.id) ? (
                    words.notTaking
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

/** The quick settings: the home's Agents at once, saying what is so now, and a line a worker under it. */
export const quick = (ctx: Ctx) => (
  <>
    <Slider
      ctx={ctx}
      worker={ctx.home}
      compact
      short={others(ctx).length > 0 ? `${ctx.home.name} · ${words.line(ctx.home)}` : words.line(ctx.home)}
    />
    <AtTheSlider ctx={ctx} />
  </>
)
