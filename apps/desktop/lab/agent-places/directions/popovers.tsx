import { useId, useState } from 'react'
import { BrandMark, Icon, LinkButton, Menu, MenuGroup, MenuItem, MenuSeparator } from '@althar/ui'

import type { Worker } from '../data'
import { HeldRows, Pips, WorkerGlyph } from '../parts'
import { tasksOf, words } from '../words'
import { chipTrigger, PopoverChip, take, workerSlider } from './chip'
import type { Ctx } from './types'
import s from './popovers.module.css'

/*
 * What the chip opens, with this home's workers in it, four ways. W1 gives
 * each worker a section: its places, what is off with it, the work in it, its
 * number. W2 starts from the work: every worker a line at the top, then the
 * work wherever it runs, each saying where, then what waits for one worker
 * alone. W3 is a row a worker, quiet until one is opened: its work and its
 * slider, to change that worker's number right there. W4 keeps the chip's
 * homes menu and gives it the workers, a line of places each, and the work as
 * items. Each ends with Add a worker…, the other homes, Connect a home… and
 * Manage homes and workers…. With no other worker, each is This Mac alone.
 */

const opener = (ctx: Ctx) => (taskId: string) => {
  ctx.peek.set(null)
  ctx.onOpen(taskId)
}

/** Where a worker's number is changed: this computer's in the quick settings, the others' in Settings. */
const changeOf = (ctx: Ctx, one: Worker) => () => {
  ctx.peek.set(null)
  if (one.kind === 'this') ctx.quick.set(true)
  else ctx.say(`Opens Settings › Workers › ${one.name}`)
}

/** A worker's number and the way to change it, in a line; a cloud closed for the month, the way to raise its cap. */
function NumberLine({ ctx, worker }: { ctx: Ctx; worker: Worker }) {
  const capped = worker.places.why === 'cap'
  return (
    <p className={s.number}>
      <span>{words.title}</span>
      <span className={s.numberValue}>{worker.places.configured}</span>
      <LinkButton onClick={changeOf(ctx, worker)}>{capped ? words.raiseCap : words.change}</LinkButton>
    </p>
  )
}

/** Add a worker…, the other homes, and the homes' own actions. */
function Foot({ ctx }: { ctx: Ctx }) {
  const say = (what: string) => () => {
    ctx.peek.set(null)
    ctx.say(what)
  }
  return (
    <div className={s.foot}>
      <button type="button" className={s.footRow} onClick={say('Opens Add a worker')}>
        <Icon name="plus" size={14} />
        <span className={s.footName}>{words.addWorker}</span>
      </button>
      <div className={s.footRule} />
      <button type="button" className={s.footRow} onClick={say('Opens studio-vps in its own window')}>
        <Icon name="home" size={14} />
        <span className={s.footName}>studio-vps</span>
        <span className={s.footHint}>Open</span>
      </button>
      <button type="button" className={s.footRow} onClick={say('Opens Connect a home')}>
        <Icon name="plus" size={14} />
        <span className={s.footName}>Connect a home…</span>
      </button>
      <button type="button" className={s.footRow} onClick={say('Opens Manage homes and workers')}>
        <Icon name="gear" size={14} />
        <span className={s.footName}>Manage homes and workers…</span>
      </button>
    </div>
  )
}

/* ---- W1 · Each worker: a section each, its places, what is off, its work, its number ---- */

function EachWorker({ ctx }: { ctx: Ctx }) {
  const id = useId()
  const open = opener(ctx)
  return (
    <div className={s.peek}>
      <div className={s.scroll}>
        {ctx.workers.map((one) => {
          const state = words.stateOf(one)
          const spend = words.spend(one)
          return (
            <section key={one.id} className={s.home} aria-labelledby={`${id}-${one.id}`}>
              <div className={s.homeHead}>
                <WorkerGlyph worker={one} className={s.homeIcon} />
                <h2 id={`${id}-${one.id}`} className={s.homeName}>
                  {one.name}
                </h2>
                <span className={s.hint}>{spend ?? one.what}</span>
              </div>
              <div className={s.indent}>
                <div className={s.meter}>
                  <Pips places={one.places} away={one.away !== null} size="large" />
                  <span className={one.away === null ? s.count : s.countQuiet}>{words.countOf(one)}</span>
                </div>
                {state !== null && <p className={s.lowered}>{state}</p>}
                {one.places.held.length > 0 && <HeldRows held={one.places.held} onOpen={open} gone={one.away !== null} />}
                {one.away === null && <NumberLine ctx={ctx} worker={one} />}
              </div>
            </section>
          )
        })}
      </div>
      <Foot ctx={ctx} />
    </div>
  )
}

