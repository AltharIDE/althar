// Scrappy: what the takes share: the task read as a story, who is who, and opening the thread at a place.
import { type RefObject, useEffect, useMemo } from 'react'

import type { ThreadSnapshot } from '../../../../contracts/src/index'
import type { ModelInfo } from '../../../src/index'
import { useQuery } from '../deps'

import { useServices } from '../../../../../apps/desktop/src/renderer/data/services'
import { useModelNames } from '../../../../../apps/desktop/src/renderer/shared/modelNames'
import type { RoundBlock } from '../../../../../apps/desktop/src/renderer/shared/rounds'
import { snapshotOf } from '../snapshots'
import { proto } from '../state'
import { type Beat, storyOf } from '../story'

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

/**
 * Opens the thread with this at its top, once, as the task opens: after the thread has followed its end. With `start`, at
 * the thread's start instead; with ?scroll=top or end, every take opens there, for a screenshot of it scrolled.
 */
export const useOpenAt = (ref: RefObject<HTMLElement | null>, { gap = 20, start = false }: { gap?: number; start?: boolean } = {}) => {
  useEffect(() => {
    const { top, end } = proto.get().opening
    if (top || end) return
    let done = false
    const place = () => {
      const el = ref.current
      const box = el === null ? null : scrollerOf(el)
      if (el === null || box === null || done) return
      if (start) {
        box.scrollTop = 0
        return
      }
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
  }, [ref, gap, start])
}

/** The thread's beats by what the person asked: each of their messages, and everything after it until the next. */
export const exchangesOf = (beats: ReadonlyArray<Beat>) => {
  const exchanges: { ask: Extract<Beat, { kind: 'block' }> | null; beats: Beat[] }[] = []
  for (const beat of beats) {
    if (beat.kind === 'block' && beat.block.kind === 'you') exchanges.push({ ask: beat, beats: [] })
    else if (exchanges.length === 0) exchanges.push({ ask: null, beats: [beat] })
    else exchanges.at(-1)!.beats.push(beat)
  }
  return exchanges
}
