import type { ReactNode } from 'react'

import { percent } from '../../chrome/LoadMeter/load'
import loadPeek from '../../chrome/LoadMeter/LoadPeek.module.css'
import type { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Select } from '../../primitives/Select/Select'
import cc from '../ControlCenter/ControlCenter.module.css'
import { SettingGroup, SettingList, SettingRow, SettingSwitch } from '../Preferences/Preferences'
import tt from '../ToolTiles/ToolTiles.module.css'
import s from './Computers.module.css'

/*
 * Althar Cloud, where a home may run tasks that would wait (ADR-103), paid by
 * the hour up to a monthly limit: a control panel, not a computer. What runs
 * there now, this month's use (spend against the limit and where it ends at
 * this pace, hours, tasks, each day's spend), whether it takes tasks that
 * would wait, and the limit; nothing of what runs it, no sizes, regions or
 * versions. Computers keeps a line for it (`CloudLine`), which opens its own
 * page of Settings (`CloudPage`); opened from that line, the page has a way
 * back to Computers at its top. Nothing in the app has it yet: these are
 * here for when a home does.
 */

/** A task running in Althar Cloud: its agent's mark, its title, its project and how long it has run. */
export interface CloudRun {
  id: string
  title: string
  project: string
  mark?: Brand | undefined
  /** How long, formatted: 14 min. */
  time: string
}

/** The month the use is of: how many days it has, which is today, and its name, as its axis and outlook say them. */
export interface CloudMonth {
  days: number
  today: number
  /** November. */
  name: string
  /** 1 Nov, 30 Nov: the axis's ends. */
  first: string
  last: string
  /** When the use starts again: 1 December. */
  next: string
}

/** A home's use of Althar Cloud this month, and its two controls. */
export interface CloudUse {
  /** Dollars spent this month. */
  spent: number
  /** The monthly limit, in dollars; null for none. */
  limit: number | null
  /** Hours of tasks run there this month. */
  hours: number
  tasks: number
  /** Dollars each day, the 1st to today. */
  daily: readonly number[]
  running: readonly CloudRun[]
  /** Runs a task there when it would wait; else only a task sent there does. */
  auto: boolean
  /** What an hour of a task costs, formatted: $0.42 an hour a task. */
  rate: string
  month: CloudMonth
}

export interface CloudText {
  cloud: string
  computers: string
  takes: (auto: boolean) => string
  thisMonth: string
  spent: string
  hours: string
  tasks: string
  runningNow: string
  nothingRunning: string
  daily: string
  today: string
  resets: (month: CloudMonth) => string
  whenItRuns: string
  autoTitle: string
  autoNote: string
  limitTitle: string
  limitNote: string
  noLimit: string
  leave: string
  more: (n: number) => string
  reached: string
  pace: (dollars: string) => string
  limitBy: (day: number, month: string) => string
}

export const dollars = (n: number) => `$${n % 1 === 0 ? n : n.toFixed(2)}`

export const cloudText: CloudText = {
  cloud: 'Althar Cloud',
  computers: 'Computers',
  takes: (auto) => (auto ? 'Runs tasks that would wait' : 'Runs the tasks you send there'),
  thisMonth: 'This month',
  spent: 'Spent',
  hours: 'Hours',
  tasks: 'Tasks',
  runningNow: 'Running now',
  nothingRunning: 'Nothing running',
  daily: 'Each day',
  today: 'Today',
  resets: (month) => `Starts again on ${month.next}`,
  whenItRuns: 'When it runs',
  autoTitle: 'Run tasks here when they would wait',
  autoNote: 'Off, a task runs here only when you send it.',
  limitTitle: 'Monthly limit',
  limitNote: 'At the limit nothing new starts here; what runs finishes.',
  noLimit: 'No limit',
  leave: 'Stop using Althar Cloud',
  more: (n) => `and ${n} more`,
  reached: 'At the limit: tasks wait for a worker',
  pace: (amount) => `On pace for ${amount}`,
  limitBy: (day, month) => `At this pace, the limit by ${day} ${month}`,
}