/* ---- W2 · The work, and where: the workers a line each, then the work wherever it runs, then what waits for one ---- */

function WorkAndWhere({ ctx }: { ctx: Ctx }) {
  const open = opener(ctx)
  const near = ctx.workers.filter((one) => one.away === null)
  const several = ctx.workers.length > 1
  const busy = near.reduce((sum, one) => sum + one.places.held.length, 0)
  const of = near.reduce((sum, one) => sum + one.places.configured, 0)
  const whereOf = new Map(near.flatMap((one) => one.places.held.map((held) => [held.taskId, one.name] as const)))
  const pinned = ctx.workers.flatMap((one) => one.pinned.map((task) => ({ task, worker: one })))
  return (
    <div className={s.peek}>
      <div className={s.head}>
        <Icon name="agents" size={14} className={s.homeIcon} />
        <h2 className={s.homeName}>{words.pool(busy, of, near.length)}</h2>
      </div>
      {several ? (
        <ul className={s.strip}>
          {ctx.workers.map((one) => (
            <li key={one.id}>
              <button type="button" className={s.stripRow} onClick={changeOf(ctx, one)}>
                <WorkerGlyph worker={one} className={s.homeIcon} />
                <span className={s.stripName}>{one.name}</span>
                <Pips places={one.places} away={one.away !== null} />
                <span className={one.away !== null || one.places.why !== null ? s.stripOff : s.stripEnd}>
                  {words.stateShort(one) ?? words.spendShort(one) ?? words.shortCount(one)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className={s.alone}>
          <Pips places={ctx.here.places} size="large" />
          {words.stateOf(ctx.here) !== null && <p className={s.lowered}>{words.stateOf(ctx.here)}</p>}
          <NumberLine ctx={ctx} worker={ctx.here} />
        </div>
      )}
      <div className={s.scroll}>
        <section className={s.part}>
          <h3 className={s.eyebrow}>{words.inUse}</h3>
          <HeldRows
            held={near.flatMap((one) => one.places.held)}
            onOpen={open}
            {...(several ? { whereOf: (taskId: string) => whereOf.get(taskId) ?? '' } : {})}
          />
        </section>
        {pinned.length > 0 && (
          <section className={s.part}>
            <h3 className={s.eyebrow}>{words.waiting}</h3>
            <ul className={s.waits}>
              {pinned.map(({ task, worker }) => (
                <li key={task.taskId}>
                  <button type="button" className={s.wait} onClick={() => open(task.taskId)} title={task.title}>
                    <Icon name="clock" size={11} className={s.waitIcon} />
                    <span className={s.waitWords}>
                      <span className={s.waitTitle}>{task.title}</span>
                      <span className={s.waitMeta}>
                        {task.project} · {task.why}
                      </span>
                    </span>
                    <span className={s.where}>{words.waitsFor(worker.name)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <Foot ctx={ctx} />
    </div>
  )
}

/* ---- W3 · A row a worker: quiet until opened, then its work and its slider ---- */

/** The first worker with something off, else This Mac: the one open at first. */
const firstOpen = (workers: readonly Worker[]) => (workers.find((one) => one.away !== null || one.places.why !== null) ?? workers[0]!).id

function RowAWorker({ ctx }: { ctx: Ctx }) {
  const [opened, setOpened] = useState<string | null>(() => firstOpen(ctx.workers))
  const open = opener(ctx)
  const id = useId()
  return (
    <div className={s.peek}>
      <ul className={s.workers}>
        {ctx.workers.map((one) => {
          const isOpen = opened === one.id || ctx.workers.length === 1
          const off = words.stateShort(one)
          const state = words.stateOf(one)
          return (
            <li key={one.id} className={s.workerItem} data-open={isOpen || undefined}>
              <button
                type="button"
                className={s.workerRow}
                aria-expanded={isOpen}
                aria-controls={`${id}-${one.id}`}
                onClick={() => setOpened(isOpen ? null : one.id)}
              >
                <WorkerGlyph worker={one} className={s.homeIcon} />
                <span className={s.workerWords}>
                  <span className={s.workerName}>{one.name}</span>
                  {!isOpen && (off ?? words.spendShort(one)) !== null && (
                    <span className={off === null ? s.workerQuiet : s.workerOff}>{off ?? words.spend(one)}</span>
                  )}
                </span>
                <Pips places={one.places} away={one.away !== null} />
                <span className={s.workerCount}>{words.shortCount(one)}</span>
                {ctx.workers.length > 1 && <Icon name={isOpen ? 'chevronU' : 'chevronD'} size={12} className={s.chev} />}
              </button>
              {isOpen && (
                <div id={`${id}-${one.id}`} className={s.workerBody}>
                  {/* the slider says the rest in its line */}
                  {one.away !== null && <p className={s.lowered}>{state}</p>}
                  {one.places.held.length > 0 ? (
                    <HeldRows held={one.places.held} onOpen={open} gone={one.away !== null} />
                  ) : (
                    one.places.why === null && <p className={s.quiet}>{words.nothing}</p>
                  )}
                  {one.away === null && <div className={s.workerSlider}>{workerSlider(ctx, one, true)}</div>}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <Foot ctx={ctx} />
    </div>
  )
}

/* ---- W4 · The menu: the chip's menu as it is, the workers a line of places each, the work as items ---- */

function HomesMenu({ ctx }: { ctx: Ctx }) {
  const close = () => ctx.peek.set(null)
  const say = (what: string) => () => {
    close()
    ctx.say(what)
  }
  const near = ctx.workers.filter((one) => one.away === null)
  const several = ctx.workers.length > 1
  return (
    <Menu
      label="Homes and workers"
      trigger={chipTrigger(ctx)}
      align="end"
      width={340}
      descriptions="under"
      open={ctx.peek.open === 'bar'}
      onOpenChange={(open) => ctx.peek.set(open ? 'bar' : null)}
    >
      <MenuGroup label={words.workersTitle}>
        {ctx.workers.map((one) => {
          const off = words.stateShort(one)
          return (
            <MenuItem
              key={one.id}
              lead={<WorkerGlyph worker={one} />}
              hint={words.spendShort(one) ?? one.what}
              description={
                <span className={s.menuLine}>
                  <Pips places={one.places} away={one.away !== null} />
                  <span>{one.away === null ? `${words.shortCount(one)}${off === null ? '' : ` · ${off}`}` : words.stateOf(one)}</span>
                </span>
              }
              onSelect={changeOf(ctx, one)}
            >
              {one.name}
            </MenuItem>
          )
        })}
        <MenuItem icon="plus" onSelect={say('Opens Add a worker')}>
          {words.addWorker}
        </MenuItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuGroup label={words.inUse}>
        {near.flatMap((one) =>
          tasksOf(one.places.held).map((agents) => {
            const first = agents[0]!
            return (
              <MenuItem
                key={first.taskId}
                lead={<BrandMark brand={first.mark} size={13} />}
                description={`${first.project} · ${words.roles(agents)}`}
                {...(several ? { hint: one.name } : agents.length > 1 ? { hint: words.places(agents.length) } : {})}
                onSelect={() => ctx.onOpen(first.taskId)}
              >
                {first.title}
              </MenuItem>
            )
          }),
        )}
      </MenuGroup>
      <MenuSeparator />
      <MenuItem icon="agents" hint={String(ctx.count)} onSelect={() => ctx.quick.set(true)}>
        {words.title} on {words.machine}…
      </MenuItem>
      <MenuSeparator />
      <MenuGroup label="Homes">
        <MenuItem lead={<Icon name="home" />} hint="Open" onSelect={say('Opens studio-vps in its own window')}>
          studio-vps
        </MenuItem>
        <MenuItem icon="plus" onSelect={say('Opens Connect a home')}>
          Connect a home…
        </MenuItem>
        <MenuItem icon="gear" onSelect={say('Opens Manage homes and workers')}>
          Manage homes and workers…
        </MenuItem>
      </MenuGroup>
    </Menu>
  )
}

export const W1 = take(
  'w1',
  '1',
  'W1 Each worker',
  'A section a worker: its places, what is off with it, the work in it, its number',
  (ctx) => (
    <PopoverChip ctx={ctx}>
      <EachWorker ctx={ctx} />
    </PopoverChip>
  ),
)

export const W2 = take(
  'w2',
  '2',
  'W2 The work, and where',
  'Every worker a line; then the work wherever it runs, each saying where; then what waits for one worker',
  (ctx) => (
    <PopoverChip ctx={ctx} width={360}>
      <WorkAndWhere ctx={ctx} />
    </PopoverChip>
  ),
)

export const W3 = take(
  'w3',
  '3',
  'W3 A row a worker',
  'A row a worker, quiet until opened: its work and its own slider; one with something off opens first',
  (ctx) => (
    <PopoverChip ctx={ctx}>
      <RowAWorker ctx={ctx} />
    </PopoverChip>
  ),
)

export const W4 = take(
  'w4',
  '4',
  'W4 The menu',
  'The homes menu: the workers a line of places each, the work as items, then the homes',
  (ctx) => <HomesMenu ctx={ctx} />,
)
