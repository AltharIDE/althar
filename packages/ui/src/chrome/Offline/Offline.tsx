import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Icon } from '../../foundations/Icon/Icon'
import s from './Offline.module.css'

/*
 * The computer is offline: one quiet word in the window's bar, for the whole
 * app, never a card per task. Work that was under way waits for the
 * connection and carries on by itself once it is back, and work waiting to
 * start stays waiting, so there is nothing to do but know (ADR-060).
 */

export interface OfflineText {
  offline: string
}

export const offlineText: OfflineText = {
  offline: 'Offline',
}

export type OfflineProps = RootProps<'output', { text?: Partial<OfflineText> }>

export function Offline({ text, className, ...rest }: OfflineProps) {
  const t = { ...offlineText, ...text }
  return (
    // An output is a live status: the line is read out as it appears.
    <output className={cx(s.line, className)} {...rest}>
      <Icon name="offline" size={12} className={s.icon} />
      {t.offline}
    </output>
  )
}
