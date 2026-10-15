import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ThreadItem } from '@althar/contracts'

import { useServices, useWatch } from '../data/services'
import { type OutputSoFar, outputsCaughtUp, withOutput } from './handed'

/*
 * Commands' output on a thread as far as it has come, while they run. It
 * streams to the window as `Output`, only while the window listens; so what
 * a running command printed before then is read: as the thread shows, as a
 * new command starts running, and whenever the watch starts listening again
 * after it broke, heard before or not. A read that began before something
 * was heard never puts back less than was heard. A command that ended is
 * read from what was kept, by its tool call, so it goes from here.
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

export const useOutputs = (
  threadId: string | null,
  items: ReadonlyArray<ThreadItem>,
  turnRunning: boolean,
): ReadonlyMap<string, OutputSoFar> => {
  const { client, feed } = useServices()
  const [outputs, setOutputs] = useState<ReadonlyMap<string, OutputSoFar>>(new Map())
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
          setOutputs((current) => withOutput(current, { itemId, ...read }))
        },
        // Nothing to read yet, or the call ended meanwhile: what streams, or what was kept, shows it.
        () => undefined,
      )
    }
  }, [client, threadId, running])

  // As the thread shows, and as another command starts running.
  useEffect(() => readRunning(), [readRunning])
  // Whenever the watch listens again, as it does after it broke.
  useEffect(() => feed.rewatched(readRunning), [feed, readRunning])

  useWatch((event) => {
    if (event._tag !== 'Output' || event.threadId !== threadId) return
    clock.current.now += 1
    clock.current.heard.set(event.itemId, clock.current.now)
    setOutputs((current) => withOutput(current, event))
  })

  // A command the store has seen end shows what was kept.
  return useMemo(() => outputsCaughtUp(outputs, items), [outputs, items])
}
