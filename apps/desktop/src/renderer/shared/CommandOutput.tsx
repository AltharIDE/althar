import { useQuery } from '@tanstack/react-query'

import type { CommandOutput as Kept } from '@althar/contracts'
import { Terminal } from '@althar/ui'

import { messageOf } from '../data/client'
import { reads } from '../data/reads'
import { useServices } from '../data/services'
import { linesOf, type Ran } from './handed'

/*
 * A command's output in its tool call, as the kit's Terminal: while it runs,
 * what it has printed so far, the line being written ending in the cursor;
 * once it ends, what was kept, read when the person opens the call, never
 * before. Its last lines show, those before them a click away, and lines
 * Althar didn't keep are counted.
 */

export const text = {
  notKept: 'Althar didn’t keep what this printed.',
}

export interface CommandOutputProps {
  readonly threadId: string
  readonly itemId: string
  readonly ran: Ran
  /** How it ended, where it says. */
  readonly exit: number | null
  /** The command, where the tool call's row can't show all of it. */
  readonly command?: string
}

export function CommandOutput({ threadId, itemId, ran, exit, command }: CommandOutputProps) {
  const shown = command === undefined ? {} : { command }
  const ended = exit === null ? {} : { exit }
  if (ran.kind === 'running')
    return ran.heard ? (
      <Running shown={shown} text={ran.text} dropped={ran.dropped} />
    ) : (
      <RunningUnheard threadId={threadId} itemId={itemId} shown={shown} />
    )
  if (!ran.output.kept) return <Terminal {...shown} {...ended} lines={[]} {...(ran.output.lines > 0 ? { error: text.notKept } : {})} />
  return <KeptOutput threadId={threadId} itemId={itemId} output={ran.output} shown={shown} ended={ended} />
}

/** What a running command has printed so far: the line still being written ends in the cursor. */
function Running({ shown, text, dropped }: { shown: { readonly command?: string }; text: string; dropped: number }) {
  const lines = text.split('\n')
  // What follows the last newline is the line still being written.
  const live = lines.pop() ?? ''
  const { lines: last, earlier } = linesOf(lines.join('\n'))
  return <Terminal {...shown} lines={[...last]} earlier={[...earlier]} omitted={dropped} live={live} />
}

/** A command that was running before the window heard it: what it printed before then is read once, until more streams in. */
function RunningUnheard({ threadId, itemId, shown }: { threadId: string; itemId: string; shown: { readonly command?: string } }) {
  const { client } = useServices()
  const read = useQuery({ queryKey: ['output so far', threadId, itemId], queryFn: () => client.readOutput(threadId, itemId), gcTime: 0 })
  return <Running shown={shown} text={read.data?.text ?? ''} dropped={read.data?.dropped ?? 0} />
}

function KeptOutput({
  threadId,
  itemId,
  output,
  shown,
  ended,
}: {
  threadId: string
  itemId: string
  output: Kept
  shown: { readonly command?: string }
  ended: { readonly exit?: number }
}) {
  const { client } = useServices()
  const read = useQuery(reads(client).output(threadId, itemId))
  if (read.isPending) return <Terminal {...shown} lines={[]} loading />
  if (read.isError) return <Terminal {...shown} {...ended} lines={[]} error={messageOf(read.error)} />
  const { lines, earlier } = linesOf(read.data.text)
  return <Terminal {...shown} {...ended} lines={[...lines]} earlier={[...earlier]} omitted={read.data.dropped || output.dropped} />
}
