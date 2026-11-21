import { useId, useState } from 'react'
import { BrandMark, Icon } from '@althar/ui'

import { type LoadPoint, percent } from '../../../../../packages/ui/src/chrome/LoadMeter/load'
import lp from '../../../../../packages/ui/src/chrome/LoadMeter/LoadPeek.module.css'
import { poolOf, SLOTS, type Waiting, type Worker } from '../data'
import { HeldRows, Pips, Track, WorkerGlyph } from '../parts'
import { words } from '../words'
import { take } from './meter'
import type { Ctx } from './types'
import s from './peeks.module.css'

/*
 * What the meter opens, three ways. 1 starts from how much can run: every
 * place across the computers as one track and a count, what waits in a line
 * that opens to the list, then a row a computer, each saying what is off with
 * it and how hard it works. 2 starts from this computer, as the load's peek
 * does today, with its places at the top, then the other computers a line
 * each. 3 starts from the work: what waits, first, each saying why, then what
 * runs and where. Each ends with Althar Cloud where work it could take has
 * waited, Agents at once… and Add a computer….
 */

const opener = (ctx: Ctx) => (taskId: string) => {
  ctx.peek.set(false)
  ctx.onOpen(taskId)
}

/** Where a computer's number is changed: this one's in the quick settings, the others' in Settings. */
const changeOf = (ctx: Ctx, one: Worker) => () => {
  ctx.peek.set(false)
  if (one.kind === 'this') ctx.quick.set(true)
  else ctx.say(`Opens Settings › Work on this Mac › ${one.name}`)
}

/** A computer's row: its name, and under it what is off with it and how hard it works, or one line of either; its cells and count at the end. */
function ComputerRow({ ctx, one, lines }: { ctx: Ctx; one: Worker; lines: 'both' | 'one' | 'none' }) {
  const state = words.stateOf(one)
  const quiet = one.places.why === 'cap' ? null : words.quietOf(one)
  const off = state !== null
  const under = lines === 'both' ? [state, quiet] : lines === 'one' ? [off ? words.stateShort(one) : quiet] : []
  return (
    <button type="button" className={`${s.computer} ${lines === 'none' ? s.computerSlim : ''}`} onClick={changeOf(ctx, one)}>
      <WorkerGlyph worker={one} className={s.glyph} />
      <span className={s.computerWords}>
        <span className={s.computerName}>{one.name}</span>
        {under.map(
          (line, i) =>
            line !== null && (
              <span key={i} className={i === 0 && off ? s.off : s.quiet}>
                {line}
              </span>
            ),
        )}
      </span>
      <Pips places={one.places} away={one.away !== null} />
      <span className={lines === 'none' && off ? s.endOff : s.end}>
        {lines === 'none' && off ? words.stateShort(one) : words.countOf(one)}
      </span>
    </button>
  )
}

