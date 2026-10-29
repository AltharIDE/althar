import { RunCard } from '@althar/ui'

import type { RunRef } from '../data/client'
import { runCardOf } from './running'
import type { RunContent } from './thread'

/*
 * A run of the project Althar started, in the thread it was asked for in
 * (ADR-023): where it answers opens in the person's browser; Stop while it
 * runs, Run again once it ended. The card follows the run as the runtime
 * changes it, and stays once the run is gone.
 */

/** What a card asked for, as a run is asked for it again. */
const refOf = (ref: { readonly kind: 'branch' | 'pull_request'; readonly which: string }): RunRef =>
  ref.kind === 'branch' ? { branch: ref.which } : { pullRequest: ref.which }

export function RunOf({
  run,
  now,
  onStop,
  onRunAgain,
}: {
  run: RunContent
  now: string
  onStop: (launchId: string) => void
  /** Runs it again, where it ran: the task's, which of the project's runnables, and the branch or pull request, fetched afresh, where the card says. */
  onRunAgain: (taskId: string | null, runnableId: string | null, ref?: RunRef) => void
}) {
  const url = run.url
  return (
    <RunCard
      {...runCardOf(run, now)}
      {...(url === null ? {} : { onOpen: () => void window.open(url, '_blank') })}
      {...(run.ended === null
        ? { onStop: () => onStop(run.launchId) }
        : { onRunAgain: () => onRunAgain(run.taskId, run.runnableId ?? null, ...(run.ref == null ? [] : [refOf(run.ref)])) })}
    />
  )
}
