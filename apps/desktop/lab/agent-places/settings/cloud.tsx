import type { ReactNode } from 'react'
import { BrandMark, ControlDetail, Icon, LinkButton, Select, SettingList, SettingRow, SettingSwitch } from '@althar/ui'

import { SheetFact } from '../../../../../packages/ui/src/setup/ToolTiles/ToolParts'
import tt from '../../../../../packages/ui/src/setup/ToolTiles/ToolTiles.module.css'
import { text as settingsText } from '../../../src/renderer/features/settings/text'
import { MONTH, reachedOf, type Runners } from '../data'
import { SpendReading, SplitBar } from '../parts'
import type { Ctx } from '../types'
import { words } from '../words'
import x from './settings.module.css'

/*
 * Althar Cloud as a control panel: what runs there now, this month's use
 * (spend against the limit, hours, tasks, each day's spend), and its two
 * controls, whether it takes tasks that would wait and the monthly limit.
 * Nothing of what runs it: no sizes, regions or versions. Each take puts
 * these same pieces somewhere else.
 */

const LIMITS = ['20', '40', '100', 'none'] as const
type Limit = (typeof LIMITS)[number]

/** What runs there now, a row a task: its agent's mark, its title, its project and how long. */
export function Runs({ ctx, most = Number.POSITIVE_INFINITY }: { ctx: Ctx; most?: number }) {
  const running = ctx.runners!.running
  if (running.length === 0) return <span className={x.none}>{words.runningCount(ctx.runners!)}</span>
  const shown = running.slice(0, running.length > most ? most - 1 : most)
  return (
    <span className={x.runs}>
      {shown.map((one) => (
        <span key={one.taskId} className={x.run}>
          <BrandMark brand={one.mark} size={12} />
          <span className={x.runTitle}>{one.title}</span>
          <span className={x.runLine}>{words.run(one.project, one.for)}</span>
        </span>
      ))}
      {shown.length < running.length && <span className={x.runMore}>{words.more(running.length - shown.length)}</span>}
    </span>
  )
}

/** A figure as a control panel shows one: its name over it, big, and a line under it where it has one. */
function Stat({ name, figure, children }: { name: string; figure: string; children?: ReactNode }) {
  return (
    <span className={x.stat}>
      <span className={x.statName}>{name}</span>
      <span className={x.statFigure}>{figure}</span>
      {children}
    </span>
  )
}

/** This month at a glance: the spend against the limit, with where it ends; hours and tasks; what runs now. */
export function Stats({ runners, spentName = words.thisMonth }: { runners: Runners; spentName?: string }) {
  const reached = reachedOf(runners)
  return (
    <span className={x.stats4}>
      <Stat name={spentName} figure={words.spend(runners)}>
        {runners.limit !== null && <SplitBar total={runners.spent / runners.limit} ours={0} />}
        <span className={`${x.statNote} ${reached ? x.reached : ''}`}>{words.outlook(runners)}</span>
      </Stat>
      <Stat name={words.hours} figure={words.hoursFigure(runners)} />
      <Stat name={words.tasksRun} figure={String(runners.tasks)} />
      <Stat name={words.runningNow} figure={String(runners.running.length)} />
    </span>
  )
}

/** Each day's spend this month, a bar a day, today's in ink and the days to come faint, the 1st and the 30th under it. */
export function Daily({ runners }: { runners: Runners }) {
  const most = Math.max(0.01, ...runners.daily)
  return (
    <figure className={x.daily} aria-label={`${words.daily}: ${words.spend(runners)} so far`}>
      <span className={x.days} aria-hidden="true">
        {Array.from({ length: MONTH.days }, (_, i) => {
          const spent = runners.daily[i]
          if (spent === undefined) return <i key={i} className={x.ahead} />
          return (
            <i key={i} className={i === MONTH.today - 1 ? x.today : x.day} style={{ height: `${Math.max(3, (spent / most) * 100)}%` }} />
          )
        })}
      </span>
      <figcaption className={x.dayAxis} aria-hidden="true">
        <span>1 Nov</span>
        <span>Today</span>
        <span>30 Nov</span>
      </figcaption>
    </figure>
  )
}

/** Its controls: whether it takes tasks that would wait (a home of the person's own only), the monthly limit; hosted, pausing all. */
export function Controls({ ctx, hosted }: { ctx: Ctx; hosted: boolean }) {
  const runners = ctx.runners!
  const limit: Limit = runners.limit === null ? 'none' : (String(runners.limit) as Limit)
  return (
    <SettingList>
      {!hosted && (
        <SettingSwitch
          title={words.autoTitle}
          note={words.autoNote}
          glyph={<Icon name="play" size={14} />}
          checked={runners.auto}
          onChange={ctx.setAuto}
        />
      )}
      <SettingRow title={words.limitTitle} note={words.limitNote} glyph={<Icon name="stop" size={13} />}>
        {() => (
          <Select
            label={words.limitTitle}
            options={LIMITS.map((one) => ({ value: one, label: one === 'none' ? words.noLimit : words.dollars(Number(one)) }))}
            value={limit}
            onChange={(one) => ctx.setLimit(one === 'none' ? null : Number(one))}
            width={110}
          />
        )}
      </SettingRow>
      {hosted && (
        <SettingSwitch
          title={settingsText.pauseAllTitle}
          note={settingsText.pauseAllNote}
          glyph={<Icon name="pause" size={14} />}
          checked={false}
          onChange={() => undefined}
        />
      )}
    </SettingList>
  )
}

/** Leaving it, apart at the foot; a hosted home can't. */
export function Leave({ ctx, hosted }: { ctx: Ctx; hosted: boolean }) {
  if (hosted) return null
  return (
    <div className={tt.foot}>
      <LinkButton className={tt.danger} onClick={() => ctx.say('Asks first; what runs there finishes')}>
        {words.stopCloud}
      </LinkButton>
    </div>
  )
}

/** A: the module opened out, as a computer's: what runs there beside this month's figures, then its controls. */
export function CloudSheet({ ctx, hosted, onBack }: { ctx: Ctx; hosted: boolean; onBack: () => void }) {
  const runners = ctx.runners!
  return (
    <div className={tt.opened}>
      <ControlDetail
        title={words.cloud}
        onBack={onBack}
        text={{ back: words.computers }}
        aside={hosted ? words.home : words.takes(runners)}
      >
        <div className={x.body}>
          <div className={`${tt.sheet} ${x.glance}`}>
            <div className={x.readings}>
              <h3 className={x.eyebrow}>{words.runningNow}</h3>
              <Runs ctx={ctx} />
            </div>
            <div className={x.facts}>
              <SheetFact label={words.thisMonth}>
                <span className={x.spent}>
                  <SpendReading runners={runners} name="" />
                  <span className={x.spentNote}>{words.resets}</span>
                </span>
              </SheetFact>
              <SheetFact label={words.hours}>{words.hoursFigure(runners)}</SheetFact>
              <SheetFact label={words.tasksRun}>{runners.tasks}</SheetFact>
              <SheetFact label={words.rate}>{words.rateFigure}</SheetFact>
            </div>
          </div>
          <div className={`${tt.sheet} ${x.settings}`}>
            <Controls ctx={ctx} hosted={hosted} />
          </div>
          <Leave ctx={ctx} hosted={hosted} />
        </div>
      </ControlDetail>
    </div>
  )
}
