import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Menu, MenuRadioGroup, MenuRadioItem } from '../../primitives/Menu/Menu'
import s from './LeadPick.module.css'

/*
 * Who leads a task. The coordinator recommends a lead, with its reasons; you
 * can take another. The choice and the reasons stay on the task.
 */

export interface LeadOption {
  model: ModelInfo
  /** Why it would or would not suit this task. */
  note: string
}

export interface LeadPickText {
  lead: string
  recommended: string
  /** When you chose another than the recommended one. */
  yourChoice: (recommended: string) => string
  change: string
  menu: string
  menuNote: string
}

export const leadPickText: LeadPickText = {
  lead: 'Lead',
  recommended: 'recommended by the coordinator',
  yourChoice: (rec) => `your choice · the coordinator recommended ${rec}`,
  change: 'Change',
  menu: 'Lead for this task',
  menuNote: 'Reviewers are chosen per step, in the workflow.',
}

export type LeadPickProps = RootProps<
  'div',
  {
    /** The lead, by model id. */
    value: string
    onChange: (id: string) => void
    options: readonly LeadOption[]
    /** The coordinator's recommendation, by model id. */
    recommended: string
    /** The coordinator's reasons for its recommendation; shown while it is the lead. */
    reasons: readonly string[]
    text?: Partial<LeadPickText>
  }
>

/** The lead for a task about to start: the coordinator's pick and why, and a menu to take another. */
export function LeadPick({ value, onChange, options, recommended: recommendedId, reasons, text, className, ...rest }: LeadPickProps) {
  const t = { ...leadPickText, ...text }
  const recommended = options.find((o) => o.model.id === recommendedId)
  const current = options.find((o) => o.model.id === value) ?? recommended
  if (!current) return null
  const isRecommended = current === recommended
  return (
    <div className={cx(s.lead, className)} {...rest}>
      <div className={s.top}>
        <span className={s.k}>{t.lead}</span>
        <Model model={current.model} className={s.model} />
        {recommended && <span className={s.why}>{isRecommended ? t.recommended : t.yourChoice(recommended.model.short)}</span>}
        <Menu
          label={t.menu}
          align="end"
          width={360}
          note={t.menuNote}
          trigger={
            <ActionButton className={s.change} trailingIcon="chevronD">
              {t.change}
            </ActionButton>
          }
        >
          <MenuRadioGroup label={t.menu} value={current.model.id} onChange={onChange}>
            {options.map((o) => (
              <MenuRadioItem key={o.model.id} value={o.model.id} description={o.note}>
                <Model model={o.model} />
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </Menu>
      </div>
      {isRecommended && reasons.length > 0 && (
        <ul className={s.reasons}>
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
