import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ThreadItem } from '@althar/contracts'

import { useServices, useWatch } from '../data/services'
import { type OutputSoFar, outputsCaughtUp, withOutput } from './handed'
import { type Heard, hearing, useHeard } from './heard'

/*
 * Commands' output on a thread as far as it has come, while they run. It
 * streams to the window as `Output`, only while the window listens; so what
 * a running command printed before then is read: as the thread shows, as a
 * new command starts running, and whenever the watch starts listening again
 * after it broke, heard before or not. A read that began before something
 * was heard never puts back less than was heard. A command that ended is
 * read from what was kept, by its tool call, so it goes from here. It is
 * held apart from the screen (`heard.ts`): what shows a command's output
 * reads it (`usePrinted`), and the screen isn't drawn again as it prints.
 */

/** A tool call that runs a command now: one the store hasn't seen end, on a thread whose turn runs. */
const runningCommands = (items: ReadonlyArray<ThreadItem>, turnRunning: boolean): ReadonlyArray<string> =>
  turnRunning
    ? items.flatMap((item) =>
        item.kind === 'tool_call' &&
        item.content.toolKind === 'execute' &&
        item.content.output === null &&
        item.content.status !== 'completed' &&
        item.content.status !== 'failed'
          ? [item.id]
          : [],
      )
    : []

export const useOutputs = (threadId: string | null, items: ReadonlyArray<ThreadItem>, turnRunning: boolean): Heard<OutputSoFar> => {
  const { client, feed } = useServices()
  // Another thread's commands aren't this one's: each has its own.
  const [held, setHeld] = useState(() => ({ threadId, outputs: hearing<OutputSoFar>() }))
  if (held.threadId !== threadId) setHeld({ threadId, outputs: hearing<OutputSoFar>() })
  const { outputs } = held
  /* a clock of what was heard and read, so a late read never undoes what came after it began */
  const clock = useRef({ now: 0, heard: new Map<string, number>() })
  const running = runningCommands(items, turnRunning).join(' ')

  const readRunning = useCallback(() => {
    if (threadId === null || running === '') return
    for (const itemId of running.split(' ')) {
      clock.current.now += 1
      const began = clock.current.now
      client.readOutput(threadId, itemId).then(
        (read) => {
          if ((clock.current.heard.get(itemId) ?? 0) > began) return
          outputs.change((current) => withOutput(current, { itemId, ...read }))
        },
        // Nothing to read yet, or the call ended meanwhile: what streams, or what was kept, shows it.
        () => undefined,
      )
    }
  }, [client, threadId, running, outputs])

  // As the thread shows, and as another command starts running.
  useEffect(() => readRunning(), [readRunning])
  // Whenever the watch listens again, as it does after it broke.
  useEffect(() => feed.rewatched(readRunning), [feed, readRunning])

  useWatch((event) => {
    if (event._tag !== 'Output' || event.threadId !== threadId) return
    clock.current.now += 1
    clock.current.heard.set(event.itemId, clock.current.now)
    // Only what runs is read again: what was heard of the rest goes.
    const runs = new Set(running.split(' '))
    for (const itemId of clock.current.heard.keys()) if (itemId !== event.itemId && !runs.has(itemId)) clock.current.heard.delete(itemId)
    outputs.change((current) => withOutput(current, event))
  })

  // A command the store has seen end shows what was kept; what streamed of it goes, so a screen left open doesn't keep every command's output.
  useEffect(() => outputs.change((current) => outputsCaughtUp(current, items)), [outputs, items])
  return outputs
}

/** Commands' output on a thread as far as it has come, but what the store has seen end: drawn again as it prints. */
export const usePrinted = (outputs: Heard<OutputSoFar>, items: ReadonlyArray<ThreadItem>): ReadonlyMap<string, OutputSoFar> => {
  const heard = useHeard(outputs)
  return useMemo(() => outputsCaughtUp(heard, items), [heard, items])
}
