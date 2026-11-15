import { plan } from '../plan'
import { option, stage, useStore } from '../state'
import { RequestCard } from './Grows'

/*
 * The plan in the coordinator's conversation, as the chat option on show
 * draws it (options.ts): its cards in the thread, the dock over the
 * composer (C), and the plan in the board's place while it's talked over
 * beside the conversation (D).
 */

/** A plan card in the thread, by its kind and version (items.ts). */
export function PlanInThread({ kind, version }: { kind: string; version: number }) {
  useStore(plan)
  useStore(stage)
  void kind
  void version
  return <RequestCard />
}

/** Whether the plan takes the board's place: beside the talk (D), while it's planned. */
export const useBesideTalk = (): boolean => {
  const picked = useStore(option.chat)
  const now = useStore(stage)
  return picked === 'd' && now === 'plan'
}

/** The plan in the board's place, while it's talked over beside the conversation (D). */
export function PlanBeside() {
  return <div />
}
