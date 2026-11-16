import type { ComponentType, ReactNode } from 'react'

import { Icon } from '../../../../../packages/ui/src/foundations/Icon/Icon'
import { BrandMark } from '../../../../../packages/ui/src/foundations/Marks/Marks'
import { Button } from '../../../../../packages/ui/src/primitives/Button/Button'
import { CountdownRing } from '../../../../../packages/ui/src/primitives/CountdownRing/CountdownRing'
import { Menu, MenuItem, MenuSeparator } from '../../../../../packages/ui/src/primitives/Menu/Menu'
import type { ModelInfo } from '../../../../../packages/ui/src/primitives/Model/Model'
import s from '../../../../../packages/ui/src/coordinator/TaskLaunch/TaskLaunch.module.css'
import { clock, move, openTask, option, store, useStore, useWorld, worldNow } from '../state'
import { Glyph, standsShort, troubled } from '../task/chain'
import { listed, openBlockers, shortOf, specOf, TASKS, type TaskNow, type WorldNow } from '../world'
import p from './plan.module.css'

/*
 * The coordinator's plan card for a task that waits for other tasks, in the
 * look the bar picked (plan/patches.ts puts these in the kit's TaskLaunch):
 * 1 says it in the foot, where the countdown was, as now; 2 makes each task
 * it waits for a row before its lead, "Pairing merges"; 3 says it under the
 * title; 4 has the foot's ring and bar follow the task it waits for; 5 folds
 * the plan to its title, its team in a line, and its foot until it starts.
 * Any other plan, and this one once nothing holds it, is drawn as always.
 */

export interface LabLaunch {
  readonly look: string
  readonly task: TaskNow
  /** What it waits for still, each not merged. */
  readonly open: ReadonlyArray<TaskNow>
  /** Its roster put away (5). */
  readonly folded: boolean
}

/** The plans unfolded in 5, by slug. */
const unfolded = store<ReadonlySet<string>>(new Set())

/** A plan that waits for other tasks, and the look it's in; null for any other, which the card draws as it always does. */
export const useLabLaunch = (slug: string, drafting: boolean): LabLaunch | null => {
  const world = useWorld()
  const look = useStore(option.card)
  const opened = useStore(unfolded)
  const key = TASKS.find((one) => one.slug === slug)?.key
  const task = key === undefined ? undefined : world.byKey.get(key)
  if (drafting || task === undefined || task.phase !== 'waits') return null
  const open = openBlockers(world, task)
  if (open.length === 0) return null
  return { look, task, open, folded: look === '5' && !opened.has(slug) }
}

/* ——— words ——— */

const gone = (lab: LabLaunch) => lab.open.find((one) => one.phase === 'abandoned')

/** When it starts, where the card has named what it waits for already. */
const whenShort = (lab: LabLaunch): string => {
  if (gone(lab) !== undefined) return 'Waits for your answer'
  if (lab.open.length === 1) return 'Starts when it merges'
  return lab.open.length === 2 ? 'Starts when both merge' : `Starts when all ${lab.open.length} merge`
}

/** When it starts, naming what it waits for: the board row's words. */
const whenNamed = (lab: LabLaunch): string => {
  const left = gone(lab)
  if (left !== undefined) return `${shortOf(left.key)} was abandoned`
  return `Starts when ${listed(lab.open.map((one) => shortOf(one.key)))} ${lab.open.length === 1 ? 'merges' : 'merge'}`
}

/** How a task stands, in a sentence's words: Pairing is in review. */
const sentence = (task: TaskNow): string => {
  const name = shortOf(task.key)
  switch (task.phase) {
    case 'implement':
      return `${name} is being implemented`
    case 'review':
      return `${name} is in review`
    case 'checks':
      return `${name}’s checks are running`
    case 'ready':
      return `${name} is ready to merge`
    case 'stuck':
      return `${name} is stuck`
    case 'abandoned':
      return `${name} was abandoned`
    case 'merged':
      return `${name} merged`
    case 'starting':
      return `${name} is starting`
    case 'waits':
      return `${name} waits for ${listed(openBlockers(worldNow(), task).map((one) => shortOf(one.key)))}`
  }
}

const capital = (words: string) => words.charAt(0).toUpperCase() + words.slice(1)

/* ——— how far along a task is, for 4 ——— */

