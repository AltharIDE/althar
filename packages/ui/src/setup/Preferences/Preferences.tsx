import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Choices } from '../../primitives/Choices/Choices'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
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

export type SettingGroupProps = RootProps<
  'section',
  {
    title: string
    /** A line on what the group is, under its name. */
    note?: ReactNode
    /** What is done for the group as a whole, at the end of its heading: Add a folder. */
    action?: ReactNode
    /** The name's rank in the page's outline: one under the page's own. */
    headingLevel?: HeadingLevel
    children: ReactNode
  }
>

/** A part of a section of settings, by its name: its rows, or whatever it holds, under a heading with a line on it. */
export function SettingGroup({ title, note, action, headingLevel = 2, children, className, ...rest }: SettingGroupProps) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={cx(s.group, className)} {...rest}>
      <div className={s.groupHead}>
        <div className={s.groupWords}>
          <Heading level={headingLevel} id={id} className={s.groupTitle}>
            {title}
          </Heading>
          {note !== undefined && <p className={s.groupNote}>{note}</p>}
        </div>
        {action !== undefined && <div className={s.groupAction}>{action}</div>}
      </div>
      {children}
    </section>
  )
}

export interface SettingRowProps {
  title: string
  /** A line on what it does, under the name. */
  note?: ReactNode
  /** A picture before the name, such as the round glyph of the switch it opened from. */
  glyph?: ReactNode
  /** A picture that has its own colours, such as a product's mark: before the name as it is, with no round glyph behind it. */
  mark?: ReactNode
  /** Set in under the row above, which it depends on, in a well. */
  indent?: boolean | undefined
  /** The control, at the end. It is named by `title` through the ids it is given. */
  children: (ids: { labelledBy: string; describedBy?: string }) => ReactNode
  /** Under the row, across it: what the row opens, such as a row that depends on it. */
  under?: ReactNode
  className?: string
}

