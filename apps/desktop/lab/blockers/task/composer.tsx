import { Icon, Popover, TaskGlyph, TaskStatus } from '@althar/ui'

import b from '../../../../../packages/ui/src/composer/Behind/Behind.module.css'
import { option, useStore, useWorld } from '../state'
import { openBlockers, shortOf, waitingOn } from '../world'
import { Chain, Glyph, hasChain, standsShort, taskBySlug, troubled, waits } from './chain'
import c from './task.module.css'

/*
 * A · On the composer: the chip on its top edge, the kit's Behind chip as a
 * task waiting for a place has it, says how what it waits for stands, a part
 * each (Sealing · stuck); on a task something waits for, what waits. It opens
 * the list (chain.tsx).
 */
export function LabBehind({ slug }: { slug: string }) {
  const world = useWorld()
  const way = useStore(option.task)
  const task = taskBySlug(world, slug)
  if (way !== 'a' || task === undefined || !hasChain(world, task)) return null
  const waiting = waits(world, task)
  const open = openBlockers(world, task)
  const after = waitingOn(world, task.key)
  const said = waiting
    ? open.map((one) => `${shortOf(one.key)} ${standsShort(one)}`).join(', ')
    : `${after.length === 1 ? shortOf((after[0] as (typeof after)[number]).key) : `${after.length} tasks`} ${after.length === 1 ? 'waits' : 'wait'} for this`
  return (
    <div className={b.behind}>
      <Popover
        label={waiting ? 'What this waits for' : 'What waits for this'}
        placement="above"
        align="start"
        width={400}
        padded={false}
        initialFocus="panel"
        className={b.pop}
        trigger={
          <button type="button" className={b.chip} aria-label={said}>
            {waiting ? (
              open.map((one) => (
                <span key={one.key} className={b.part}>
                  <span className={c.chipGlyph}>
                    <Glyph task={one} />
                  </span>
                  <span className={b.name}>{shortOf(one.key)}</span>
                  <span className={troubled(one) ? b.bad : b.aside}>{standsShort(one)}</span>
                </span>
              ))
            ) : (
              <span className={b.part}>
                <span className={c.chipGlyph}>
                  <TaskGlyph status={TaskStatus.Queued} />
                </span>
                <span className={b.name}>
                  {after.length === 1 ? shortOf((after[0] as (typeof after)[number]).key) : `${after.length} tasks`}
                </span>
                <span className={b.aside}>{after.length === 1 ? 'waits for this' : 'wait for this'}</span>
              </span>
            )}
            <Icon name="chevronD" size={9} className={b.chev} />
          </button>
        }
      >
        <Chain task={task} />
      </Popover>
    </div>
  )
}
