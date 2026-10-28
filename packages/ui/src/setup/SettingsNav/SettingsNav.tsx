import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './SettingsNav.module.css'

/*
 * The sections of a page of settings, down its side: each by its icon and
 * its name, in groups a little apart, the one open lifted as the tab with
 * the window is. A violet dot after a name says something in that section
 * waits on the person, such as an account to sign in again. Pressing one
 * opens it; which is open is the consumer's to keep. Under them, apart and
 * under a rule, can go one thing to do rather than a section to open, such
 * as taking a project out of Althar, in red where it takes something away.
 */

export interface SettingsSection<V extends string> {
  id: V
  title: string
  icon: IconName
  /** Something in it waits on the person: a violet dot after its name. */
  yours?: boolean
}

/** Something to do from the side, not a section: it opens what does it, such as a dialog that asks first. */
export interface SettingsNavAction {
  title: string
  icon: IconName
  onSelect: () => void
  /** It takes something away: in red. */
  danger?: boolean
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
  /** One thing to do, at the foot. */
  action?: SettingsNavAction
  className?: string
  text?: Partial<SettingsNavText>
}

/** The sections of settings, one under another, the one open lifted. */
export function SettingsNav<V extends string>({ label, groups, value, onChange, action, className, text }: SettingsNavProps<V>) {
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
      {action !== undefined && (
        <div className={s.foot}>
          <button type="button" className={cx(s.section, action.danger === true && s.danger)} onClick={action.onSelect}>
            <Icon name={action.icon} size={14} className={s.icon} />
            <span className={s.title}>{action.title}</span>
          </button>
        </div>
      )}
    </nav>
  )
}
