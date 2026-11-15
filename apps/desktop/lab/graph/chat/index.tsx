import { plan } from '../plan'
import { option, stage, useStore } from '../state'
import { LaunchedCard } from './Beside'
import { CardMoves } from './CardMoves'
import { DockLine } from './Dock'
import { VersionLine, Written } from './Written'

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
  if (kind === 'card') return <CardMoves version={version} />
  if (kind === 'written') return <Written />
  if (kind === 'diff') return <VersionLine version={version} />
  if (kind === 'chip') return <DockLine version={version} />
  if (kind === 'launched') return <LaunchedCard />
  return null
}

/** Whether the plan takes the board's place: beside the talk (D), while it's planned. */
export const useBesideTalk = (): boolean => {
  const picked = useStore(option.chat)
  const now = useStore(stage)
  return picked === 'd' && now === 'plan'
}

export { PlanBeside } from './Beside'
