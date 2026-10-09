import { RadioGroup } from 'radix-ui'
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Choices } from '../../primitives/Choices/Choices'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Select } from '../../primitives/Select/Select'
import { Switch } from '../../primitives/Switch/Switch'
import s from './Preferences.module.css'

/*
 * The app's own preferences, as sections that sit in any frame Settings
 * gives them: a module opened out in the Control Center, or a page of its
 * own. Each section is a short list of rows, a name and a line under it on
 * the left and the control at the end, ruled between; a row that only
 * matters while another is on sits in a well under it. Where a choice is
 * better seen than read, it is a picture: the editors by their own icons,
 * where Althar shows at the edge of the screen as the screen would look.
 * Each change goes out at once; the consumer keeps it.
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
  /** A picture before the name, such as the round glyph of the switch it opened from. */
  glyph?: ReactNode
  /** Set in under the row above, which it depends on, in a well. */
  indent?: boolean | undefined
  /** The control, at the end. It is named by `title` through the ids it is given. */
  children: (ids: { labelledBy: string; describedBy?: string }) => ReactNode
  /** Under the row, across it: what the row opens, such as a row that depends on it. */
  under?: ReactNode
  className?: string
}

/** One setting: its name and line, and the control at the end. */
export function SettingRow({ title, note, glyph, indent = false, children, under, className }: SettingRowProps) {
  const id = useId()
  const ids = { labelledBy: `${id}-t`, ...(note === undefined ? {} : { describedBy: `${id}-n` }) }
  return (
    <div className={cx(s.row, indent && s.indent, glyph !== undefined && s.withGlyph, className)}>
      {glyph !== undefined && (
        <span className={s.glyph} aria-hidden="true">
          {glyph}
        </span>
      )}
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
      {under !== undefined && <div className={s.under}>{under}</div>}
    </div>
  )
}

export interface SettingSwitchProps {
  title: string
  note?: ReactNode
  glyph?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean | undefined
  indent?: boolean | undefined
  under?: ReactNode
}

