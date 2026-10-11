import { useId } from 'react'

import { Icon } from '../../../foundations/Icon/Icon'
import { Rhythm } from '../../../lib/rhythm'
import s from './DraftScope.module.css'

/*
 * The coordinator's side of triage. Before a task starts, its plan says what
 * was decided with you while it was planned, and what it leaves to the lead.
 * The lead's checkpoint then covers only what was left, and doesn't ask
 * again what you already said. Nothing left reads as normal: the lead's
 * checkpoint will likely be empty, and that is the point.
 */

export interface ScopeItem {
  id: string
  says: string
}

export interface DraftScopeText {
  decided: string
  left: string
  noneDecided: string
  noneLeft: string
  note: string
}

export const draftScopeText: DraftScopeText = {
  decided: 'Decided with you',
  left: 'Left to the lead',
  noneDecided: 'Nothing yet',
  noneLeft: 'Nothing',
  note: 'The lead checks what is left at the start of Implement, and carries on unless you correct it.',
}

export interface DraftScopeProps {
  decided: readonly ScopeItem[]
  left: readonly ScopeItem[]
  text?: Partial<DraftScopeText>
}

export function DraftScope({ decided, left, text }: DraftScopeProps) {
  const t = { ...draftScopeText, ...text }
  const decidedId = useId()
  const leftId = useId()
  return (
    <div className={s.scope} data-rhythm={Rhythm.Card}>
      <div className={s.side}>
        <span id={decidedId} className={s.head}>
          {t.decided}
        </span>
        {decided.length > 0 ? (
          <ul className={s.list} aria-labelledby={decidedId}>
            {decided.map((x) => (
              <li key={x.id} className={s.item}>
                <Icon name="check" size={11} className={s.check} />
                {x.says}
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.none}>{t.noneDecided}</p>
        )}
      </div>
      <div className={s.side}>
        <span id={leftId} className={s.head}>
          {t.left}
        </span>
        {left.length > 0 ? (
          <ul className={s.list} aria-labelledby={leftId}>
            {left.map((x) => (
              <li key={x.id} className={s.item}>
                <span className={s.open} aria-hidden="true" />
                {x.says}
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.none}>{t.noneLeft}</p>
        )}
      </div>
      {left.length > 0 && <p className={s.note}>{t.note}</p>}
    </div>
  )
}