const SHARE = { implement: 0.55, review: 0.2, checks: 0.15, ready: 0.1 } as const

/** How far along to merging it is, from 0 to 1: its steps' shares, each filled as far as its time in it goes. */
const progressOf = (world: WorldNow, task: TaskNow): number => {
  const spec = specOf(task.key)
  const within = (phase: keyof typeof SHARE) => {
    const took = spec.takes[phase] || 1
    const worked =
      (phase === 'implement' && spec.begun?.phase === 'implement' && task.since <= 0 ? spec.begun.worked : 0) + world.t - task.since
    return Math.min(0.95, Math.max(0, worked / took))
  }
  switch (task.phase) {
    case 'waits':
    case 'starting':
    case 'abandoned':
      return 0
    case 'implement':
      return SHARE.implement * within('implement')
    case 'review':
      return SHARE.implement + SHARE.review * within('review')
    case 'checks':
      return SHARE.implement + SHARE.review + SHARE.checks * within('checks')
    case 'stuck':
      return SHARE.implement + SHARE.review + SHARE.checks * 0.6
    case 'ready':
      return 1 - SHARE.ready + SHARE.ready * within('ready')
    case 'merged':
      return 1
  }
}

/* ——— the parts each look puts in the card ——— */

/** A task it waits for as a node on the line: its seat dashed while it hasn't started, an arc going slowly round while it runs. */
function BlockerNode({ task }: { task: TaskNow }) {
  const running = task.phase === 'implement' || task.phase === 'review' || task.phase === 'checks'
  const state = running ? 'choosing' : task.phase === 'waits' || task.phase === 'starting' || task.phase === 'abandoned' ? 'idle' : 'filled'
  return (
    <span className={`${s.node} ${p.node}`} data-state={state} data-phase={task.phase} aria-hidden="true">
      <span className={s.arc} />
      <span className={s.face}>
        <span>
          <Glyph task={task} />
        </span>
      </span>
    </span>
  )
}

/** What a task it waits for can have done from the card: open it, stop waiting for it, start without it; reopen it once abandoned. */
function BlockerMenu({ lab, blocker, onOpenChange }: { lab: LabLaunch; blocker: TaskNow; onOpenChange: (open: boolean) => void }) {
  const name = shortOf(blocker.key)
  const last = lab.open.length === 1
  return (
    <Menu
      label={`After ${name}`}
      width={280}
      placement="below"
      align="end"
      onOpenChange={onOpenChange}
      trigger={<button type="button" aria-label={`After ${name}: ${standsShort(blocker)}`} />}
    >
      <MenuItem icon="arrow" onSelect={() => openTask(blocker.key)}>
        Open {name}
      </MenuItem>
      {blocker.phase === 'abandoned' && (
        <MenuItem icon="reload" onSelect={() => move({ kind: 'reopen', key: blocker.key })}>
          Reopen {name}
        </MenuItem>
      )}
      <MenuSeparator />
      {last ? (
        <MenuItem icon="play" onSelect={() => move({ kind: 'start', key: lab.task.key })}>
          Start now, without it
        </MenuItem>
      ) : (
        <MenuItem icon="close" onSelect={() => move({ kind: 'unblock', key: lab.task.key, on: blocker.key })}>
          Stop waiting for {name}
        </MenuItem>
      )}
    </Menu>
  )
}

type RowProps = {
  i: number
  node: ReactNode
  link: 'idle' | 'flow' | 'done' | null
  label: ReactNode
  struck?: boolean
  under?: ReactNode
  who: ReactNode
  pick?: (onOpenChange: (open: boolean) => void) => ReactNode
}
type NodeProps = { state: 'idle' | 'next' | 'choosing' | 'filled'; mark?: ReactNode }

/** 2: each task it waits for, a row before its lead's: its merge is the plan's first stop. */
export function LabRows({ lab, Row }: { lab: LabLaunch; Row: ComponentType<RowProps>; Node: ComponentType<NodeProps> }) {
  if (lab.look !== '2') return null
  return (
    <>
      {lab.open.map((blocker, n) => (
        <Row
          key={blocker.key}
          i={n}
          node={<BlockerNode task={blocker} />}
          link="idle"
          label={`${shortOf(blocker.key)} merges`}
          struck={blocker.phase === 'abandoned'}
          who={
            <span className={p.stands} data-phase={blocker.phase}>
              {capital(standsShort(blocker))}
            </span>
          }
          pick={(onOpenChange) => <BlockerMenu lab={lab} blocker={blocker} onOpenChange={onOpenChange} />}
        />
      ))}
    </>
  )
}

