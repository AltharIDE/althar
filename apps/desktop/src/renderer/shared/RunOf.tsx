import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { ApiError } from '@althar/contracts'
import { RunCard, type RunOutput } from '@althar/ui'

import { messageOf, type RunRef } from '../data/client'
import { useServices } from '../data/services'
import { usePageOpener } from '../features/browser/opener'
import { runCardOf } from './running'
import type { RunContent } from './thread'

/*
 * A run of the project Althar started, in the thread it was asked for in
 * (ADR-023): where it answers opens beside the conversation (ADR-100); Stop while it
 * runs, Run again once it ended. The card follows the run as the runtime
 * changes it, and stays once the run is gone. What it printed is read only
 * while its console is open, again and again while it runs.
 */

export const text = {
  notKept: 'Output not kept.',
}

/** How often what a run prints is read again while its console is open. */
const EVERY = 1_000

/** What a card asked for, as a run is asked for it again. */
const refOf = (ref: { readonly kind: 'branch' | 'pull_request'; readonly which: string }): RunRef =>
  ref.kind === 'branch' ? { branch: ref.which } : { pullRequest: ref.which }

export function RunOf({
  run,
  threadTask = null,
  onStop,
  onRunAgain,
}: {
  run: RunContent
  /** The task whose thread it is in, if any: its own run there doesn't say where it runs. */
  threadTask?: string | null
  onStop: (launchId: string) => void
  /** Runs it again, where it ran: the task's, which of the project's runnables, and the branch or pull request, fetched afresh, where the card says. */
  onRunAgain: (taskId: string | null, runnableId: string | null, ref?: RunRef) => void
}) {
  const url = run.url
  const opener = usePageOpener()
  const [open, setOpen] = useState(false)
  const output = useRunOutput(run.launchId, open, run.ended === null)
  return (
    <RunCard
      {...runCardOf(run, threadTask)}
      {...(url === null ? {} : { onOpen: () => opener.run(url) })}
      {...(run.ended === null
        ? { onStop: () => onStop(run.launchId) }
        : { onRunAgain: () => onRunAgain(run.taskId, run.runnableId ?? null, ...(run.ref == null ? [] : [refOf(run.ref)])) })}
      output={output}
      outputOpen={open}
      onOutputOpenChange={setOpen}
    />
  )
}

/** What a run printed, read while its console is open: once for a run that ended, and on and on while it runs. */
function useRunOutput(launchId: string, open: boolean, running: boolean): RunOutput {
  const { client } = useServices()
  const read = useQuery({
    // Ending needs its own snapshot even if a running read is still in flight.
    queryKey: ['launch-output', launchId, running],
    queryFn: () => client.readLaunchOutput(launchId),
    enabled: open,
    placeholderData: (previous, query) => (query?.queryKey[1] === launchId ? previous : undefined),
    staleTime: 0,
    refetchInterval: open && running ? EVERY : false,
  })
  if (read.data !== undefined) return { text: read.data.text }
  if (read.isError)
    return { error: read.error instanceof ApiError && read.error.reason === 'NotFound' ? text.notKept : messageOf(read.error) }
  return {}
}
