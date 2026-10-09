import { type ReactNode, useId } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Select, type SelectOption } from '../../primitives/Select/Select'
import { Switch } from '../../primitives/Switch/Switch'
import s from './Preferences.module.css'

/*
 * The app's own preferences, as sections that sit in any frame Settings
 * gives them: a module opened out in the Control Center, or a page of its
 * own. Each section is a short list of rows, a name and a line under it on
 * the left and the control at the end, ruled between. Each change goes out
 * at once; the consumer keeps it.
 */

export type SettingListProps = RootProps<'div', { children: ReactNode }>

/** Rows of settings, ruled between. */
export function SettingList({ children, className, ...rest }: SettingListProps) {
  return (
    <div className={cx(s.list, className)} {...rest}>
      {children}
    </div>
  )
}

export interface SettingRowProps {
  title: string
  /** A line on what it does, under the name. */
  note?: ReactNode
  /** Set in under the row above, which it depends on. */
  indent?: boolean
  /** The control, at the end. It is named by `title` through the ids it is given. */
  children: (ids: { labelledBy: string; describedBy?: string }) => ReactNode
  className?: string
}

/** One setting: its name and line, and the control at the end. */
export function SettingRow({ title, note, indent = false, children, className }: SettingRowProps) {
  const id = useId()
  const ids = { labelledBy: `${id}-t`, ...(note === undefined ? {} : { describedBy: `${id}-n` }) }
  return (
    <div className={cx(s.row, indent && s.indent, className)}>
      <span className={s.words}>
        <span id={ids.labelledBy} className={s.title}>
          {title}
        </span>
        {note !== undefined && (
          <span id={ids.describedBy} className={s.note}>
            {note}
          </span>
        )}
      </span>
      <span className={s.control}>{children(ids)}</span>
    </div>
  )
}

export interface SettingSwitchProps {
  title: string
  note?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  indent?: boolean
}

/** A setting that is on or off, taking effect at once. */
export function SettingSwitch({ title, note, checked, onChange, disabled, indent }: SettingSwitchProps) {
  return (
    <SettingRow title={title} note={note} indent={indent}>
      {(ids) => <Switch checked={checked} onChange={onChange} disabled={disabled} {...ids} />}
    </SettingRow>
  )
}

/* ---- keep awake ------------------------------------------------------------------ */

export interface KeepAwakeText {
  title: string
  note: string
  battery: string
  batteryNote: string
}

export const keepAwakeText: KeepAwakeText = {
  title: 'Keep this Mac awake while work runs',
  note: 'Work stops when the Mac sleeps. The display can still sleep.',
  battery: 'On battery too',
  batteryNote: 'Otherwise only while it’s plugged in.',
}

export interface KeepAwakeProps {
  on: boolean
  onChange: (on: boolean) => void
  /** Whether it holds on battery as well as plugged in. */
  onBattery: boolean
  onBatteryChange: (on: boolean) => void
  text?: Partial<KeepAwakeText>
}

/** Whether Althar keeps the Mac from sleeping while work runs, and whether on battery as well. */
export function KeepAwake({ on, onChange, onBattery, onBatteryChange, text }: KeepAwakeProps) {
  const t = { ...keepAwakeText, ...text }
  return (
    <>
      <SettingSwitch title={t.title} note={t.note} checked={on} onChange={onChange} />
      <SettingSwitch title={t.battery} note={t.batteryNote} checked={onBattery} onChange={onBatteryChange} disabled={!on} indent />
    </>
  )
}

/* ---- open files in --------------------------------------------------------------- */

export interface OpenFilesInText {
  title: string
}

export const openFilesInText: OpenFilesInText = { title: 'Open files in' }

export interface OpenFilesInProps<V extends string> {
  /** The editors there are to open in, by name. */
  editors: readonly SelectOption<V>[]
  value: V | null
  onChange: (editor: V) => void
  text?: Partial<OpenFilesInText>
}

/** Which editor a task's files and folder open in. */
export function OpenFilesIn<V extends string>({ editors, value, onChange, text }: OpenFilesInProps<V>) {
  const t = { ...openFilesInText, ...text }
  return (
    <SettingRow title={t.title}>
      {() => <Select label={t.title} options={editors} value={value} onChange={onChange} width={180} />}
    </SettingRow>
  )
}

/* ---- notifications --------------------------------------------------------------- */

/** What Althar tells the person about outside its window, each on or off. */
export interface NotifyChoices {
  /** A call waits on them: a permission, a plan, a question. */
  readonly calls: boolean
  /** A task is ready for them to look at. */
  readonly ready: boolean
  /** Work stopped and couldn't start again. */
  readonly stopped: boolean
  /** How many wait, on the Dock icon. */
  readonly badge: boolean
  readonly sound: boolean
}

export interface NotificationSettingsText {
  calls: string
  callsNote: string
  ready: string
  stopped: string
  badge: string
  sound: string
}

export const notificationSettingsText: NotificationSettingsText = {
  calls: 'A call waits on you',
  callsNote: 'A permission, a plan to look at, a question.',
  ready: 'A task is ready for you',
  stopped: 'Work stopped and couldn’t start again',
  badge: 'Count them on the Dock icon',
  sound: 'Play a sound',
}

export interface NotificationSettingsProps {
  value: NotifyChoices
  onChange: (key: keyof NotifyChoices, on: boolean) => void
  text?: Partial<NotificationSettingsText>
}

/** What comes as a notification, whether the Dock counts it, and whether it makes a sound. */
export function NotificationSettings({ value, onChange, text }: NotificationSettingsProps) {
  const t = { ...notificationSettingsText, ...text }
  const row = (key: keyof NotifyChoices, title: string, note?: string) => (
    <SettingSwitch key={key} title={title} note={note} checked={value[key]} onChange={(on) => onChange(key, on)} />
  )
  return (
    <>
      {row('calls', t.calls, t.callsNote)}
      {row('ready', t.ready)}
      {row('stopped', t.stopped)}
      {row('badge', t.badge)}
      {row('sound', t.sound)}
    </>
  )
}
