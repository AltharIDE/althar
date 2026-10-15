import type { Holder } from '@althar/contracts'
import { Running } from '@althar/ui'

import s from './Holders.module.css'
import { runningOf } from './running'
import { useNow } from './time'

/*
 * Who holds the places a waiting task waits for (ADR-032): the tasks whose
 * agents are at work, and, said so, those kept only by a server they left
 * running, listed under "Keeping a place" with the task each is from and a
 * Stop, so the person can free the place from where the task waits.
 */

export const text = {
  /** The pill, naming the servers that keep a place. */
  holding: 'Keeping a place',
  heldBy: (holders: ReadonlyArray<Pick<Holder, 'title' | 'kept'>>) =>
    `Held by ${holders.map((holder) => (holder.kept ? `${holder.title} (a server it left running)` : holder.title)).join(', ')}`,
}

export function Holders({
  holders,
  onStop,
}: {
  readonly holders: ReadonlyArray<Holder> | undefined
  /** Stops a command, on the thread of the task that left it running. */
  readonly onStop: (threadId: string, id: string) => void
}) {
  const now = useNow(false)
  if (holders === undefined || holders.length === 0) return null
  // Each command with the thread it is on, under an id of its own: two tasks may each have left a `bg-1`.
  const held = holders.flatMap(({ threadId, title, running }) =>
    threadId === null
      ? []
      : running.map((command) => ({ ...command, id: `${threadId} ${command.id}`, where: title, threadId, left: command.id })),
  )
  const find = (id: string) => held.find((command) => command.id === id)
  return (
    <div className={s.holders}>
      <p className={s.held}>{text.heldBy(holders)}</p>
      {held.length > 0 && (
        <Running
          processes={runningOf(held, now, { where: true })}
          text={{ title: text.holding }}
          onStop={(id) => {
            const command = find(id)
            if (command !== undefined) onStop(command.threadId, command.left)
          }}
          onOpenUrl={(id) => {
            const url = find(id)?.url
            if (url != null) window.open(url, '_blank')
          }}
        />
      )}
    </div>
  )
}
