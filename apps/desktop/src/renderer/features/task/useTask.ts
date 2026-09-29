import { useCallback, useEffect, useRef, useState } from 'react'

import type { AgentStatus, ThreadSnapshot } from '@charrette/contracts'

import { messageOf } from '../../data/client'
import { useServices, useWatch } from '../../data/services'

/*
 * A task's view model: its thread as the store has it, the text an agent is
 * streaming, and what the person can do: talk to the lead, interrupt it,
 * answer its calls, change its model, hand the task to another agent, stop
 * it. The thread is read again whenever the store says the project changed,
 * a few changes at a time.
 */

/** How long changes are gathered before the thread is read again. */
const REFETCH_AFTER = 60

export interface TaskModel {
  readonly snapshot: ThreadSnapshot | null
  /** Text still streaming, by thread item. */
  readonly streaming: ReadonlyMap<string, string>
  /** Agents that could lead: signed in, or that don't say. */
  readonly agents: ReadonlyArray<AgentStatus>
  readonly error: string | null
  /** An action is on its way to the runtime. */
  readonly pending: boolean
  readonly send: (body: string) => Promise<void>
  readonly sendNow: (body: string) => Promise<void>
  readonly interrupt: () => Promise<void>
  readonly start: (agentId: string) => Promise<void>
  readonly switchAgent: (agentId: string) => Promise<void>
  readonly setModel: (model: string) => Promise<void>
  readonly stop: () => Promise<void>
  readonly answer: (attentionId: string, decision: 'allow' | 'reject', reason?: string) => Promise<void>
  readonly dismissError: () => void
}

export const useTask = (threadId: string): TaskModel => {
  const { client } = useServices()
  const [snapshot, setSnapshot] = useState<ThreadSnapshot | null>(null)
  const [streaming, setStreaming] = useState<ReadonlyMap<string, string>>(new Map())
  const [agents, setAgents] = useState<ReadonlyArray<AgentStatus>>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const projectId = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const load = useCallback(
    () =>
      client.getThread(threadId).then(
        (next) => {
          projectId.current = next.project.id
          setSnapshot(next)
          // What the store now holds in full no longer needs its streamed copy.
          setStreaming((current) => {
            const kept = new Map(current)
            for (const item of next.items) {
              const stored = (item.content as { text?: unknown } | null)?.text
              const live = kept.get(item.id)
              if (live !== undefined && typeof stored === 'string' && stored.length >= live.length) kept.delete(item.id)
            }
            return kept.size === current.size ? current : kept
          })
        },
        (failure: unknown) => setError(messageOf(failure)),
      ),
    [client, threadId],
  )

  useEffect(() => {
    void load()
    client.status().then(
      (status) => setAgents(status.agents.filter((agent) => agent.signIn !== 'signed_out')),
      (failure: unknown) => setError(messageOf(failure)),
    )
    return () => clearTimeout(timer.current)
  }, [client, load])

  useWatch((event) => {
    if (event._tag === 'Streaming') {
      if (event.threadId === threadId) setStreaming((current) => new Map(current).set(event.itemId, event.text))
      return
    }
    if (event.projectId !== projectId.current || timer.current !== undefined) return
    timer.current = setTimeout(() => {
      timer.current = undefined
      void load()
    }, REFETCH_AFTER)
  })

  /** Runs an action, says what went wrong if it did, and reads the thread again. */
  const act = useCallback(
    async (action: () => Promise<unknown>) => {
      setError(null)
      setPending(true)
      try {
        await action()
      } catch (failure) {
        setError(messageOf(failure))
      } finally {
        setPending(false)
        await load()
      }
    },
    [load],
  )

  return {
    snapshot,
    streaming,
    agents,
    error,
    pending,
    send: (body) => act(() => client.send({ threadId, body, disposition: 'after_current' })),
    sendNow: (body) => act(() => client.send({ threadId, body, disposition: 'interrupt_and_continue' })),
    interrupt: () => act(() => client.interrupt(threadId)),
    start: (agentId) => act(() => client.startSession({ threadId, agentId })),
    switchAgent: (agentId) => act(() => client.switchAgent({ threadId, agentId })),
    setModel: (model) => act(() => client.setModel({ threadId, model })),
    stop: () => act(() => client.stopSession(threadId)),
    answer: (attentionId, decision, reason) =>
      act(() => client.answer({ attentionId, decision, ...(reason === undefined || reason === '' ? {} : { reason }) })),
    dismissError: () => setError(null),
  }
}
