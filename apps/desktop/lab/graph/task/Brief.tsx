import { Brand, Icon, Model, type ModelInfo } from '@althar/ui'

import { EFFORTS, leadOf } from '../plan'
import type { NodeView } from '../view'
import s from './Brief.module.css'

/*
 * What the plan gave a step: what it does, why it's this step, the notes
 * the person dropped on it, in their own tint, and who leads it.
 */

/** The person's notes on a step, each pinned, in the tint of what they say. */
export function Notes({ node, className }: { node: NodeView; className?: string }) {
  const notes = node.spec.notes ?? []
  if (notes.length === 0) return null
  return (
    <ul className={[s.notes, className].filter(Boolean).join(' ')} aria-label="Your notes">
      {notes.map((note) => (
        <li key={note} className={s.note}>
          <Icon name="pin" size={12} className={s.pin} />
          <span>{note}</span>
        </li>
      ))}
    </ul>
  )
}

/** The model that leads a step, as the kit draws one: any the plan can pick. */
const modelOf = (node: NodeView): ModelInfo => {
  const one = leadOf(node.spec.model)
  return {
    id: one.model,
    name: one.name,
    short: one.short,
    mark: one.lead === 'codex' ? Brand.OpenAI : Brand.Anthropic,
    runtime: one.lead,
    efforts: [],
  }
}

/** Who leads it: the model's mark and name, and its effort where the plan set one. */
export function Lead({ node, className }: { node: NodeView; className?: string }) {
  return (
    <span className={[s.lead, className].filter(Boolean).join(' ')}>
      <Model model={modelOf(node)} short />
      {node.spec.effort !== undefined && <span className={s.effort}>{EFFORTS[node.spec.effort]}</span>}
    </span>
  )
}

export function Brief({ node, lead = true }: { node: NodeView; lead?: boolean }) {
  return (
    <div className={s.brief}>
      <p className={s.what}>{node.spec.what}</p>
      <p className={s.why}>{node.spec.why}</p>
      <Notes node={node} />
      {lead && <Lead node={node} />}
    </div>
  )
}
