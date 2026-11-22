import { useState } from 'react'
import { BrandMark, Icon, LinkButton } from '@althar/ui'

import lp from '../../../../packages/ui/src/chrome/LoadMeter/LoadPeek.module.css'
import type { Worker } from './data'
import { Bar, Peek, ShowInBar, Slider } from './parts'
import type { Ctx } from './types'
import { words } from './words'
import b from './base.module.css'

/*
 * The base, as picked (A + C): the home first, in the popover the bar's CPU
 * and MEM meter opens, with its Agents beside CPU and Memory, and the other
 * computers under its readings, each a row of the popover's own, opening in
 * place (A); in the quick settings, the home's Agents at once saying what is
 * so now, and the same rows under it (C). On this computer the home is This
 * Mac; connected to studio, studio.
 */

const others = (ctx: Ctx) => ctx.workers.filter((one) => !one.home)

/** A computer's line, problems first: out of reach, paused, lowered for now, or how hard it works. */
function Line({ ctx, worker }: { ctx: Ctx; worker: Worker }) {
  if (worker.offline !== null)
    return (
      <>
        <span className={b.danger}>{words.away(worker)}</span> · {words.holding(worker)}
      </>
    )
  if (!ctx.taking(worker.id)) return <>{words.state(worker, false)}</>
  return <>{words.lowered(worker) ?? words.load(worker)}</>
}

/** Another computer as a row of the popover's own: its picture, name and line, how many of its agents work. */
function Computer({ ctx, worker }: { ctx: Ctx; worker: Worker }) {
  return (
    <>
      <span className={`${lp.mark} ${b.icon} ${worker.offline === null ? '' : b.danger}`}>
        <Icon name={worker.offline === null ? 'computer' : 'unlinked'} size={13} />
      </span>
      <span className={lp.words}>
        <span className={lp.title}>{worker.name}</span>
        <span className={lp.meta}>
          <Line ctx={ctx} worker={worker} />
        </span>
      </span>
      <span className={lp.figures}>{worker.offline === null && <span className={lp.figure}>{words.of(worker)}</span>}</span>
    </>
  )
}

/** What runs on a computer, opened in place under its row, and its number. */
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

function Others({ ctx }: { ctx: Ctx }) {
  const [open, setOpen] = useState<string | null>(null)
  const rest = others(ctx)
  if (rest.length === 0) return null
  return (
    <section className={lp.rows}>
      <span className={lp.rowsHead}>
        <h3 className={lp.eyebrow}>{words.otherComputers}</h3>
        <span className={lp.eyebrow}>{words.agents}</span>
      </span>
      <ul className={lp.list}>
        {rest.map((one) => (
          <li key={one.id}>
            <button
              type="button"
              className={`${lp.share} ${lp.way}`}
              aria-expanded={open === one.id}
              onClick={() => setOpen(open === one.id ? null : one.id)}
            >
              <Computer ctx={ctx} worker={one} />
            </button>
            {open === one.id && <Opened ctx={ctx} worker={one} />}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The bar: the home's popover, the other computers under its readings. */
export const bar = (ctx: Ctx) => (
  <Bar ctx={ctx}>
    <Peek
      ctx={ctx}
      worker={ctx.home}
      load={ctx.load}
      waiting={ctx.waiting.length}
      between={<Others ctx={ctx} />}
      {...(others(ctx).length > 0 ? { running: words.runningOn(ctx.home.name) } : {})}
      foot={<ShowInBar ctx={ctx} />}
      close={() => ctx.peek.set(false)}
    />
  </Bar>
)

/** Under the home's slider in the quick settings: each other computer, a row; pressed, it in Settings. */
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
              className={`${lp.share} ${lp.way}`}
              onClick={() => {
                ctx.quick.set(false)
                ctx.settings(one.id)
              }}
            >
              <Computer ctx={ctx} worker={one} />
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

/** What is so now on the home: lowered for now, or how many work. */
const now = (home: Worker) => words.lowered(home) ?? (home.agents.length === 0 ? 'None at work' : `${words.of(home)} at work`)

/** The quick settings: the home's Agents at once, saying what is so now, and a line a worker under it. */
export const quick = (ctx: Ctx) => (
  <>
    <Slider ctx={ctx} worker={ctx.home} compact short={others(ctx).length > 0 ? `${ctx.home.name} · ${now(ctx.home)}` : now(ctx.home)} />
    <AtTheSlider ctx={ctx} />
  </>
)
