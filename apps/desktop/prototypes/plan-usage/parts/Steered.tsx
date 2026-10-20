// Scrappy: what steering did, on a task's card. A: one quiet line, where the step went and why. B: the model the step went to, marked as moved, the reason on hover.
import { Icon, Model, Tooltip } from '@althar/ui'

import { useModelNames } from '../../../src/renderer/shared/modelNames'
import { type Steer, T } from '../data'
import { whenShort } from '../usage'
import s from './parts.module.css'

/** The steering, where it touched the task with this title. */
export const steerFor = (title: string, steer: Steer | null): Steer | null =>
  steer !== null && T[steer.task].title === title ? steer : null

/** A's line: where the step went, and why, in a few words; nothing where the card already says it (held, or asking). */
export const aWords = (steer: Steer): string | null => {
  if (steer.to === null) return null
  const step = steer.step === 'review' ? 'Review went' : 'Went'
  const from = steer.action === 'account' ? steer.from.who.replace(/^.* /, '') : steer.from.who
  const why = steer.left === 0 ? `${from} is out until ${whenShort(steer.resetsAt)}` : `${from} has ${steer.left}% left`
  return `${step} to ${steer.to.who} · ${why}`
}

export function SteerLine({ steer }: { readonly steer: Steer }) {
  const words = aWords(steer)
  if (words === null) return null
  return (
    <span className={s.steer} title={steer.words}>
      <Icon name="move" size={11} />
      <span className={s.steerWords}>{words}</span>
    </span>
  )
}

/** B's chip: the model the step went to, marked as moved; why, on hover. */
export function MovedModel({ steer }: { readonly steer: Steer }) {
  const named = useModelNames()
  if (steer.to === null) return null
  const { via: _via, ...info } = named(steer.to.agentId, steer.to.model)
  const account = steer.action === 'account' ? ` · ${steer.to.who.replace(/^.* /, '')}` : ''
  return (
    <Tooltip label={steer.words} placement="below">
      <span className={s.moved} tabIndex={0}>
        <Model model={{ ...info, short: `${info.short}${account}` }} short />
        <span className={s.movedWord}>moved</span>
      </span>
    </Tooltip>
  )
}