/** At its limit: nothing new starts there; what runs finishes. */
export const reachedOf = (use: CloudUse) => use.limit !== null && use.spent >= use.limit

/** The month's spend in words: against the limit, where it has one. */
const spendOf = (use: CloudUse) => (use.limit === null ? dollars(use.spent) : `${dollars(use.spent)} of ${dollars(use.limit)}`)

/** Under the spend: the limit reached, else where the month ends at this pace, or the day it reaches the limit. */
const outlookOf = (use: CloudUse, t: CloudText) => {
  if (reachedOf(use)) return t.reached
  const perDay = use.spent / Math.max(1, use.month.today)
  const pace = perDay * use.month.days
  if (use.limit !== null && pace > use.limit && perDay > 0) return t.limitBy(Math.ceil(use.limit / perDay), use.month.name)
  return t.pace(dollars(Math.round(pace)))
}

const clamp = (n: number) => Math.min(1, Math.max(0, n))

/** This month's spend as the load popover draws a figure: its name and figure, its bar against the limit, the outlook under it. */
function SpendReading({ use, name, t }: { use: CloudUse; name: string; t: CloudText }) {
  return (
    <div className={loadPeek.row}>
      <span className={loadPeek.name}>{name}</span>
      <span className={loadPeek.figure}>{spendOf(use)}</span>
      {use.limit !== null && (
        <span className={loadPeek.bar} aria-hidden="true">
          <i className={loadPeek.rest} style={{ width: `${percent(clamp(use.spent / use.limit))}%` }} />
        </span>
      )}
      <span className={loadPeek.work}>{outlookOf(use, t)}</span>
    </div>
  )
}

export interface CloudLineProps {
  use: CloudUse
  onClick: () => void
  text?: Partial<CloudText> | undefined
}

/** Althar Cloud's line in Computers: how it takes tasks, this month's spend at its end; it opens its own page. */
export function CloudLine({ use, onClick, text }: CloudLineProps) {
  const t = { ...cloudText, ...text }
  return (
    <button type="button" className={cx(cc.module, cc.opens, s.module, s.lineModule)} onClick={onClick}>
      <span className={s.head}>
        <span className={s.picture} aria-hidden="true">
          <Icon name="cloud" size={16} />
        </span>
        <span className={s.names}>
          <span className={s.name}>{t.cloud}</span>
          <span className={s.kindLine}>{t.takes(use.auto)}</span>
        </span>
        <span className={s.lineSpend}>
          <SpendReading use={use} name={t.thisMonth} t={t} />
        </span>
        <Icon name="chevron" size={11} className={s.chevron} />
      </span>
    </button>
  )
}

/** A figure as a control panel shows one: its name over it, big, and what it adds under it. */
function Stat({ name, figure, children }: { name: string; figure: string; children?: ReactNode }) {
  return (
    <span className={s.stat}>
      <span className={s.statName}>{name}</span>
      <span className={s.statFigure}>{figure}</span>
      {children}
    </span>
  )
}

/** What runs there now, a row a task; past `most`, how many more. */
function Runs({ use, t, most = Number.POSITIVE_INFINITY }: { use: CloudUse; t: CloudText; most?: number }) {
  if (use.running.length === 0) return <span className={s.line}>{t.nothingRunning}</span>
  const shown = use.running.slice(0, use.running.length > most ? most - 1 : most)
  return (
    <span className={s.runs}>
      {shown.map((run) => (
        <span key={run.id} className={s.run}>
          {run.mark === undefined ? <span /> : <BrandMark brand={run.mark} size={12} />}
          <span className={s.runTitle}>{run.title}</span>
          <span className={s.runLine}>
            {run.project} · {run.time}
          </span>
        </span>
      ))}
      {shown.length < use.running.length && <span className={s.runMore}>{t.more(use.running.length - shown.length)}</span>}
    </span>
  )
}

