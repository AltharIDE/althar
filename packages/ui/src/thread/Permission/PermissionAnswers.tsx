import { useRef, useState } from 'react'

import { Decision } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { useRefocus } from '../../lib/refocus'
import { Button } from '../../primitives/Button/Button'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Menu, MenuItem, MenuSeparator } from '../../primitives/Menu/Menu'
import { NoteForm, type NoteFormText } from '../../primitives/NoteForm/NoteForm'
import { offersFor, type PermissionAnswer, type PermissionRequest, permissionText, scopeChoices } from './Permission'
import s from './Permission.module.css'

/*
 * A permission's answers in small, where a whole card won't fit, as on a
 * call on the home: Deny and Allow once as buttons, and the rest in a menu
 * beside them, the same set the card offers: always allow and never allow
 * by each scope the request carries, and deny with what to do instead,
 * which opens a note in place of the buttons.
 */

export interface PermissionAnswersText {
  allowOnce: string
  deny: string
  /** The button that opens the rest, and its menu's name. */
  more: string
  /** Each "always", by what it covers: commands starting “bun test”, this exact command, its kind. */
  alwaysAllow: (scope: string) => string
  neverAllow: (scope: string) => string
  denyWithNote: string
  /** Where an "always" goes, under the menu. */
  kept: (project: string) => string
  exact: string
  prefix: (prefix: string) => string
  /** The note that says what to do instead. */
  note: Partial<NoteFormText>
}

export const permissionAnswersText: PermissionAnswersText = {
  allowOnce: 'Allow once',
  deny: 'Deny',
  more: 'More answers',
  alwaysAllow: (scope) => `Always allow ${scope}`,
  neverAllow: (scope) => `Never allow ${scope}`,
  denyWithNote: 'Deny, and say what to do instead',
  kept: (project) => `An always or a never is kept in ${project}’s rules`,
  exact: permissionText.exact,
  prefix: permissionText.prefixOption,
  note: { placeholder: permissionText.insteadPlaceholder, submit: permissionText.deny },
}

export type PermissionAnswersProps = RootProps<
  'div',
  {
    /** What it asks, and what an "always" may keep: its prefix, kind, offers and scopes, as the card takes them. */
    request: PermissionRequest
    /** The project whose rules an "always" is kept in. */
    project: string
    /** Answered: called at once. The consumer folds the call. */
    onAnswer: (answer: PermissionAnswer) => void
    text?: Partial<PermissionAnswersText>
  }
>

export function PermissionAnswers({ request, project, onAnswer, className, text, ...rest }: PermissionAnswersProps) {
  const t = { ...permissionAnswersText, ...text }
  const [noting, setNoting] = useState(false)
  const more = useRefocus<HTMLButtonElement>(noting)
  /* picking the note takes focus to its field, so the menu closing doesn't hand it back to the button */
  const toField = useRef(false)
  const offers = offersFor(request)
  const { cmd } = request

  if (noting)
    return (
      <div className={cx(s.answers, s.noting, className)} {...rest}>
        <NoteForm
          text={t.note}
          onSubmit={(note) => onAnswer({ decision: Decision.Deny, cmd, note })}
          onCancel={() => {
            toField.current = false
            setNoting(false)
          }}
        />
      </div>
    )

  const words = { exact: t.exact, prefix: t.prefix }
  const always = offers.includes(Decision.AllowAlways) ? scopeChoices(request, Decision.AllowAlways, words) : []
  const never = offers.includes(Decision.DenyAlways) ? scopeChoices(request, Decision.DenyAlways, words) : []
  return (
    <div className={cx(s.answers, className)} {...rest}>
      <Button size="small" onClick={() => onAnswer({ decision: Decision.Deny, cmd, note: '' })}>
        {t.deny}
      </Button>
      <Button size="small" variant="signal" onClick={() => onAnswer({ decision: Decision.AllowOnce, cmd })}>
        {t.allowOnce}
      </Button>
      <Menu
        label={t.more}
        align="end"
        trigger={<IconButton ref={more} icon="chevronD" size="small" label={t.more} />}
        note={always.length + never.length > 0 ? t.kept(project) : undefined}
        returnFocus={() => !toField.current}
      >
        {always.map((choice) => (
          <MenuItem key={`allow-${choice.value}`} onSelect={() => onAnswer({ decision: Decision.AllowAlways, cmd, scope: choice.value })}>
            {t.alwaysAllow(choice.label)}
          </MenuItem>
        ))}
        {always.length > 0 && <MenuSeparator />}
        <MenuItem
          onSelect={() => {
            toField.current = true
            setNoting(true)
          }}
        >
          {t.denyWithNote}
        </MenuItem>
        {never.map((choice) => (
          <MenuItem key={`never-${choice.value}`} onSelect={() => onAnswer({ decision: Decision.DenyAlways, cmd, scope: choice.value })}>
            {t.neverAllow(choice.label)}
          </MenuItem>
        ))}
      </Menu>
    </div>
  )
}
