import { type ComponentProps, useMemo } from 'react'

import type { OutputSoFar } from './handed'
import type { Heard } from './heard'
import { blocksOf, type Streamed, type ThreadSource } from './thread'
import { ThreadBlocks } from './ThreadBlocks'
import { ago, MINUTE, SECOND, useNow } from './time'
import { usePrinted } from './useOutputs'
import { useStreaming } from './useStreamed'

/** When each block was written, as the thread says it: from the time it is drawn. */
const agoNow = (iso: string) => ago(iso)

/**
 * A thread's blocks, drawn again as its agent's words stream, its commands
 * print and its clock ticks (`heard.ts`, `useNow`), and nothing around them:
 * the screen the thread is on gives what they are made from (`source`), kept
 * while its items and its turn stay as they were, and says whether it ticks
 * each second. Otherwise it ticks each minute, for how long ago each was said.
 */
export function LiveBlocks({
  source,
  streaming,
  outputs,
  ticking,
  ...shown
}: Omit<ComponentProps<typeof ThreadBlocks>, 'blocks'> & {
  readonly source: Omit<ThreadSource, 'outputs'>
  readonly streaming: Heard<Streamed>
  readonly outputs: Heard<OutputSoFar>
  readonly ticking: boolean
}) {
  const words = useStreaming(streaming, source.items)
  const printed = usePrinted(outputs, source.items)
  const now = useNow(true, ticking ? SECOND : MINUTE)
  const blocks = useMemo(() => blocksOf({ ...source, outputs: printed }, words, agoNow, now), [source, printed, words, now])
  return <ThreadBlocks {...shown} blocks={blocks} />
}