/** Each day's spend this month, a bar a day: today's in ink, the days to come a faint tick. */
function Daily({ use, t }: { use: CloudUse; t: CloudText }) {
  const most = Math.max(0.01, ...use.daily)
  const { month } = use
  return (
    <figure className={s.daily} aria-label={`${t.daily}: ${spendOf(use)}`}>
      <span className={s.days} style={{ gridTemplateColumns: `repeat(${month.days}, minmax(0, 1fr))` }} aria-hidden="true">
        {Array.from({ length: month.days }, (_, i) => {
          const spent = use.daily[i]
          if (spent === undefined) return <i key={i} className={s.ahead} />
          return (
            <i key={i} className={i === month.today - 1 ? s.today : s.day} style={{ height: `${Math.max(3, (spent / most) * 100)}%` }} />
          )
        })}
      </span>
      <figcaption className={s.dayAxis} aria-hidden="true">
        <span>{month.first}</span>
        <span className={s.todayMark} style={{ left: `${((month.today - 0.5) / month.days) * 100}%` }}>
          {t.today}
        </span>
        <span>{month.last}</span>
      </figcaption>
    </figure>
  )
}

const LIMITS = ['20', '40', '100', 'none'] as const
type Limit = (typeof LIMITS)[number]

export interface CloudPageProps {
  use: CloudUse
  /** Back to Computers, where the page was opened from there; from Settings' side, the page has none. */
  onBack?: (() => void) | null | undefined
  onAuto: (on: boolean) => void
  onLimit: (limit: number | null) => void
  onLeave: () => void
  text?: Partial<CloudText> | undefined
}

/** Althar Cloud's own page of Settings: this month and each day, what runs now, when it runs; leaving it at the foot. */
export function CloudPage({ use, onBack, onAuto, onLimit, onLeave, text }: CloudPageProps) {
  const t = { ...cloudText, ...text }
  const limit: Limit = use.limit === null ? 'none' : LIMITS.includes(String(use.limit) as Limit) ? (String(use.limit) as Limit) : '40'
  return (
    <div className={s.computers}>
      {onBack != null && (
        <button type="button" className={s.backTo} onClick={onBack}>
          <span className={s.backChevron} aria-hidden="true">
            <Icon name="chevron" size={11} />
          </span>
          {t.computers}
        </button>
      )}
      <SettingGroup className={s.group} title={t.thisMonth} note={`${t.resets(use.month)} · ${use.rate}`}>
        <span className={s.pageUse}>
          <span className={s.stats4}>
            <Stat name={t.spent} figure={spendOf(use)}>
              {use.limit !== null && (
                <span className={loadPeek.bar} aria-hidden="true">
                  <i className={loadPeek.rest} style={{ width: `${percent(clamp(use.spent / use.limit))}%` }} />
                </span>
              )}
              <span className={cx(s.statNote, reachedOf(use) && s.reached)}>{outlookOf(use, t)}</span>
            </Stat>
            <Stat name={t.hours} figure={`${use.hours} h`} />
            <Stat name={t.tasks} figure={String(use.tasks)} />
            <Stat name={t.runningNow} figure={String(use.running.length)} />
          </span>
          <Daily use={use} t={t} />
        </span>
      </SettingGroup>
      <SettingGroup className={s.group} title={t.runningNow}>
        <Runs use={use} t={t} />
      </SettingGroup>
      <SettingGroup className={s.group} title={t.whenItRuns}>
        <SettingList>
          <SettingSwitch
            title={t.autoTitle}
            note={t.autoNote}
            glyph={<Icon name="play" size={14} />}
            checked={use.auto}
            onChange={onAuto}
          />
          <SettingRow title={t.limitTitle} note={t.limitNote} glyph={<Icon name="stop" size={13} />}>
            {(ids) => (
              <Select
                label={t.limitTitle}
                options={LIMITS.map((one) => ({ value: one, label: one === 'none' ? t.noLimit : dollars(Number(one)) }))}
                value={limit}
                onChange={(one) => onLimit(one === 'none' ? null : Number(one))}
                width={110}
                {...ids}
              />
            )}
          </SettingRow>
        </SettingList>
      </SettingGroup>
      <div className={tt.foot}>
        <LinkButton className={tt.danger} onClick={onLeave}>
          {t.leave}
        </LinkButton>
      </div>
    </div>
  )
}