/** A setting that is on or off, taking effect at once. */
export function SettingSwitch({ title, note, glyph, checked, onChange, disabled, indent, under }: SettingSwitchProps) {
  return (
    <SettingRow title={title} note={note} glyph={glyph} indent={indent} under={under}>
      {(ids) => <Switch checked={checked} onChange={onChange} {...(disabled === undefined ? {} : { disabled })} {...ids} />}
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

/** Whether Althar keeps the Mac from sleeping while work runs, and, in a well under it, whether on battery as well. */
export function KeepAwake({ on, onChange, onBattery, onBatteryChange, text }: KeepAwakeProps) {
  const t = { ...keepAwakeText, ...text }
  return (
    <SettingSwitch
      title={t.title}
      note={t.note}
      glyph={<Icon name="cup" size={15} />}
      checked={on}
      onChange={onChange}
      under={
        <div className={cx(s.well, !on && s.wellOff)}>
          <SettingSwitch title={t.battery} note={t.batteryNote} checked={onBattery} onChange={onBatteryChange} disabled={!on} />
        </div>
      }
    />
  )
}

/* ---- open files in --------------------------------------------------------------- */

export interface OpenFilesInText {
  title: string
}

export const openFilesInText: OpenFilesInText = { title: 'Open files in' }

export interface EditorOption<V extends string> {
  value: V
  label: string
  /** Its own icon, as its app has it. Without one, its first letter. */
  picture?: ReactNode
}

export interface OpenFilesInProps<V extends string> {
  /** The editors there are to open in. */
  editors: readonly EditorOption<V>[]
  value: V | null
  onChange: (editor: V) => void
  text?: Partial<OpenFilesInText>
}

/** Which editor a task's files and folder open in, each by its own icon. */
export function OpenFilesIn<V extends string>({ editors, value, onChange, text }: OpenFilesInProps<V>) {
  const t = { ...openFilesInText, ...text }
  const id = useId()
  return (
    <div className={s.block}>
      <span id={id} className={s.title}>
        {t.title}
      </span>
      <Choices
        label={t.title}
        layout="tiles"
        className={s.editors}
        options={editors.map((editor) => ({
          value: editor.value,
          title: editor.label,
          picture: editor.picture ?? <span className={s.letter}>{editor.label.slice(0, 1)}</span>,
        }))}
        value={value}
        onChange={onChange}
      />
    </div>
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
}

export interface NotificationSettingsText {
  calls: string
  callsNote: string
  ready: string
  stopped: string
  badge: string
}

export const notificationSettingsText: NotificationSettingsText = {
  calls: 'A call waits on you',
  callsNote: 'A permission, a plan to look at, a question.',
  ready: 'A task is ready for you',
  stopped: 'Work stopped and couldn’t start again',
  badge: 'Count them on the Dock icon',
}

export interface NotificationSettingsProps {
  value: NotifyChoices
  onChange: (key: keyof NotifyChoices, on: boolean) => void
  text?: Partial<NotificationSettingsText>
}

/** What comes as a notification, and whether the Dock counts it. */
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
    </>
  )
}

export interface NotificationSoundText {
  title: string
  note: string
  none: string
  play: (sound: string) => string
}

export const notificationSoundText: NotificationSoundText = {
  title: 'Sound',
  note: 'One of this Mac’s alert sounds, with each notification.',
  none: 'None',
  play: (sound) => `Play ${sound}`,
}

export interface NotificationSoundProps {
  /** The sounds there are, by name. */
  sounds: readonly string[]
  /** The one chosen; null for none. */
  value: string | null
  onChange: (sound: string | null) => void
  /** Plays a sound once. Choosing one plays it too, so the person hears what they chose. */
  onPlay?: (sound: string) => void
  text?: Partial<NotificationSoundText>
}

const NONE = '__none'

/** Which sound a notification plays, heard as it is chosen, or none. */
export function NotificationSound({ sounds, value, onChange, onPlay, text }: NotificationSoundProps) {
  const t = { ...notificationSoundText, ...text }
  return (
    <SettingRow title={t.title} note={t.note} glyph={<Icon name="sound" size={15} />}>
      {() => (
        <span className={s.sound}>
          {onPlay && value !== null && <IconButton icon="play" label={t.play(value)} size="small" onClick={() => onPlay(value)} />}
          <Select
            label={t.title}
            options={[{ value: NONE, label: t.none }, ...sounds.map((sound) => ({ value: sound, label: sound }))]}
            value={value ?? NONE}
            onChange={(next) => {
              const sound = next === NONE ? null : next
              onChange(sound)
              if (sound !== null) onPlay?.(sound)
            }}
            width={132}
          />
        </span>
      )}
    </SettingRow>
  )
}

/* ---- where Althar shows in another app ------------------------------------------- */

export interface EdgeSceneProps {
  /** A notch in the middle of the menu bar, for the island to go round. */
  notch?: boolean
  /** At the top: the island round the notch, in the middle. */
  top?: ReactNode
  /** In the menu bar, at its end beside the clock: Althar's mark. */
  menuItem?: ReactNode
  /** What opens from it, hung under the top in the middle, or under the menu item at the end. */
  sheet?: ReactNode
  /** The clock in the menu bar. */
  time?: string
  /** How wide the slice of screen is drawn, before it is scaled to fit. */
  width?: number
  height?: number
  className?: string
}

/**
 * A slice of the top of a Mac's screen, the wallpaper in Althar's light and
 * the menu bar across it, drawn at its own size and scaled to whatever
 * holds it: a picture of what Althar would put there. The consumer gives
 * what goes in it, the real island or mark and its sheet; nothing in it can
 * be pressed.
 */
export function EdgeScene({ notch = false, top, menuItem, sheet, time = '14:32', width = 560, height = 300, className }: EdgeSceneProps) {
  const frame = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.6)
  useEffect(() => {
    const el = frame.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const measure = () => setScale(el.clientWidth / width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [width])
  return (
    <div ref={frame} className={cx(s.scene, className)} style={{ aspectRatio: `${width} / ${height}` } as CSSProperties} aria-hidden="true">
      <div className={s.stage} style={{ width, height, transform: `scale(${scale})` }} inert>
        <div className={s.menuBar}>
          <span className={s.apple} />
          <span className={s.menuWords}>
            <b>Xcode</b> File Edit View
          </span>
          {notch && <span className={s.notch} />}
          <span className={s.menuEnd}>
            {menuItem !== undefined && <span className={s.menuItem}>{menuItem}</span>}
            <span>{time}</span>
          </span>
        </div>
        {top !== undefined && <div className={s.top}>{top}</div>}
        {sheet !== undefined && <div className={cx(s.hung, menuItem !== undefined ? s.hungEnd : s.hungMiddle)}>{sheet}</div>}
      </div>
    </div>
  )
}

export interface EdgePlaceOption<V extends string> {
  value: V
  title: string
  note?: string
  /** What the screen would look like: an EdgeScene. */
  picture: ReactNode
}

export interface EdgePlacesProps<V extends string> {
  /** What is being chosen. */
  label: string
  options: readonly EdgePlaceOption<V>[]
  value: V | null
  onChange: (value: V) => void
  className?: string
}

/** Where Althar shows while you are in another app, each place as the screen would look with it there. Radix's radio group: arrows move between them. */
export function EdgePlaces<V extends string>({ label, options, value, onChange, className }: EdgePlacesProps<V>) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value ?? ''}
      onValueChange={(next) => {
        const picked = options.find((option) => option.value === next)
        if (picked) onChange(picked.value)
      }}
      loop
      className={cx(s.places, className)}
    >
      {options.map((option) => (
        <RadioGroup.Item key={option.value} value={option.value} className={s.place}>
          {option.picture}
          <span className={s.placeWords}>
            <span className={s.placeTitle}>
              <span className={s.radio} aria-hidden="true" />
              {option.title}
            </span>
            {option.note !== undefined && <span className={s.placeNote}>{option.note}</span>}
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}
