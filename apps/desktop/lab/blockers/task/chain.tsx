import { ActionButton, Icon, LinkButton, TaskGlyph, TaskStatus } from '@althar/ui'

import b from '../../../../../packages/ui/src/composer/Behind/Behind.module.css'
import { move, openTask, useWorld } from '../state'
import { listed, openBlockers, shortOf, specOf, TASKS, type TaskNow, waitingOn, type WorldNow } from '../world'
import c from './task.module.css'

/*
 * What a task's page says of the tasks around it, shared by the ways that
 * open a list of them (A from the composer's chip, D from the header's): what
 * it waits for, each with how it stands, and what waits for it. Each opens
 * its task; what it still waits for can be let go, and it can start now.
 */

/** The lab's task by its slug, as it stands now. */
export const taskBySlug = (world: WorldNow, slug: string | undefined): TaskNow | undefined => {
  const key = TASKS.find((one) => one.slug === slug)?.key
  return key === undefined ? undefined : world.byKey.get(key)
}

/** Waiting for other tasks: not started, and something it waits for hasn't merged. */
export const waits = (world: WorldNow, task: TaskNow): boolean =>
  (task.phase === 'waits' || task.phase === 'starting') && openBlockers(world, task).length > 0

/** Where a task stands, as the kit's glyph draws it; an abandoned one is a cross. */
export function Glyph({ task }: { task: TaskNow }) {
  switch (task.phase) {
    case 'implement':
    case 'review':
    case 'checks':
      return <TaskGlyph status={TaskStatus.Running} />
    case 'ready':
      return <TaskGlyph status={TaskStatus.Yours} />
    case 'stuck':
      return <TaskGlyph status={TaskStatus.Stopped} />
    case 'merged':
      return <TaskGlyph status={TaskStatus.Done} />
    case 'abandoned':
      return <Icon name="close" size={11} className={c.gone} />
    case 'waits':
    case 'starting':
      return <TaskGlyph status={TaskStatus.Queued} />
  }
}

/** How it stands, in a few words, as its card says it. */
export const standsAs = (world: WorldNow, task: TaskNow): string => {
  const spec = specOf(task.key)
  switch (task.phase) {
    case 'implement':
      return 'Implementing'
    case 'review':
      return 'In review'
    case 'checks':
      return 'Checks running'
    case 'stuck':
      return `Stuck: ${spec.breaks ?? 'a check'} failed twice`
    case 'ready':
      return 'Ready to merge'
    case 'merged':
      return `Merged as #${spec.pr}`
    case 'abandoned':
      return 'Abandoned'
    case 'starting':
      return 'Starting'
    case 'waits': {
      const open = openBlockers(world, task)
      if (open.length > 0) return `Waits for ${listed(open.map((one) => shortOf(one.key)))}`
      return task.held ? 'Held' : 'Waiting'
    }
  }
}

/** In a word, for the chip: in review, stuck. */
export const standsShort = (task: TaskNow): string => {
  switch (task.phase) {
    case 'implement':
      return 'implementing'
    case 'review':
      return 'in review'
    case 'checks':
      return 'checks running'
    case 'stuck':
      return 'stuck'
    case 'ready':
      return 'ready to merge'
    case 'merged':
      return 'merged'
    case 'abandoned':
      return 'abandoned'
    case 'starting':
      return 'starting'
    case 'waits':
      return 'waiting'
  }
}

/** Something gone wrong with it: stuck, or abandoned. */
export const troubled = (task: TaskNow) => task.phase === 'stuck' || task.phase === 'abandoned'

/** A task in the list: its glyph, its title and how it stands, opening it on press; and what can be done to it, on hover. */
function Row({
  task,
  meta,
  quiet,
  acts = [],
}: {
  task: TaskNow
  meta: string
  quiet?: boolean
  acts?: ReadonlyArray<{ label: string; aria: string; run: () => void }>
}) {
  return (
    <li className={b.holder} data-quiet={quiet === true ? '' : undefined}>
      <button type="button" className={c.open} onClick={() => openTask(task.key)}>
        <span className={b.holderGlyph}>
          <Glyph task={task} />
        </span>
        <span className={b.holderMain}>
          <span className={[b.holderTitle, c.title].join(' ')} title={specOf(task.key).title}>
            {specOf(task.key).title}
          </span>
          <span className={[b.holderMeta, troubled(task) ? c.bad : ''].join(' ')}>{meta}</span>
        </span>
      </button>
      {acts.map((act) => (
        <ActionButton key={act.label} size="small" className={c.act} aria-label={act.aria} onClick={act.run}>
          {act.label}
        </ActionButton>
      ))}
    </li>
  )
}

/** What waits for this task, besides it: "Also waits for the Hosts screen", or when it starts. */
const thenWords = (world: WorldNow, after: TaskNow, key: string): string => {
  const others = openBlockers(world, after).filter((one) => one.key !== key)
  if (others.length > 0) return `Also waits for ${listed(others.map((one) => shortOf(one.key)))}`
  return after.held ? 'Held; waits for your word too' : 'Starts once this merges'
}

/**
 * The list a chip opens: what this task waits for (merged ones quiet, the
 * rest can be let go), then what waits for it; and, while it waits, Start now.
 */
export function Chain({ task }: { task: TaskNow }) {
  const world = useWorld()
  const blockers = task.blockers.map((key) => world.byKey.get(key)).filter((one): one is TaskNow => one !== undefined)
  const waiting = waits(world, task)
  const after = waitingOn(world, task.key)
  return (
    <>
      {waiting && (
        <section className={b.section} aria-label="Waits for">
          <div className={b.head} aria-hidden="true">
            Waits for
          </div>
          <ul className={b.list}>
            {blockers.map((one) => (
              <Row
                key={one.key}
                task={one}
                meta={standsAs(world, one)}
                quiet={one.phase === 'merged'}
                acts={[
                  ...(one.phase === 'abandoned'
                    ? [{ label: 'Reopen', aria: `Reopen ${shortOf(one.key)}`, run: () => move({ kind: 'reopen', key: one.key }) }]
                    : []),
                  ...(one.phase === 'merged'
                    ? []
                    : [
                        {
                          label: 'Stop waiting',
                          aria: `Stop waiting for ${shortOf(one.key)}`,
                          run: () => move({ kind: 'unblock', key: task.key, on: one.key }),
                        },
                      ]),
                ]}
              />
            ))}
          </ul>
          <div className={b.foot}>
            <LinkButton onClick={() => move({ kind: 'start', key: task.key })}>Start now, without waiting</LinkButton>
          </div>
        </section>
      )}
      {after.length > 0 && (
        <section className={b.section} aria-label={waiting ? 'Then' : 'Waiting for this'}>
          <div className={b.head} aria-hidden="true">
            {waiting ? 'Then' : 'Waiting for this'}
          </div>
          <ul className={b.list}>
            {after.map((one) => (
              <Row key={one.key} task={one} meta={thenWords(world, one, task.key)} />
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

/** Whether a task's page has anything to list: it waits, or something waits for it. */
export const hasChain = (world: WorldNow, task: TaskNow): boolean => waits(world, task) || waitingOn(world, task.key).length > 0
