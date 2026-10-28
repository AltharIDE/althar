import { RunCard } from '@althar/ui'

import { runCardOf } from './running'
import type { RunContent } from './thread'

/*
 * A run of the project Althar started, in the thread it was asked for in
 * (ADR-023): where it answers opens in the person's browser; Stop while it
 * runs, Run again once it ended. The card follows the run as the runtime
 * changes it, and stays once the run is gone.
 */

export function RunOf({
  run,
  now,
  onStop,
  onRunAgain,
}: {
  run: RunContent
  now: string
  onStop: (launchId: string) => void
  /** Runs it again, where it ran: the task's, and which of the project's runnables, where the card says. */
  onRunAgain: (taskId: string | null, runnableId: string | null) => void
}) {
  const url = run.url
  return (
    <RunCard
      {...runCardOf(run, now)}
      {...(url === null ? {} : { onOpen: () => void window.open(url, '_blank') })}
      {...(run.ended === null
        ? { onStop: () => onStop(run.launchId) }
        : { onRunAgain: () => onRunAgain(run.taskId, run.runnableId ?? null) })}
    />
  )
}
