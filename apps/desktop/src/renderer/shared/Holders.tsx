import type { Holder } from '@althar/contracts'
import { LinkButton, Running } from '@althar/ui'

import s from './Holders.module.css'
import { runningOf } from './running'
import { useNow } from './time'

/*
 * What the person can do about the places a waiting task waits for (ADR-032):
 * the servers tasks left running that keep one, listed under "Keeping a place"
 * with the task each is from and a Stop, so the person can free the place from
 * where the task waits. A task 2nd or later in its project's line can be put at
 * its front from here. The tasks whose agents are at work aren't named: the
 * count beside "Waiting" says enough.
 */

export const text = {
  /** The pill, naming the servers that keep a place. */
  holding: 'Keeping a place',
  front: 'Move to the front of the line',
}

export function Holders({
  holders,
  onStop,
  onFront,
}: {
  readonly holders: ReadonlyArray<Holder> | undefined
  /** Stops a command, on the thread of the task that left it running. */
  readonly onStop: (threadId: string, id: string) => void
  /** Puts the task at the front of its line; absent where it is first, or not in one. */
  readonly onFront?: () => void
}) {
  const now = useNow(false)
  // Each command with the thread it is on, under an id of its own: two tasks may each have left a `bg-1`.
  const left = (holders ?? []).flatMap(({ threadId, title, running }) =>
    threadId === null
      ? []
      : running.map((command) => ({ ...command, id: `${threadId} ${command.id}`, where: title, threadId, left: command.id })),
  )
  if (left.length === 0 && onFront === undefined) return null
  const find = (id: string) => left.find((command) => command.id === id)
  return (
    <div className={s.holders}>
      {onFront !== undefined && (
        <p className={s.front}>
          <LinkButton onClick={onFront}>{text.front}</LinkButton>
        </p>
      )}
      {left.length > 0 && (
        <Running
          processes={runningOf(left, now, { where: true })}
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
