// Scrappy: what the directions share: the task read as a story, who is who, and opening the thread at a place.
import { type RefObject, useEffect, useMemo } from 'react'

import type { ThreadSnapshot } from '../../../../contracts/src/index'
import type { ModelInfo } from '../../../src/index'
import { useQuery } from '../deps'

import { useServices } from '../../../../../apps/desktop/src/renderer/data/services'
import { useModelNames } from '../../../../../apps/desktop/src/renderer/shared/modelNames'
import type { RoundBlock } from '../../../../../apps/desktop/src/renderer/shared/rounds'
import { snapshotOf } from '../snapshots'
import { proto } from '../state'
import { storyOf } from '../story'

/** The task as a story, from the rounds the thread has and what its reviews found, as the Changes view reads them. */
export const useStory = (rounds: ReadonlyArray<RoundBlock>, threadId: string, given?: ThreadSnapshot | null) => {
  const snapshot = given ?? snapshotOf(threadId)
  const { client } = useServices()
  const taskId = snapshot?.task.id ?? ''
  const findings = useQuery({
    queryKey: ['handoff-prototype', 'findings', taskId],
    queryFn: () => client.getTaskFindings(taskId),
    enabled: taskId !== '',
  }).data?.findings
  return useMemo(() => ({ story: storyOf(rounds, snapshot, findings ?? []), snapshot }), [rounds, snapshot, findings])
}

/** Who is who: the lead, on its session's model, and anyone else, on theirs. */
export const useWho = (session: { agentId: string; model: string | null; account: string | null } | null | undefined) => {
  const named = useModelNames()
  return {
    lead: session == null ? named(null) : named(session.agentId, session.model, session.account),
    of: (agentId: string | null): ModelInfo =>
      session != null && agentId === session.agentId ? named(agentId, session.model, session.account) : named(agentId),
  }
}

/** The nearest box around it that scrolls. */
const scrollerOf = (from: HTMLElement): HTMLElement | null => {
  for (let box = from.parentElement; box !== null; box = box.parentElement) {
    const { overflowY } = getComputedStyle(box)
    if (overflowY === 'auto' || overflowY === 'scroll') return box
  }
  return null
}

/** Opens the thread with this at its top, once, as the task opens: after the thread has followed its end. */
export const useOpenAt = (ref: RefObject<HTMLElement | null>, gap = 20) => {
  useEffect(() => {
    if (proto.get().opening.top) return
    let done = false
    const place = () => {
      const el = ref.current
      const box = el === null ? null : scrollerOf(el)
      if (el === null || box === null || done) return
      const at = el.getBoundingClientRect().top - box.getBoundingClientRect().top
      box.scrollTop += at - gap
    }
    const timers = [80, 260].map((ms) => window.setTimeout(place, ms))
    const stop = window.setTimeout(() => {
      done = true
    }, 300)
    return () => {
      for (const timer of [...timers, stop]) window.clearTimeout(timer)
    }
  }, [ref, gap])
}
