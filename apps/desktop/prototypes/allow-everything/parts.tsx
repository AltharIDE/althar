// Scrappy: what the paths add, each built from the kit's own parts and styles.
import { useEffect, useState, type ReactNode } from 'react'

import {
  ActionButton,
  ChromeButton,
  ControlSheet,
  Fact,
  Icon,
  type IconName,
  Menu,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  Popover,
  Segmented,
  Select,
  SettingList,
  SettingRow,
  SettingSwitch,
  Tooltip,
} from '@althar/ui'

// The kit's own styles, for a pill over the composer and a quiet word beside the task's menu, as the kit draws its own.
import menu from '../../../../packages/ui/src/chrome/TaskMenu/TaskMenu.module.css'
import pill from '../../../../packages/ui/src/composer/Running/Running.module.css'
import { clock } from '../../src/renderer/shared/time'
import { page } from './page'
import {
  allowFor,
  effectiveOf,
  endNow,
  type Mode,
  setChipOpen,
  setProjectAllow,
  setProjectMode,
  setProjectUntil,
  setTaskMode,
  type State,
  useProto,
} from './store'
import { MODE_ORDER, MODES, words } from './words'

const MINUTE = 60_000

/** The time now, a little at a time, for what counts down. */
export const useNow = () => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

const minutesLeft = (endsAt: number | null, now: number) => (endsAt === null ? null : Math.max(1, Math.ceil((endsAt - now) / MINUTE)))
const at = (ms: number) => clock(new Date(ms).toISOString())

/** D: what allows everything for a while, the task's or else its project's, as one. */
export const timedOf = (s: State) =>
  s.taskUntil ??
  (s.projectUntil === null || s.rules.permissions !== 'allow' ? null : { until: s.projectUntil.until, endsAt: s.projectUntil.endsAt })

/** A quiet warm word beside the task's menu, where the task's own conflicts setting says it differs: here, that nothing waits. */
export function Mark({ children, tip, icon }: { children: ReactNode; tip: string; icon?: IconName }) {
  return (
    <Tooltip label={tip} placement="below">
      <span className={menu.hint} tabIndex={0}>
        <Fact tone="warm" {...(icon === undefined ? {} : { icon })}>
          {children}
        </Fact>
      </span>
    </Tooltip>
  )
}

/* ——— B: the task's chip, which opens to override its project's mode ——— */

