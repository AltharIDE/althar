import { useId } from 'react'

import { ChromeButton } from '../../../chrome/ChromeButton/ChromeButton'
import { taskMenuText } from '../../../chrome/TaskMenu/TaskMenu'
import { cx } from '../../../lib/cx'
import { Menu, MenuCheckboxItem, MenuItem, MenuSeparator } from '../../../primitives/Menu/Menu'
import { Switch } from '../../../primitives/Switch/Switch'
import { ExploreIcon } from '../ExploreIcon'
import s from './OneBigSwitch.module.css'

/*
 * Path A: one switch, at the top of the rules page, over everything under
 * it. While it is on, the lists under it hold for nothing and say so; Never
 * still holds unless you also turn it off, underneath. A task has the same
 * switch in its menu, and says it is on in its bar.
 */

export interface BigSwitchText {
  title: string
  off: (project: string) => string
  on: (project: string) => string
  ignoreNever: string
  /** While Never still holds: what it still refuses. */
  neverHolds: string
  /** While Never is ignored too. */
  neverIgnored: string
}

export const bigSwitchText: BigSwitchText = {
  title: 'Allow everything',
  off: (project) => `Agents in ${project} stop to ask as the sentences below say.`,
  on: (project) => `Nothing in ${project} waits for you. Ask me, Go ahead and The rest aren’t in effect while this is on.`,
  ignoreNever: 'Ignore Never too',
  neverHolds: 'Never still holds: force pushes, aws s3 rm and doppler secrets are refused.',
  neverIgnored: 'Nothing is refused: force pushes, aws s3 rm and doppler secrets go ahead like the rest. Only Always, below, still holds.',
}

export interface BigSwitchProps {
  project: string
  on: boolean
  onChange: (on: boolean) => void
  ignoreNever: boolean
  onIgnoreNeverChange: (ignore: boolean) => void
  text?: Partial<BigSwitchText>
}

/** The switch over the rules page, with Never's own under it while it is on. What Always says, just under it, holds whatever they say. */
export function BigSwitch({ project, on, onChange, ignoreNever, onIgnoreNeverChange, text }: BigSwitchProps) {
  const t = { ...bigSwitchText, ...text }
  const title = useId()
  const note = useId()
  const neverTitle = useId()
  const neverNote = useId()
  return (
    <section className={cx(s.sheet, on && s.on)} aria-labelledby={title}>
      <div className={s.row}>
        <div className={s.words}>
          <h2 id={title} className={s.title}>
            {on && <ExploreIcon name="unlocked" size={15} />}
            {t.title}
          </h2>
          <p id={note} className={s.note}>
            {on ? t.on(project) : t.off(project)}
          </p>
        </div>
        <Switch checked={on} onChange={onChange} labelledBy={title} describedBy={note} />
      </div>
      {on && (
        <div className={cx(s.row, s.never)}>
          <div className={s.words}>
            <span id={neverTitle} className={s.subTitle}>
              {t.ignoreNever}
            </span>
            <p id={neverNote} className={s.note}>
              {ignoreNever ? t.neverIgnored : t.neverHolds}
            </p>
          </div>
          <Switch checked={ignoreNever} onChange={onIgnoreNeverChange} labelledBy={neverTitle} describedBy={neverNote} />
        </div>
      )}
    </section>
  )
}

export interface SwitchMenuText {
  item: string
  about: string
}

export const switchMenuText: SwitchMenuText = {
  item: 'Allow everything on this task',
  about: 'Nothing on it waits for you. Never still holds, and credentials and the code host stay out of reach.',
}

export interface SwitchMenuProps {
  on: boolean
  onChange: (on: boolean) => void
  onStop: () => void
  onAbandon: () => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  text?: Partial<SwitchMenuText>
}

/** The task's menu, as TaskMenu draws it, with the switch first. */
export function SwitchMenu({ on, onChange, onStop, onAbandon, open, defaultOpen, onOpenChange, text }: SwitchMenuProps) {
  const t = { ...switchMenuText, ...text }
  const m = taskMenuText
  return (
    <Menu
      label={m.label}
      align="end"
      width={310}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      trigger={<ChromeButton icon="more" label={m.trigger} compact />}
    >
      <MenuCheckboxItem checked={on} onCheckedChange={onChange} description={t.about}>
        {t.item}
      </MenuCheckboxItem>
      <MenuSeparator />
      <MenuItem icon="hold" description={m.stopAbout} onSelect={onStop}>
        {m.stop}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="close" tone="danger" description={m.abandonAbout} onSelect={onAbandon}>
        {m.abandon}
      </MenuItem>
    </Menu>
  )
}