/** 3: under its title, what it waits for, each with how it stands; 5: its team in a line, which unfolds it. */
export function LabUnderTitle({
  lab,
  steps,
}: {
  lab: LabLaunch
  steps?: ReadonlyArray<{ agents: ReadonlyArray<ModelInfo>; skipped?: boolean }>
}) {
  const open = useStore(unfolded)
  if (lab.look === '3')
    return (
      <p className={p.after}>
        <span className={p.afterWord}>After</span>
        {lab.open.map((blocker) => (
          <button
            key={blocker.key}
            type="button"
            className={p.blocker}
            data-phase={blocker.phase}
            title={`Open ${specOf(blocker.key).title}`}
            onClick={() => openTask(blocker.key)}
          >
            <Glyph task={blocker} />
            <span className={p.blockerName}>{shortOf(blocker.key)}</span>
            <span className={p.blockerState}>{standsShort(blocker)}</span>
          </button>
        ))}
      </p>
    )
  if (lab.look === '5' && lab.folded) {
    const team = (steps ?? []).filter((one) => one.skipped !== true).flatMap((one) => one.agents.slice(0, 1))
    const slug = specOf(lab.task.key).slug
    return (
      <button
        type="button"
        className={p.team}
        aria-expanded={false}
        onClick={() => unfolded.set(new Set([...open, slug]))}
        title="Show who does each step"
      >
        <span className={p.marks}>
          {team.map((agent, i) =>
            agent.mark === undefined ? null : (
              <span key={`${agent.id}-${i}`} className={p.markSeat}>
                <BrandMark brand={agent.mark} size={13} />
              </span>
            ),
          )}
        </span>
        <span className={p.teamWords}>
          {team[0]?.short}
          {team[1] !== undefined && <span className={p.teamThen}>, then {team[1].short} reviews</span>}
        </span>
        <Icon name="chevronD" size={9} className={s.chev} />
      </button>
    )
  }
  return null
}

/** Its foot, in every look: when it starts (or the ring and bar following what it waits for, in 4), with Hold; held, Start. */
export function LabFoot({
  lab,
  held,
  onHold,
  onStart,
  estimate,
}: {
  lab: LabLaunch
  held: boolean
  onHold: () => void
  onStart: () => void
  estimate?: ReactNode
}) {
  const world = useWorld()
  useStore(clock)
  const asked = gone(lab) !== undefined
  // 2 and 3 name what it waits for above; 1 and 5 here.
  const words = lab.look === '2' || lab.look === '3' ? whenShort(lab) : whenNamed(lab)
  const actions = held ? (
    <Button onClick={onStart}>Start</Button>
  ) : (
    <Button variant="quiet" onClick={onHold}>
      Hold
    </Button>
  )
  if (lab.look === '4') {
    // Furthest behind first: that's what it waits on longest.
    const order = lab.open.toSorted((a, b) => progressOf(world, a) - progressOf(world, b))
    const behind = order[0] as TaskNow
    const done = progressOf(world, behind)
    const said = order.map(sentence).join(' · ')
    return (
      <div className={s.foot}>
        <span className={s.estimate}>{estimate}</span>
        {held ? null : asked ? (
          <Icon name="close" size={12} className={p.ringGone} />
        ) : (
          <CountdownRing left={done} className={troubled(behind) ? p.ringStuck : p.ring} />
        )}
        <output className={`${s.when} ${p.follow}`} data-trouble={troubled(behind) || undefined} title={said}>
          {held ? `Held · ${said}` : said}
        </output>
        {actions}
        {!held && !asked && done > 0 && (
          <i
            className={`${s.bar} ${p.followBar}`}
            data-trouble={troubled(behind) || undefined}
            style={{ ['--left' as string]: done }}
            aria-hidden="true"
          />
        )}
      </div>
    )
  }
  return (
    <div className={s.foot}>
      <span className={s.estimate}>{estimate}</span>
      <output className={s.when} data-asked={asked || undefined}>
        {held ? `Held · ${words.charAt(0).toLowerCase()}${words.slice(1)}` : words}
      </output>
      {actions}
    </div>
  )
}
