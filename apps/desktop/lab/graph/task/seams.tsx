import { TaskStatus } from '@althar/ui'

import { option, scenario, stage, worldNow } from '../state'
import { RequestFace } from './RequestView'
import { graphOf } from '../view'

/*
 * What a task's page takes from the lab, patched into TaskView (patches.ts):
 * a task of the request has a Request view beside Conversation and Outputs
 * (r), which draws the request's graph with the task in it; and its header
 * says what it waits for.
 */

/** Whether the task is one of the request's, and C is showing. */
export const labHasRequest = (slug: string | undefined): boolean =>
  stage.get() === 'run' &&
  option.task.get() === 'c' &&
  slug !== undefined &&
  scenario().tasks.some((one) => `${scenario().key}-${one.key}` === slug)

/** The views a task's page offers: the request's, after the rest, where it has one. */
export const labFacesOf = <F extends string>(slug: string, faces: ReadonlyArray<F>): ReadonlyArray<F | 'request'> =>
  labHasRequest(slug) ? [...faces, 'request'] : faces

export function LabRequestFace({ slug }: { slug: string }) {
  return <RequestFace slug={slug} />
}

/** What a task's header says while the runtime holds it for others: what it waits for, after the mark for after. */
export const labHeaderOf = (slug: string): { status: TaskStatus; state: string } | null => {
  const node = graphOf(scenario(), worldNow()).nodes.find((one) => one.slug === slug)
  return node !== undefined && (node.stand === 'waits' || node.stand === 'stuck') ? { status: TaskStatus.Queued, state: node.word } : null
}
