import { useEffect, useRef } from 'react'

import { TaskStatus } from '@althar/ui'

import { useServices } from '../../../src/renderer/data/services'
import { noun, word } from '../plan'
import { option, scenario, stage, useStore, worldNow } from '../state'
import { graphOf } from '../view'
import { HeaderMission } from './HeaderMission'
import { Closing, Opening } from './InThread'
import { Path } from './Path'
import { RequestFace } from './RequestView'

/*
 * What a task's page takes from the lab, patched into TaskView (patches.ts),
 * each place drawn only by the option that uses it (options.ts): beside the
 * title (A), the head and the foot of its thread (B), a view of the mission
 * beside Conversation and Outputs (C), and a line under the header (D). In
 * every option, a task that waits says what for in its header. A task that
 * isn't part of a mission draws none of it.
 */

const isMissions = (slug: string | undefined): boolean =>
  stage.get() === 'run' && slug !== undefined && scenario().tasks.some((one) => `${scenario().key}-${one.key}` === slug)

/** Whether the task is one of the mission's, and C is showing. */
export const labHasRequest = (slug: string | undefined): boolean => option.task.get() === 'c' && isMissions(slug)

/** The views a task's page offers: the mission's, after the rest, where it has one. */
export const labFacesOf = <F extends string>(slug: string, faces: ReadonlyArray<F>): ReadonlyArray<F | 'request'> =>
  labHasRequest(slug) ? [...faces, 'request'] : faces

/** What the mission is called, for its view's name. */
export const labWord = (): string => word()

export function LabRequestFace({ slug }: { slug: string }) {
  useStore(noun)
  return <RequestFace slug={slug} />
}

/** What a task's header says while the runtime holds it for others: what it waits for, after the mark for after. */
export const labHeaderOf = (slug: string): { status: TaskStatus; state: string } | null => {
  const node = graphOf(scenario(), worldNow()).nodes.find((one) => one.slug === slug)
  return node !== undefined && (node.stand === 'waits' || node.stand === 'stuck') ? { status: TaskStatus.Queued, state: node.word } : null
}

/**
 * The task's thread is read anew as the option changes, since what it holds is the option's (thread.ts), and put in
 * whole in place of what the window kept: a read again keeps what it had, and an option can hold less than another.
 */
const useThreadFollowsOption = (threadId: string) => {
  const { cache, client } = useServices()
  const picked = useStore(option.task)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    void client.getThread(threadId).then((fresh) => cache.setQueryData(['thread', threadId], fresh))
  }, [cache, client, picked, threadId])
}

/** Beside the task's title: which mission and which step (A). */
export function LabBesideTitle({ slug, threadId }: { slug: string; threadId: string }) {
  useThreadFollowsOption(threadId)
  useStore(noun)
  return useStore(option.task) === 'a' ? <HeaderMission slug={slug} /> : null
}

/** A line under the header: the mission as a path (D). */
export function LabUnderHeader({ slug }: { slug: string }) {
  useStore(noun)
  return useStore(option.task) === 'd' ? <Path slug={slug} /> : null
}

/** The head of the task's thread: the plan's word for this step (B). */
export function LabThreadHead({ slug }: { slug: string }) {
  useStore(noun)
  return useStore(option.task) === 'b' ? <Opening slug={slug} /> : null
}

/** The foot of the task's thread: what merging it starts (B). */
export function LabThreadFoot({ slug }: { slug: string }) {
  return useStore(option.task) === 'b' ? <Closing slug={slug} /> : null
}
