import { Icon, Tooltip } from '@althar/ui'

import { localText } from './local'
import s from './LocalPlace.module.css'

/**
 * Where a task works, said as Codex says it under its composer: one quiet
 * word beside the lead's model, Local, named in full on pointing (ADR-086).
 * Nothing to open: the folder is the person's own, its branch what their
 * editor shows.
 */
export function LocalPlace({ path }: { path: string | null }) {
  return (
    <Tooltip label={path === null ? localText.inCheckout : localText.inCheckoutAt(path)} placement="above">
      <span className={s.place} tabIndex={0}>
        <Icon name="folder" size={12} />
        {localText.place}
      </span>
    </Tooltip>
  )
}