/** What waits, a row a task, each opening it; where the cloud is offered, each that it could take can go there from its row. */
function WaitingRows({ ctx, waiting }: { ctx: Ctx; waiting: readonly Waiting[] }) {
  const open = opener(ctx)
  const cloud = ctx.offer?.kind === 'setup'
  return (
    <ul className={s.waits}>
      {waiting.map((one) => (
        <li key={one.taskId} className={s.wait}>
          <button type="button" className={s.waitMain} onClick={() => open(one.taskId)} title={one.title}>
            <Icon name="clock" size={11} className={s.waitIcon} />
            <span className={s.waitWords}>
              <span className={s.waitTitle}>{one.title}</span>
              <span className={s.waitMeta}>
                {[one.project, one.only?.why ?? null, words.minutes(one.minutes)].filter((part) => part !== null).join(' · ')}
              </span>
            </span>
          </button>
          {words.waitsWhy(one) !== null && <span className={s.why}>{words.waitsWhy(one)}</span>}
          {cloud && one.only === null && (
            <button
              type="button"
              className={s.toCloud}
              onClick={() => {
                ctx.peek.set(false)
                ctx.say(`Asks to run ${one.title} in Althar Cloud, and what it may spend`)
              }}
            >
              <Icon name="globe" size={12} />
              {words.runInCloud}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

/** What waits, in a line that opens to the list. */
function WaitLine({ ctx, ruled = false }: { ctx: Ctx; ruled?: boolean }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const line = words.waitLine(ctx.waiting)
  if (line === null) return null
  return (
    <div className={`${s.waitBlock} ${ruled ? s.ruled : ''}`}>
      <button type="button" className={s.waitLine} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <Icon name="clock" size={11} className={s.waitIcon} />
        <span>{line}</span>
        <Icon name={open ? 'chevronU' : 'chevronD'} size={11} className={s.chev} />
      </button>
      {open && (
        <div id={id} className={s.waitOpen}>
          <WaitingRows ctx={ctx} waiting={ctx.waiting} />
        </div>
      )}
    </div>
  )
}

const OFFER = {
  setup: { title: words.offerTitle },
  raise: { title: words.raiseTitle },
  more: { title: words.moreTitle },
} as const

/** Althar Cloud, where work it could take has waited: set it up, raise its cap, or let it run more; then Agents at once… and Add a computer…. */
function Foot({ ctx }: { ctx: Ctx }) {
  const say = (what: string) => () => {
    ctx.peek.set(false)
    ctx.say(what)
  }
  const { offer } = ctx
  return (
    <div className={s.foot}>
      {offer !== null && (
        <button
          type="button"
          className={s.offer}
          onClick={say(
            offer.kind === 'setup'
              ? 'Opens Althar Cloud: which waiting tasks to run there, and a monthly cap'
              : offer.kind === 'raise'
                ? 'Opens Althar Cloud’s cap, in Settings'
                : 'Opens Althar Cloud’s Agents at once, in Settings',
          )}
        >
          <Icon name="globe" size={14} className={s.glyph} />
          <span className={s.computerWords}>
            <span className={s.offerTitle}>{OFFER[offer.kind].title}</span>
            <span className={s.quiet}>
              {offer.kind === 'setup'
                ? words.offerNote(offer.waiting)
                : offer.kind === 'raise'
                  ? words.raiseNote(offer.waiting, offer.resets)
                  : words.moreNote(offer.waiting, offer.month)}
            </span>
          </span>
        </button>
      )}
      <button
        type="button"
        className={s.footRow}
        onClick={() => {
          ctx.peek.set(false)
          ctx.quick.set(true)
        }}
      >
        <Icon name="agents" size={14} />
        <span className={s.footName}>{words.atOnceMenu}</span>
        <span className={s.footHint}>{ctx.count}</span>
      </button>
      <button type="button" className={s.footRow} onClick={say('Opens Add a computer')}>
        <Icon name="plus" size={14} />
        <span className={s.footName}>{words.addComputer}</span>
      </button>
    </div>
  )
}

/* ---- 1 · How much can run: one track and a count, what waits in a line, a row a computer ---- */

function Throughput({ ctx }: { ctx: Ctx }) {
  const pool = poolOf(ctx.workers)
  return (
    <div className={s.peek}>
      <div className={s.head}>
        <h2 className={s.title}>{words.agents}</h2>
        <span className={s.figure}>{words.pool(pool.busy, pool.free)}</span>
      </div>
      <div className={s.trackRow}>
        <Track workers={ctx.workers} size="large" />
      </div>
      <WaitLine ctx={ctx} />
      <div className={s.scroll}>
        <ul className={s.computers}>
          {ctx.workers.map((one) => (
            <li key={one.id}>
              <ComputerRow ctx={ctx} one={one} lines="both" />
            </li>
          ))}
        </ul>
      </div>
      <Foot ctx={ctx} />
    </div>
  )
}

/* ---- 2 · This Mac first: its places, then its load as the peek has it today, then the other computers ---- */

const clamp = (n: number) => Math.min(1, Math.max(0, n))

/** The CPU over the last readings, as the kit's peek draws it: all of it as a line, Althar's part as cobalt under it. */
function Trace({ points, width, height }: { points: readonly LoadPoint[]; width: number; height: number }) {
  const pad = 1.5
  const from = Math.max(0, SLOTS - points.length)
  const x = (i: number) => (((from + i) / Math.max(1, SLOTS - 1)) * width).toFixed(1)
  const y = (v: number) => (pad + (1 - clamp(v)) * (height - pad * 2)).toFixed(1)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(p.cpu)}`).join('')
  const area = `M${x(0)} ${y(0)}${points.map((p, i) => `L${x(i)} ${y(p.work)}`).join('')}L${x(points.length - 1)} ${y(0)}Z`
  return (
    <svg className={lp.spark} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={area} className={lp.sparkOurs} />
      <path d={line} className={lp.sparkLine} />
    </svg>
  )
}

function Figure({ name, figure, total, ours }: { name: string; figure: string; total: number; ours: number }) {
  const all = clamp(total)
  const mine = Math.min(all, clamp(ours))
  return (
    <div className={lp.row}>
      <span className={lp.name}>{name}</span>
      <span className={lp.figure}>{figure}</span>
      <span className={lp.bar} aria-hidden="true">
        <i className={lp.ours} style={{ width: `${mine * 100}%` }} />
        <i className={lp.rest} style={{ width: `${(all - mine) * 100}%` }} />
      </span>
      {ours > 0 && (
        <span className={lp.work}>
          <i className={lp.key} aria-hidden="true" />
          Althar’s work {percent(ours)}%
        </span>
      )}
    </div>
  )
}

function ThisMacFirst({ ctx }: { ctx: Ctx }) {
  const { here, load } = ctx
  const state = words.stateOf(here)
  const others = ctx.workers.filter((one) => one.kind !== 'this')
  const open = opener(ctx)
  return (
    <div className={s.peek}>
      <div className={s.scroll}>
        <section className={s.mac}>
          <div className={s.macHead}>
            <h2 className={s.title}>{words.machine}</h2>
          </div>
          <button type="button" className={s.macPlaces} onClick={changeOf(ctx, here)}>
            <Pips places={here.places} size="large" />
            <span className={s.macCount}>
              {words.countOf(here)} {words.agents.toLowerCase()}
            </span>
          </button>
          {state !== null && <p className={s.lowered}>{state}</p>}
          <div className={lp.trace}>
            <Trace points={load.history} width={284} height={36} />
            <span className={lp.axis} aria-hidden="true">
              <span>2 min ago</span>
              <span>now</span>
            </span>
          </div>
          <div className={lp.machine}>
            <Figure name={words.cpu} figure={`${percent(load.cpu)}%`} total={load.cpu} ours={load.work ?? 0} />
            <Figure
              name={words.memory}
              figure={`${load.memoryUsed} of ${load.memoryTotal}`}
              total={load.memory}
              ours={load.workMemory ?? 0}
            />
          </div>
        </section>
        {others.length > 0 && (
          <section className={s.part}>
            <h3 className={s.eyebrow}>{words.otherComputers}</h3>
            <ul className={s.computers}>
              {others.map((one) => (
                <li key={one.id}>
                  <ComputerRow ctx={ctx} one={one} lines="one" />
                </li>
              ))}
            </ul>
          </section>
        )}
        {load.rows !== null && (
          <div className={`${s.mac} ${s.macRunning}`}>
            <section className={lp.rows}>
              <span className={lp.rowsHead}>
                <h3 className={lp.eyebrow}>{others.length > 0 ? `${words.running} on ${words.machine}` : words.running}</h3>
                <span className={lp.eyebrow}>{words.cpu}</span>
              </span>
              <ul className={lp.list}>
                {load.rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={`${lp.share} ${row.opens === false ? '' : lp.way}`}
                      onClick={() => (row.opens === false ? undefined : open(row.id))}
                    >
                      {row.mark !== undefined && <BrandMark brand={row.mark} size={13} className={lp.mark} />}
                      <span className={lp.words}>
                        <span className={lp.title}>{row.title}</span>
                        <span className={lp.meta}>{[row.project, row.agent].filter((part) => part !== undefined).join(' · ')}</span>
                      </span>
                      <span className={lp.figures}>
                        <span className={lp.figure}>{percent(row.cpu)}%</span>
                        <span className={lp.held}>{row.memory}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </div>
      <WaitLine ctx={ctx} ruled />
      <Foot ctx={ctx} />
    </div>
  )
}

/* ---- 3 · The work first: the computers a line each, then what waits and why, then what runs and where ---- */

function TheWork({ ctx }: { ctx: Ctx }) {
  const pool = poolOf(ctx.workers)
  const near = ctx.workers.filter((one) => one.away === null)
  const several = ctx.workers.length > 1
  const whereOf = new Map(near.flatMap((one) => one.places.held.map((held) => [held.taskId, one.name] as const)))
  return (
    <div className={s.peek}>
      <div className={s.head}>
        <h2 className={s.title}>{words.agents}</h2>
        <span className={s.figure}>{words.pool(pool.busy, pool.free)}</span>
      </div>
      <ul className={`${s.computers} ${s.strip}`}>
        {ctx.workers.map((one) => (
          <li key={one.id}>
            <ComputerRow ctx={ctx} one={one} lines="none" />
          </li>
        ))}
      </ul>
      <div className={s.scroll}>
        {ctx.waiting.length > 0 && (
          <section className={s.part}>
            <h3 className={s.eyebrow}>{words.waiting}</h3>
            <WaitingRows ctx={ctx} waiting={ctx.waiting} />
          </section>
        )}
        <section className={s.part}>
          <h3 className={s.eyebrow}>{words.running}</h3>
          <HeldRows
            held={near.flatMap((one) => one.places.held)}
            onOpen={opener(ctx)}
            {...(several ? { whereOf: (taskId: string) => whereOf.get(taskId) ?? '' } : {})}
          />
        </section>
      </div>
      <Foot ctx={ctx} />
    </div>
  )
}

export const P1 = take(
  'p1',
  '1',
  '1 How much can run',
  'Every place as one track and a count; what waits in a line that opens; a row a computer, what is off and how hard it works',
  340,
  (ctx) => <Throughput ctx={ctx} />,
)

export const P2 = take(
  'p2',
  '2',
  '2 This Mac first',
  'This Mac’s places, then its load as the peek has it today; then the other computers a line each',
  320,
  (ctx) => <ThisMacFirst ctx={ctx} />,
)

export const P3 = take(
  'p3',
  '3',
  '3 The work first',
  'The computers a line each; then what waits and why, each able to go to the cloud; then what runs and where',
  360,
  (ctx) => <TheWork ctx={ctx} />,
)
