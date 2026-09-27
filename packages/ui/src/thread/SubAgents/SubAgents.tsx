import { Accordion as A } from 'radix-ui'
import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { ToolState, unreachable } from '../../foundations/vocabulary'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { Caret, foldClass } from '../../primitives/Fold/Fold'
import { Spinner } from '../../primitives/Spinner/Spinner'
import s from './SubAgents.module.css'

/*
 * A sub-agent is the agent's own: it split its turn, and its calls nest under
 * it. A step is Charrette's: the task moved on and another agent took the
 * next node. The two are kept apart on purpose; see Step.
 */

export interface SubAgent {
  label: string
  model: ModelInfo
  state: ToolState
  /** How far along, or how long it took. */
  meta: string
  /** Its tool calls. */
  calls: ReactNode
}

export interface SubAgentsText {
  label: string
}

export const subAgentsText: SubAgentsText = { label: 'Sub-agents' }

function Glyph({ state }: { state: ToolState }) {
  switch (state) {
    case ToolState.Running:
      return <Spinner size="small" />
    case ToolState.Done:
      return <Icon name="check" size={11} />
    case ToolState.Failed:
      return <Icon name="close" size={11} />
    case ToolState.Declined:
      return <Icon name="stop" size={11} />
    case ToolState.Cancelled:
      return <Icon name="square" size={11} />
    default:
      return unreachable(state)
  }
}

export interface SubAgentsProps {
  list: SubAgent[]
  /** The one open, by label; controlled with onOpenChange. */
  open?: string | null
  defaultOpen?: string | null
  onOpenChange?: (label: string | null) => void
  text?: Partial<SubAgentsText>
}

/** The sub-agents a turn split into; one opens at a time, to its calls. An Accordion, from Radix. */
export function SubAgents({ list, open, defaultOpen = null, onOpenChange, text }: SubAgentsProps) {
  const t = { ...subAgentsText, ...text }
  const [current, setCurrent] = useControlled(open, defaultOpen, onOpenChange)
  return (
    <A.Root
      type="single"
      collapsible
      value={current ?? ''}
      onValueChange={(v) => setCurrent(v || null)}
      className={s.subs}
      aria-label={t.label}
      asChild
    >
      <ul>
        {list.map((a) => {
          const isOpen = current === a.label
          const running = a.state === ToolState.Running
          return (
            <A.Item key={a.label} value={a.label} asChild>
              <li className={cx(s.sub, s[a.state])} aria-busy={running || undefined}>
                <A.Header asChild>
                  <div>
                    <A.Trigger className={s.row}>
                      <Glyph state={a.state} />
                      <span className={s.label}>{a.label}</span>
                      <Model model={a.model} short />
                      <span className={s.meta}>{a.meta}</span>
                      <Caret open={isOpen} />
                    </A.Trigger>
                  </div>
                </A.Header>
                <A.Content forceMount className={foldClass.fold} inert={!isOpen}>
                  <div className={foldClass.inner}>
                    <div className={s.body}>{a.calls}</div>
                  </div>
                </A.Content>
              </li>
            </A.Item>
          )
        })}
      </ul>
    </A.Root>
  )
}