export function TaskChip() {
  const st = useProto()
  const own = st.taskMode !== null
  const mode = effectiveOf(st)
  const project = st.rules.permissions
  return (
    <Menu
      label={words.B.menu}
      align="end"
      width={340}
      open={st.chipOpen}
      onOpenChange={setChipOpen}
      note={words.holds}
      trigger={<ChromeButton icon="lock" label={words.B.chip(own, mode)} />}
    >
      <MenuRadioGroup label={words.B.group} value={mode} onChange={(value) => setTaskMode(value === project ? null : (value as Mode))}>
        {MODE_ORDER.map((one) => (
          <MenuRadioItem key={one} value={one} description={MODES[one].note} {...(one === project ? { hint: 'Project default' } : {})}>
            {MODES[one].title}
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
      {own && (
        <>
          <MenuSeparator />
          <MenuItem icon="corner" description={words.B.backNote(project)} onSelect={() => setTaskMode(null)}>
            {words.B.back}
          </MenuItem>
        </>
      )}
    </Menu>
  )
}

/* ——— D: the pill over the composer while everything is allowed for a while, and how it ends ——— */

export function AllowPill() {
  const st = useProto()
  const now = useNow()
  const timed = timedOf(st)
  if (timed === null) {
    if (st.ended === null) return null
    // Ended: it says so where it said it was on, and asks again.
    return (
      <span className={pill.pill}>
        <Icon name="lock" size={11} className={pill.still} />
        <span className={pill.text}>
          <span className={pill.k}>{words.D.asking}</span>
          <span className={pill.what}>· {words.D.ended(at(st.ended.at))}</span>
        </span>
      </span>
    )
  }
  const left = minutesLeft(timed.endsAt, now)
  const onTask = st.taskUntil !== null
  const said = timed.until === 'hour' && left !== null ? words.D.left(left) : timed.until === 'task' ? words.D.pillTask : words.D.pillOff
  const ends =
    timed.until === 'hour' && timed.endsAt !== null
      ? words.D.ends(at(timed.endsAt))
      : timed.until === 'task'
        ? words.D.endsTask
        : words.D.endsOff
  const turnOff = () => (onTask ? endNow() : setProjectUntil(null))
  return (
    <Popover
      label={onTask ? words.D.popTitle : words.D.project}
      placement="above"
      width={400}
      padded={false}
      initialFocus="panel"
      defaultOpen={page.open === 'pill'}
      className={pill.pop}
      trigger={
        <button type="button" className={pill.pill}>
          <Icon name="clock" size={11} className={pill.still} />
          <span className={pill.text}>
            <span className={pill.k}>{onTask ? words.D.pill : `${words.D.pill} in meridian`}</span>
            <span className={pill.name}>{said}</span>
          </span>
          <Icon name="chevronD" size={9} className={pill.chev} />
        </button>
      }
    >
      <div className={pill.head} aria-hidden="true">
        {onTask ? words.D.popTitle : words.D.project}
      </div>
      <ul className={pill.list}>
        <li className={pill.row}>
          <span className={pill.rowGlyph}>
            <Icon name="clock" size={12} />
          </span>
          <span className={pill.rowMain}>
            <span className={pill.rowTitle}>{ends.title}</span>
            <span className={pill.rowMeta}>{ends.then}</span>
          </span>
          {timed.until === 'hour' && onTask && (
            <ActionButton size="small" onClick={() => allowFor('hour')}>
              {words.D.more}
            </ActionButton>
          )}
          <ActionButton size="small" onClick={turnOff}>
            {words.D.turnOff}
          </ActionButton>
        </li>
      </ul>
    </Popover>
  )
}

/** D: the word beside the task's menu while it allows everything for a while. */
export function TimedMark() {
  const st = useProto()
  const now = useNow()
  const timed = timedOf(st)
  if (timed === null) return null
  const left = minutesLeft(timed.endsAt, now)
  return (
    <Mark icon="clock" tip={st.taskUntil === null ? words.D.project : words.D.popTitle}>
      {words.D.badge(left, timed.until)}
    </Mark>
  )
}

/* ——— At the top of the Rules page ——— */

/** A: one switch over the rules; the sentences under it quieten while it is on. */
export function RulesSwitch() {
  const st = useProto()
  const on = st.rules.permissions === 'allow'
  const back = MODES[on ? st.before : st.rules.permissions].title
  return (
    <div style={{ margin: '-14px 0 30px' }}>
      <ControlSheet>
        <SettingList>
          <SettingSwitch title={words.A.switch} note={words.A.switchNote('meridian', back)} checked={on} onChange={setProjectAllow} />
        </SettingList>
      </ControlSheet>
    </div>
  )
}

/** B: the four modes side by side, with what the one chosen means under them. */
export function RulesModes() {
  const st = useProto()
  const mode = st.rules.permissions
  return (
    <div style={{ margin: '-14px 0 30px' }}>
      <ControlSheet>
        <Segmented
          label={words.B.rulesLabel}
          value={mode}
          onChange={setProjectMode}
          options={MODE_ORDER.map((one) => ({ value: one, label: MODES[one].title }))}
        />
        <SettingList>
          <SettingRow title={MODES[mode].title} note={MODES[mode].note}>
            {() => null}
          </SettingRow>
        </SettingList>
      </ControlSheet>
    </div>
  )
}

/** D: allow everything in the project for a while, or until turned off. */
export function RulesFor() {
  const st = useProto()
  const on = st.rules.permissions === 'allow'
  const value = !on ? 'none' : (st.projectUntil?.until ?? 'off')
  const ends = st.projectUntil?.endsAt ?? null
  return (
    <div style={{ margin: '-14px 0 30px' }}>
      <ControlSheet>
        <SettingList>
          <SettingRow
            title={words.D.project}
            note={
              <>
                {on ? words.D.projectOn(ends === null ? null : at(ends), MODES[st.before].title) : words.D.projectOff}{' '}
                {on ? words.holdsBelow : ''}
              </>
            }
          >
            {() => (
              <Select<'none' | 'hour' | 'off'>
                variant="filled"
                width={190}
                label={words.D.project}
                value={value}
                onChange={(next) => setProjectUntil(next === 'none' ? null : next)}
                options={(['none', 'hour', 'off'] as const).map((one) => ({ value: one, label: words.D.projectChoices[one] }))}
              />
            )}
          </SettingRow>
        </SettingList>
      </ControlSheet>
    </div>
  )
}
