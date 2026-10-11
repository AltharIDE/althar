import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { safeHref } from '../../lib/safeHref'
import s from './AppVersion.module.css'

/*
 * Which Althar this is, at the foot of Settings, and the way to what changed
 * in it: its release notes, which open in the browser. Without them, the
 * version alone.
 */

export interface AppVersionText {
  name: (version: string) => string
  notes: string
}

export const appVersionText: AppVersionText = { name: (version) => `Althar ${version}`, notes: 'What’s new' }

export type AppVersionProps = RootProps<
  'span',
  {
    /** As words: 0.1.0. */
    version: string
    /** Where its release notes are. */
    notes?: string
    text?: Partial<AppVersionText>
  }
>

export function AppVersion({ version, notes, text, className, ...rest }: AppVersionProps) {
  const t = { ...appVersionText, ...text }
  const href = safeHref(notes)
  return (
    <span className={cx(s.version, className)} {...rest}>
      <span>{t.name(version)}</span>
      {href !== undefined && (
        <a className={s.notes} href={href} target="_blank" rel="noreferrer">
          {t.notes}
          <Icon name="external" size={11} />
        </a>
      )}
    </span>
  )
}