/** One setting: its name and line, and the control at the end. */
export function SettingRow({ title, note, glyph, mark, indent = false, children, under, className }: SettingRowProps) {
  const id = useId()
  const ids = { labelledBy: `${id}-t`, ...(note === undefined ? {} : { describedBy: `${id}-n` }) }
  const picture = glyph ?? mark
  return (
    <div className={cx(s.row, indent && s.indent, picture !== undefined && s.withGlyph, className)}>
      {picture !== undefined && (
        <span className={glyph === undefined ? s.asIs : s.glyph} aria-hidden="true">
          {picture}
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

/* ---- agents at once ------------------------------------------------------------- */

/** The machine the default comes from: how many it runs at once by default, its memory in GB and its cores. */
export interface AtOnceMachine {
  readonly count: number
  readonly memory: number
  readonly cores: number
}

export interface AgentsAtOnceText {
  title: string
  /** What the number means as it moves: at the default, why; under it or past it, what that does to this Mac. */
  note: (count: number, machine: AtOnceMachine) => string
  /** Compact, one plain line whatever the number. */
  short: string
  /** The default's mark on the scale. */
  mark: (machine: AtOnceMachine) => string
  /** The number as a screen reader says it: the default's, said to be. */
  value: (count: number, machine: AtOnceMachine) => string
  /** Goes back to the default. */
  reset: string
}

export const agentsAtOnceText: AgentsAtOnceText = {
  title: 'Agents at once',
  note: (n, { count, memory, cores }) => {
    if (n === count) return `${n}: this Mac has ${memory} GB and ${cores} cores. More tasks than that wait their turn.`
    if (n === 1) return '1: one at a time. The calmest this Mac can be.'
    if (n < count) return `${n}: fewer than this Mac could carry.`
    if (n <= count + 2) return `${n}: a little more than this Mac’s ${memory} GB suggests. Tests may slow down.`
    return `${n}: well past what this Mac’s ${memory} GB suggests. Expect it to run hot.`
  },
  short: 'More tasks than this wait their turn.',
  mark: ({ count }) => `${count} · this Mac`,
  value: (n, { count }) => (n === count ? `${n}, this Mac’s default` : String(n)),
  reset: 'Use the default',
}

export interface AgentsAtOnceProps {
  /** How many tasks' agents work at once now: the person's number, else the default. */
  count: number
  /** Whether the person's own number is kept, as it may be the default's number too. Without it, a number other than the default is. */
  own?: boolean
  /** The default, and the machine it comes from. */
  machine: AtOnceMachine
  /** The most the person can choose. */
  most?: number
  /** A number of their own; null goes back to the default, as does the default's own number. */
  onChange: (count: number | null) => void
  /**
   * Alone on a sheet of its own, as the quick settings have it: one plain
   * line under its name, a step on the track for each number, and no scale
   * under it, the default only its mark. The sheet's padding is its own.
   */
  compact?: boolean
  text?: Partial<AgentsAtOnceText>
}

/**
 * How many tasks' agents work at once on this machine, and why: a stepped
 * track from one to the most, the default from its memory and cores marked
 * on it. The thumb clicks into the default as it passes; past it the track,
 * the number and the row's glyph warm, and the glyph breathes faster, the
 * further it goes. A drag goes out once it is let go. It says nothing of
 * what runs now: Settings stays calm.
 */
export function AgentsAtOnce({ count, own: kept, machine, most = 16, onChange, compact = false, text }: AgentsAtOnceProps) {
  const t = { ...agentsAtOnceText, ...text }
  // While the thumb is held, the number it is on; it goes out once let go.
  const [held, setHeld] = useState<number | null>(null)
  const [clicks, setClicks] = useState(0)
  const track = useRef<HTMLDivElement>(null)
  const n = held ?? count
  const own = held === null ? (kept ?? n !== machine.count) : n !== machine.count
  const heat = Math.max(0, Math.min(1, (n - machine.count) / Math.max(1, most - machine.count)))
  const at = (v: number) => `${((v - 1) / Math.max(1, most - 1)) * 100}%`
  const clamp = (v: number) => Math.max(1, Math.min(most, v))
  const show = (next: number) => {
    if (next === machine.count && n !== machine.count) setClicks((c) => c + 1)
  }
  const send = (next: number) => {
    if (next !== count || (next === machine.count && kept === true)) onChange(next === machine.count ? null : next)
  }
  const from = (x: number) => {
    const box = track.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0) return n
    const raw = 1 + ((x - box.left) / box.width) * (most - 1)
    // The default pulls the thumb in as it passes.
    if (Math.abs(raw - machine.count) < 0.6) return machine.count
    return clamp(Math.round(raw))
  }
  const hold = (next: number) => {
    show(next)
    setHeld(next)
  }
  const heatStyle = { '--heat': heat } as CSSProperties
  return (
    <SettingRow
      title={t.title}
      {...(compact ? { className: s.compact } : {})}
      note={
        <>
          {compact ? t.short : t.note(n, machine)}
          {own && held === null && (
            <>
              {' '}
              <LinkButton
                className={s.reset}
                onClick={() => {
                  show(machine.count)
                  onChange(null)
                }}
              >
                {t.reset}
              </LinkButton>
            </>
          )}
        </>
      }
      glyph={
        <span className={s.breathe} style={{ ...heatStyle, '--speed': `${2.8 - heat * 2.1}s` } as CSSProperties}>
          <Icon name="agents" size={15} />
        </span>
      }
      under={
        <div className={s.slider} style={heatStyle}>
          <div
            ref={track}
            className={s.track}
            role="slider"
            tabIndex={0}
            aria-label={t.title}
            aria-valuemin={1}
            aria-valuemax={most}
            aria-valuenow={n}
            aria-valuetext={t.value(n, machine)}
            onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
              e.currentTarget.setPointerCapture?.(e.pointerId)
              hold(from(e.clientX))
            }}
            onPointerMove={(e: PointerEvent<HTMLDivElement>) => {
              if (held !== null) hold(from(e.clientX))
            }}
            onPointerUp={() => {
              if (held === null) return
              setHeld(null)
              send(held)
            }}
            onPointerCancel={() => setHeld(null)}
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
              const steps: Record<string, number> = {
                ArrowRight: n + 1,
                ArrowUp: n + 1,
                ArrowLeft: n - 1,
                ArrowDown: n - 1,
                Home: 1,
                End: most,
              }
              const next = steps[e.key]
              if (next === undefined) return
              e.preventDefault()
              show(clamp(next))
              send(clamp(next))
            }}
          >
            <div className={s.rail}>
              <div className={s.fill} style={{ width: at(n) }} />
            </div>
            {compact && (
              <span className={s.steps} aria-hidden="true">
                {Array.from({ length: most }, (_, i) => i + 1).map((step) => (
                  <i key={step} className={cx(s.step, step <= n && s.stepIn)} style={{ left: at(step) }} />
                ))}
              </span>
            )}
            <span className={s.atDefault} style={{ left: at(machine.count) }} />
            <span key={clicks} className={cx(s.thumb, held !== null && s.held, !own && clicks > 0 && s.clicked)} style={{ left: at(n) }} />
          </div>
          {!compact && (
            <div className={s.scale} aria-hidden="true">
              {/* The default at an end of the scale stands for that end's number. */}
              <span>{machine.count === 1 ? '' : 1}</span>
              <span
                className={cx(s.mark, machine.count === 1 && s.markStart, machine.count === most && s.markEnd)}
                style={{ left: at(machine.count) }}
              >
                {t.mark(machine)}
              </span>
              <span>{machine.count === most ? '' : most}</span>
            </div>
          )}
        </div>
      }
    >
      {() => (
        <span className={s.value} style={heatStyle} aria-hidden="true">
          {n}
        </span>
      )}
    </SettingRow>
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
  /** Whether the system can carry a count on the app's icon; without one (Windows), no such row. */
  count?: boolean
  text?: Partial<NotificationSettingsText>
}

