import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './SettingsNav.module.css'

/*
 * The sections of Althar's settings, down the side of their page: each by
 * its icon and its name, in groups a little apart, the one open lifted as
 * the tab with the window is. A violet dot after a name says something in
 * that section waits on the person, such as an account to sign in again.
 * Pressing one opens it; which is open is the consumer's to keep.
 */

export interface SettingsSection<V extends string> {
  id: V
  title: string
  icon: IconName
  /** Something in it waits on the person: a violet dot after its name. */
  yours?: boolean
}

export interface SettingsNavText {
  yours: string
}

export const settingsNavText: SettingsNavText = { yours: 'needs you' }

export interface SettingsNavProps<V extends string> {
  /** What the list is, for a screen reader: Settings. */
  label: string
  /** The sections, in groups a little apart: the accounts Althar works with, then its own ways, then about it. */
  groups: readonly (readonly SettingsSection<V>[])[]
  /** The section open. */
  value: V
  onChange: (id: V) => void
  className?: string
  text?: Partial<SettingsNavText>
}

/** The sections of settings, one under another, the one open lifted. */
export function SettingsNav<V extends string>({ label, groups, value, onChange, className, text }: SettingsNavProps<V>) {
  const t = { ...settingsNavText, ...text }
  return (
    <nav aria-label={label} className={cx(s.nav, className)}>
      {groups.map((group) => (
        <ul key={group.map((section) => section.id).join(' ')} className={s.group}>
          {group.map((section) => {
            const open = section.id === value
            return (
              <li key={section.id}>
                <button
                  type="button"
                  className={cx(s.section, open && s.open)}
                  aria-current={open ? 'page' : undefined}
                  onClick={() => onChange(section.id)}
                >
                  <Icon name={section.icon} size={14} className={s.icon} />
                  <span className={s.title}>{section.title}</span>
                  {section.yours === true && (
                    <>
                      <span className={s.dot} aria-hidden="true" />
                      <VisuallyHidden>, {t.yours}</VisuallyHidden>
                    </>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      ))}
    </nav>
  )
}
