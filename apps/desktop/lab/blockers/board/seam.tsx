import type { BoardTask } from '@althar/contracts'
import { BoardCard as KitBoardCard, BoardDivider, BoardList, NextRow as KitNextRow, type Wait } from '@althar/ui'
import type { ComponentProps, ReactNode } from 'react'

import { AbandonedCard, AskCard, BlockersFoot, Followers, WaitMenu, waitGlyph, waitWords } from '../pieces'
import { clock, direction, useStore, useWorld, worldNow } from '../state'
import { asksOf, waitingOn } from '../world'
import s from './board.module.css'

/*
 * The board's own pieces, as each direction draws them (patches.ts swaps them
 * into BoardView): a waiting task's row says what it waits for (all three);
 * in A it sits under its own heading; in B it rides under its blocker's card
 * instead, and an abandoned blocker keeps its card in Needs you; A puts the
 * question about an abandoned blocker in Needs you as a card of its own. C
 * draws nothing new: its question is the coordinator's, from the runtime.
 */

const keyOf = (id: unknown): string | null => (typeof id === 'string' && id.startsWith('t_') ? id.slice(2) : null)

/** A day's task waiting for others, by its board task. */
const waiting = (work: BoardTask) => {
  const key = keyOf(work.taskId)
  const task = key === null ? undefined : worldNow().byKey.get(key)
  return task === undefined ? null : waitWords(worldNow(), task) === null ? null : task
}

/** Its row's line, where it waits for other tasks. */
export const labReasonOf = (work: BoardTask): string | null => {
  const task = waiting(work)
  return task === null ? null : (waitWords(worldNow(), task)?.row ?? null)
}
export const labWaitOf = (work: BoardTask): Wait | null => {
  const task = waiting(work)
  return task === null ? null : waitGlyph(worldNow(), task)
}

/** The planned rows Up next lists in its line: in A and B, not those that wait for other tasks. */
export const labPlanRows = (rows: ReadonlyArray<BoardTask>): BoardTask[] =>
  direction.get() === 'c' ? [...rows] : rows.filter((work) => waiting(work) === null)

/** How many Up next counts: in B, not those riding under their blockers. */
export const labUpNext = (count: number, rows: ReadonlyArray<BoardTask>): number =>
  direction.get() === 'b' ? count - rows.filter((work) => waiting(work) !== null).length : count

/** A: what waits for other tasks, under its own heading, each row drawn as Up next draws it. */
export function LabWaiting({ rows, render }: { rows: ReadonlyArray<BoardTask>; render: (work: BoardTask) => ReactNode }) {
  useWorld()
  if (useStore(direction) !== 'a') return null
  const shown = rows.filter((work) => waiting(work) !== null)
  if (shown.length === 0) return null
  return (
    <>
      <BoardDivider>Waiting for other tasks</BoardDivider>
      <BoardList>{shown.map(render)}</BoardList>
    </>
  )
}

const ago = (minute: number) => {
  const m = Math.max(0, Math.floor(clock.get() - minute))
  return m < 1 ? 'now' : `${m}m ago`
}

/** How many asks Needs you holds besides its own: the lab's, in A and B. */
export const labAsks = (): number => (direction.get() === 'c' ? 0 : asksOf(worldNow()).length)

/** The head of Needs you: an ask for each abandoned task something waits on (A: a card of its own; B: the blocker's own card). */
export function LabYours() {
  const world = useWorld()
  const picked = useStore(direction)
  if (picked === 'c') return null
  return (
    <>
      {asksOf(world).map((ask) =>
        picked === 'a' ? (
          <AskCard key={ask.blocker.key} ask={ask} at={ago(ask.at)} />
        ) : (
          <AbandonedCard key={ask.blocker.key} ask={ask} at={ago(ask.at)} />
        ),
      )}
    </>
  )
}

/** B: a card something waits for carries what waits for it at its foot. */
export function BoardCard(props: ComponentProps<typeof KitBoardCard>) {
  const world = useWorld()
  const picked = useStore(direction)
  const key = keyOf((props as Record<string, unknown>)['data-move'])
  if (picked !== 'b' || key === null || !world.byKey.has(key) || waitingOn(world, key).length === 0) return <KitBoardCard {...props} />
  return (
    <KitBoardCard
      {...props}
      foot={
        <div className={s.foot}>
          {props.foot}
          <Followers of={key} />
        </div>
      }
    />
  )
}

/** A: a row waiting for other tasks has no place in line, and its menu sets what it waits for. */
export function NextRow(props: ComponentProps<typeof KitNextRow>) {
  const world = useWorld()
  const picked = useStore(direction)
  const key = keyOf((props as Record<string, unknown>)['data-move'])
  const task = key === null ? undefined : world.byKey.get(key)
  if (task === undefined || picked !== 'a' || task.phase !== 'waits') return <KitNextRow {...props} />
  const blocked = waitWords(world, task) !== null
  return (
    <KitNextRow
      {...props}
      {...(blocked ? { text: { ...props.text, place: () => '' }, foot: <BlockersFoot task={task} /> } : {})}
      menu={<WaitMenu task={task} />}
    />
  )
}