/** What comes as a notification, and whether the Dock counts it. */
export function NotificationSettings({ value, onChange, count = true, text }: NotificationSettingsProps) {
  const t = { ...notificationSettingsText, ...text }
  const row = (key: keyof NotifyChoices, title: string, note?: string) => (
    <SettingSwitch key={key} title={title} note={note} checked={value[key]} onChange={(on) => onChange(key, on)} />
  )
  return (
    <>
      {row('calls', t.calls, t.callsNote)}
      {row('ready', t.ready)}
      {row('stopped', t.stopped)}
      {count && row('badge', t.badge)}
    </>
  )
}

export interface NotificationSoundText {
  title: string
  note: string
  none: string
  /** The system's own sound, where there are no named ones to choose from. */
  system: string
  play: (sound: string) => string
}

export const notificationSoundText: NotificationSoundText = {
  title: 'Sound',
  note: 'One of this Mac’s alert sounds, with each notification.',
  none: 'None',
  system: 'The system’s sound',
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
  /** Offer the system's own sound, as `system`'s value, for a system without named ones (Windows, Linux). */
  system?: string
  text?: Partial<NotificationSoundText>
}

const NONE = '__none'

/** Which sound a notification plays, heard as it is chosen, or none. */
export function NotificationSound({ sounds, value, onChange, onPlay, system, text }: NotificationSoundProps) {
  const t = { ...notificationSoundText, ...text }
  const named = (sound: string) => (sound === system ? t.system : sound)
  return (
    <SettingRow title={t.title} note={t.note} glyph={<Icon name="sound" size={15} />}>
      {() => (
        <span className={s.sound}>
          {onPlay && value !== null && <IconButton icon="play" label={t.play(named(value))} size="small" onClick={() => onPlay(value)} />}
          <Select
            label={t.title}
            options={[
              { value: NONE, label: t.none },
              ...(system === undefined ? [] : [{ value: system, label: t.system }]),
              ...sounds.map((sound) => ({ value: sound, label: sound })),
            ]}
            value={value ?? NONE}
            onChange={(next) => {
              const sound = next === NONE ? null : next
              onChange(sound)
              if (sound !== null) onPlay?.(sound)
            }}
            width={system === undefined ? 132 : 168}
          />
        </span>
      )}
    </SettingRow>
  )
}

/* ---- usage data ------------------------------------------------------------------ */

export interface UsageDataText {
  title: string
  note: string
  /** Why it is off, whatever was chosen. */
  doNotTrack: string
}

export const usageDataText: UsageDataText = {
  title: 'Usage data',
  note: 'Anonymous: steps such as a project made or a task settled. Never your code, what is written, or any name.',
  doNotTrack: 'Off while DO_NOT_TRACK is set.',
}

export interface UsageDataProps {
  on: boolean
  onChange: (on: boolean) => void
  /** DO_NOT_TRACK is set where Althar started: off, whatever was chosen, and not turned on here. */
  doNotTrack?: boolean
  text?: Partial<UsageDataText>
}

/** Whether Althar sends anonymous usage data, with the one line on what it sends. */
export function UsageData({ on, onChange, doNotTrack = false, text }: UsageDataProps) {
  const t = { ...usageDataText, ...text }
  return (
    <SettingSwitch
      title={t.title}
      note={doNotTrack ? t.doNotTrack : t.note}
      checked={on && !doNotTrack}
      onChange={onChange}
      disabled={doNotTrack}
    />
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

/**
 * Where Althar shows while you are in another app, each place as the screen
 * would look with it there. Each is a radio named by its words; pressing
 * anywhere on its card chooses it, and arrows move between them, as the
 * browser's own radios do. The picture sits beside the radio, not inside it,
 * since what it draws may hold buttons of its own.
 */
export function EdgePlaces<V extends string>({ label, options, value, onChange, className }: EdgePlacesProps<V>) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label={label} className={cx(s.places, className)}>
      {options.map((option) => (
        <div key={option.value} className={s.place}>
          {option.picture}
          <label className={s.placeWords}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className={s.input}
            />
            <span className={s.placeTitle}>
              <span className={s.radio} aria-hidden="true" />
              {option.title}
            </span>
            {option.note !== undefined && <span className={s.placeNote}>{option.note}</span>}
          </label>
        </div>
      ))}
    </div>
  )
}

export interface EdgeHereProps {
  /** Where it shows: In the system tray. */
  title: string
  /** How to reach what it shows. */
  note?: string
  /** Why it is there and not elsewhere, or what the system may do with it. */
  why?: string
  /** What the screen looks like with it there: an EdgeScene, or an EdgeMini, larger. */
  picture: ReactNode
  className?: string
}

/** Where Althar shows on a system that leaves nothing to choose: as the screen looks with it there, and where that is, in words. */
export function EdgeHere({ title, note, why, picture, className }: EdgeHereProps) {
  return (
    <div className={cx(s.here, className)}>
      <div className={s.herePicture}>{picture}</div>
      <div className={s.hereWords}>
        <span className={s.hereTitle}>{title}</span>
        {note !== undefined && <span className={s.hereNote}>{note}</span>}
        {why !== undefined && <span className={s.hereWhy}>{why}</span>}
      </div>
    </div>
  )
}
