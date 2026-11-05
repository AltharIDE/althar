import { Select } from '../../primitives/Select/Select'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { SettingList, SettingRow, SettingSwitch } from '../Preferences/Preferences'

/*
 * What the rules of a project start with when it is made, as four rows of the
 * Settings tab: who answers what no rule keeps, what an account running out
 * does, whether work tries an agent's next account first, and how a task
 * ends. Only a project made from now on starts with them; every project
 * changes its own on its rules screen, and one made earlier keeps what it
 * has. Allowing everything is a switch a project turns on for itself.
 */

/** Who answers what no rule keeps. */
export type NewPermissions = 'rules' | 'coordinator' | 'ask'
/** What happens to the work when an agent's account runs out. */
export type NewUsageLimit = 'move' | 'wait' | 'ask'
/** How a task ends when its plan doesn't say. */
export type NewTaskEnd = 'draft' | 'ready' | 'none'

export interface NewProjectDefaultsValue {
  permissions: NewPermissions
  usageLimit: NewUsageLimit
  rotateAccounts: boolean
  end: NewTaskEnd
}

/** What a project starts with where nothing was chosen, which a row goes back to. */
export const newProjectDefault: NewProjectDefaultsValue = { permissions: 'rules', usageLimit: 'move', rotateAccounts: false, end: 'draft' }

interface Worded {
  readonly label: string
  readonly note: string
}

export interface NewProjectDefaultsText {
  permissions: { title: string; options: Record<NewPermissions, Worded> }
  usageLimit: { title: string; options: Record<NewUsageLimit, Worded> }
  rotate: { title: string; note: string }
  end: { title: string; options: Record<NewTaskEnd, Worded> }
  /** Goes back to what a project starts with, named. */
  reset: (label: string) => string
}

export const newProjectDefaultsText: NewProjectDefaultsText = {
  permissions: {
    title: 'Permission requests',
    options: {
      rules: { label: 'Allow, except what you keep', note: '“Always ask me” waits for you; “Never” is refused.' },
      coordinator: { label: 'The coordinator decides', note: 'What it can’t decide waits for you.' },
      ask: { label: 'Ask me', note: 'Anything beyond the task’s own files waits for you.' },
    },
  },
  usageLimit: {
    title: 'When an account runs out',
    options: {
      move: { label: 'Move to the next agent', note: 'With none free, the work waits for the reset.' },
      wait: { label: 'Wait for the reset', note: 'The work runs again at the reset.' },
      ask: { label: 'Ask me', note: 'Move it to a free model, or wait for the reset.' },
    },
  },
  rotate: { title: 'Try an agent’s other accounts first', note: 'Before the limit applies.' },
  end: {
    title: 'When a task is done',
    options: {
      draft: { label: 'Open a draft pull request', note: 'Checks run on it; you mark it ready.' },
      ready: { label: 'Open a pull request for review', note: 'Ready for review as soon as its last step passes.' },
      none: { label: 'Push the branch only', note: 'You open the pull request when you want one.' },
    },
  },
  reset: (label) => `Use ${label}`,
}

export interface NewProjectDefaultsProps {
  value: NewProjectDefaultsValue
  /** What changed; the rest stays. */
  onChange: (change: Partial<NewProjectDefaultsValue>) => void
  text?: Partial<NewProjectDefaultsText>
}

/** The four choices a new project's rules start from. */
export function NewProjectDefaults({ value, onChange, text }: NewProjectDefaultsProps) {
  const t = { ...newProjectDefaultsText, ...text }
  /** A row with a choice of words at the end; its line says what the choice does, and, away from the start, the way back. */
  const row = <V extends string>(key: 'permissions' | 'usageLimit' | 'end', title: string, options: Record<V, Worded>) => {
    const chosen = value[key] as string as V
    const start = newProjectDefault[key] as string as V
    return (
      <SettingRow
        title={title}
        note={
          <>
            {options[chosen].note}
            {chosen !== start && (
              <>
                {' '}
                <LinkButton onClick={() => onChange({ [key]: start })}>{t.reset(options[start].label)}</LinkButton>
              </>
            )}
          </>
        }
      >
        {() => (
          <Select<V>
            label={title}
            value={chosen}
            onChange={(next) => onChange({ [key]: next })}
            options={(Object.keys(options) as V[]).map((option) => ({ value: option, label: options[option].label }))}
            width={250}
          />
        )}
      </SettingRow>
    )
  }
  return (
    <SettingList>
      {row('permissions', t.permissions.title, t.permissions.options)}
      {row('usageLimit', t.usageLimit.title, t.usageLimit.options)}
      <SettingSwitch
        title={t.rotate.title}
        note={t.rotate.note}
        checked={value.rotateAccounts}
        onChange={(rotateAccounts) => onChange({ rotateAccounts })}
      />
      {row('end', t.end.title, t.end.options)}
    </SettingList>
  )
}
