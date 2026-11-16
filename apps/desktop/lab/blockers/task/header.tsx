import type { ReactNode } from 'react'

import { Icon, Popover } from '@althar/ui'

import b from '../../../../../packages/ui/src/composer/Behind/Behind.module.css'
import { option, useStore, useWorld, worldNow } from '../state'
import { shortOf, waitingOn } from '../world'
import { Chain, hasChain, taskBySlug, waits } from './chain'
import c from './task.module.css'

/*
 * D · From the header: the chip that says where the task stands opens the
 * list (chain.tsx). A task that waits says when it starts, as its row does,
 * and the words are the button; on one something waits for, a part after
 * its own words says what waits.
 */

function Pop({ children, label, trigger }: { children: ReactNode; label: string; trigger: React.ReactElement }) {
  return (
    <Popover
      label={label}
      placement="below"
      align="end"
      width={400}
      padded={false}
      initialFocus="panel"
      className={b.pop}
      trigger={trigger}
    >
      {children}
    </Popover>
  )
}

/** Its words, as a button that opens what it waits for, in D; as they are otherwise. */
function State({ slug, state }: { slug: string; state: ReactNode }) {
  const world = useWorld()
  const way = useStore(option.task)
  const task = taskBySlug(world, slug)
  if (way !== 'd' || task === undefined || !waits(world, task)) return <>{state}</>
  return (
    <Pop
      label="What this waits for"
      trigger={
        <button type="button" className={c.stateButton}>
          {state}
          <Icon name="chevronD" size={9} className={c.stateChev} />
        </button>
      }
    >
      <Chain task={task} />
    </Pop>
  )
}

export const labStateOf = (slug: string, state: ReactNode): ReactNode =>
  state == null || taskBySlug(worldNow(), slug) === undefined ? state : <State slug={slug} state={state} />

/** D, on a task something waits for: a part in its chip, after its words, saying what. */
function Beside({ slug }: { slug: string }) {
  const world = useWorld()
  const way = useStore(option.task)
  const task = taskBySlug(world, slug)
  if (way !== 'd' || task === undefined || waits(world, task) || !hasChain(world, task)) return null
  const after = waitingOn(world, task.key)
  const one = after.length === 1 ? after[0] : undefined
  return (
    <Pop
      label="What waits for this"
      trigger={
        <button type="button" className={c.beside}>
          {one === undefined ? `${after.length} wait for this` : `${shortOf(one.key)} waits for this`}
          <Icon name="chevronD" size={9} className={c.stateChev} />
        </button>
      }
    >
      <Chain task={task} />
    </Pop>
  )
}

/** The part, where the way is D and something waits for it; nothing otherwise. */
export const labBesideOf = (slug: string): { beside?: ReactNode } => {
  const world = worldNow()
  const task = taskBySlug(world, slug)
  return option.task.get() === 'd' && task !== undefined && !waits(world, task) && hasChain(world, task)
    ? { beside: <Beside slug={slug} /> }
    : {}
}
