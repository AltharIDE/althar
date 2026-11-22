import { type ReactNode, useState } from 'react'
import { BrandMark, LinkButton } from '@althar/ui'

import lp from '../../../../packages/ui/src/chrome/LoadMeter/LoadPeek.module.css'
import type { Worker } from './data'
import { Glyph } from './glyph'
import { Bar, Peek, RunnersSlider, ShowInBar, Slider } from './parts'
import { KindGlyph, Runs } from './settings/pieces'
import { RUNNERS } from './settings/takes'
import type { Ctx } from './types'
import { words } from './words'
import b from './base.module.css'

/*
 * The base, as picked (A + C): the home first, in the popover the bar's CPU
 * and MEM meter opens, with its Agents beside CPU and Memory, and the other
 * computers under its readings, each a row of the popover's own with a
 * picture of what it is, opening in place (A); in the quick settings, the
 * home's Agents at once saying what is so now, and the same rows under it
 * (C). The home's cloud runners are a row like a computer's. Hosted in
 * Althar Cloud, the home runs no agents: its popover says it is always on,
 * and the quick settings' slider is its runners'.
 */

const others = (ctx: Ctx) => ctx.workers.filter((one) => !one.home)
const anyOther = (ctx: Ctx) => others(ctx).length > 0 || ctx.runners !== null

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

/** A row of the popover's own: a picture, a name and a line, a figure at the end. */
function RowOf({ picture, name, line, figure }: { picture: ReactNode; name: string; line: ReactNode; figure: string | null }) {
  return (
    <>
      <span className={`${lp.mark} ${b.icon}`}>{picture}</span>
      <span className={lp.words}>
        <span className={lp.title}>{name}</span>
        <span className={lp.meta}>{line}</span>
      </span>
      <span className={lp.figures}>{figure !== null && <span className={lp.figure}>{figure}</span>}</span>
    </>
  )
}

function Computer({ ctx, worker }: { ctx: Ctx; worker: Worker }) {
  return (
    <RowOf
      picture={<KindGlyph worker={worker} size={13} {...(worker.offline === null ? {} : { className: b.danger })} />}
      name={worker.name}
      line={<Line ctx={ctx} worker={worker} />}
      figure={worker.offline === null ? words.of(worker) : null}
    />
  )
}

function RunnersRow({ ctx }: { ctx: Ctx }) {
  const runners = ctx.runners!
  return (
    <RowOf
      picture={<Glyph kind="cloud" size={13} />}
      name={words.runners}
      line={`${words.spend(runners)} ${words.thisMonth.toLowerCase()}`}
      figure={words.runnersFigure(runners)}
    />
  )
}

/** Its number, and the way to change it in Settings. */
function AtOnce({ ctx, id, title, n }: { ctx: Ctx; id: string; title: string; n: number }) {
  return (
    <span className={b.number}>
      {title} · {n}
      <LinkButton
        onClick={() => {
          ctx.peek.set(false)
          ctx.settings(id)
        }}
      >
        Change
      </LinkButton>
    </span>
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
      <AtOnce ctx={ctx} id={worker.id} title={words.atOnce} n={worker.configured} />
    </div>
  )
}

function Others({ ctx }: { ctx: Ctx }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!anyOther(ctx)) return null
  const toggle = (id: string) => setOpen(open === id ? null : id)
  const runners =
    ctx.runners === null ? null : (
      <li>
        <button type="button" className={`${lp.share} ${lp.way}`} aria-expanded={open === RUNNERS} onClick={() => toggle(RUNNERS)}>
          <RunnersRow ctx={ctx} />
        </button>
        {open === RUNNERS && (
          <div className={b.opened}>
            <Runs ctx={ctx} />
            <AtOnce ctx={ctx} id={RUNNERS} title={words.runnersAtOnce} n={ctx.runners.atOnce} />
          </div>
        )}
      </li>
    )
  return (
    <section className={lp.rows}>
      <span className={lp.rowsHead}>
        <h3 className={lp.eyebrow}>{ctx.home.hosted === null ? words.otherComputers : words.computers}</h3>
        <span className={lp.eyebrow}>{words.agents}</span>
      </span>
      <ul className={lp.list}>
        {ctx.home.hosted !== null && runners}
        {others(ctx).map((one) => (
          <li key={one.id}>
            <button type="button" className={`${lp.share} ${lp.way}`} aria-expanded={open === one.id} onClick={() => toggle(one.id)}>
              <Computer ctx={ctx} worker={one} />
            </button>
            {open === one.id && <Opened ctx={ctx} worker={one} />}
          </li>
        ))}
        {ctx.home.hosted === null && runners}
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
      {...(anyOther(ctx) ? { running: words.runningOn(ctx.home.name) } : {})}
      foot={<ShowInBar ctx={ctx} />}
      close={() => ctx.peek.set(false)}
    />
  </Bar>
)

/** Under the slider in the quick settings: each other computer, and the runners where the slider isn't theirs, a row; pressed, it in Settings. */
function AtTheSlider({ ctx }: { ctx: Ctx }) {
  const hosted = ctx.home.hosted !== null
  if (others(ctx).length === 0 && (hosted || ctx.runners === null)) return null
  const go = (id: string) => () => {
    ctx.quick.set(false)
    ctx.settings(id)
  }
  return (
    <div className={b.atSlider}>
      <ul className={lp.list}>
        {others(ctx).map((one) => (
          <li key={one.id}>
            <button type="button" className={`${lp.share} ${lp.way}`} onClick={go(one.id)}>
              <Computer ctx={ctx} worker={one} />
            </button>
          </li>
        ))}
        {!hosted && ctx.runners !== null && (
          <li>
            <button type="button" className={`${lp.share} ${lp.way}`} onClick={go(RUNNERS)}>
              <RunnersRow ctx={ctx} />
            </button>
          </li>
        )}
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

/** The quick settings: the home's Agents at once, saying what is so now, and a row a computer under it; hosted, its runners'. */
export const quick = (ctx: Ctx) => (
  <>
    {ctx.home.hosted !== null && ctx.runners !== null ? (
      <RunnersSlider ctx={ctx} compact short={`${ctx.home.name} · ${words.runnersNow(ctx.runners)}`} />
    ) : (
      <Slider ctx={ctx} worker={ctx.home} compact short={anyOther(ctx) ? `${ctx.home.name} · ${now(ctx.home)}` : now(ctx.home)} />
    )}
    <AtTheSlider ctx={ctx} />
  </>
)
