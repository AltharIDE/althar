import { createContext, type ReactNode, useContext } from 'react'

import type { BoardTask } from '@althar/contracts'

import { BrandMark } from '../../../../packages/ui/src/foundations/Marks/Marks'
import { Icon, type IconName } from '../../../../packages/ui/src/foundations/Icon/Icon'
import { cx } from '../../../../packages/ui/src/lib/cx'
import { Button } from '../../../../packages/ui/src/primitives/Button/Button'
import { Delta } from '../../../../packages/ui/src/primitives/FileChanges/FileChanges'
import { Tooltip } from '../../../../packages/ui/src/primitives/HoverCard/HoverCard'
import { LiveDot } from '../../../../packages/ui/src/primitives/LiveDot/LiveDot'
import { Spinner } from '../../../../packages/ui/src/primitives/Spinner/Spinner'
import { AcceptCard as KitAcceptCard, type AcceptCardProps } from '../../../../packages/ui/src/board/AcceptCard/AcceptCard'
import a from '../../../../packages/ui/src/board/AcceptCard/AcceptCard.module.css'
import b from '../../../../packages/ui/src/board/Board/Board.module.css'
import { CardTitle } from '../../../../packages/ui/src/board/Board/CardTitle'
import { NeedLine as KitNeedLine, type NeedLineProps } from '../../../../packages/ui/src/home/NeedLine/NeedLine'
import { type Blocker, rank, type Readiness, readinessOf, type Tone, type Verdict, words } from './readiness'
import { taskOf } from './scenario'
import s from './cards.module.css'

/*
 * The kit's ready card and the home's ready line, as each direction would
 * have them. Today is the kit's own. The card keeps the kit's frame (its
 * top line, title and pull request) and changes what it says of what is in
 * the way; the line keeps the kit's NeedLine and changes its kind, brief and
 * answer.
 */

export type Direction = 'today' | 'a' | 'b' | 'c' | 'd'
export const DirectionContext = createContext<Direction>('today')

/** Where C draws a group's heading: above the first card of each group, as the board orders them. */
export const GroupHeads = createContext<ReadonlySet<string>>(new Set())
/** How many cards each group holds, for its heading. */
export const GroupCounts = createContext<Readonly<Record<Verdict, number>>>({ good: 0, waiting: 0, yours: 0 })

export const directions: ReadonlyArray<{ readonly key: Exclude<Direction, 'today'>; readonly name: string; readonly gist: string }> = [
  {
    key: 'a',
    name: 'A · A status line, and the next thing to do',
    gist: 'One line on the card says how it stands (“Checks running, 2 of 5 · 3 commits to push”) and its one button is the next thing to do: Push 3 commits, Ask the lead to resolve, or Review when nothing is in the way.',
  },
  {
    key: 'b',
    name: 'B · Chips for checks, conflicts and push',
    gist: 'Three small chips on every ready card, always in the same place: checks, conflicts with main, commits to push. Green when clear, red when broken, cobalt while under way, violet when it’s your move; each says what it means on hover.',
  },
  {
    key: 'c',
    name: 'C · The ready work sorted by readiness',
    gist: 'The ready cards gather under three headings: Good to merge on top, Needs you (a conflict, failing checks, commits to push) below, and Waiting on checks faded at the bottom. Each card’s kind says why it is where it is.',
  },
  {
    key: 'd',
    name: 'D · Good to merge, or a list of what’s in the way',
    gist: 'A card with nothing in the way says “Good to merge” in green. Otherwise it lists each thing in the way, a row each, with what fixes it beside it; what is under way says so, and goes when it’s done.',
  },
]

const TONE: Record<Tone, string> = { danger: s.danger!, signal: s.signal!, live: s.live!, quiet: s.quiet! }
const ICON: Record<Blocker['kind'], IconName> = {
  push: 'up',
  conflict: 'branch',
  resolving: 'branch',
  failing: 'close',
  changes: 'answer',
  draft: 'pencil',
  running: 'clock',
  behind: 'down',
}

/** A thing in the way's mark: what is under way spins or breathes, the rest is its icon. */
const Mark = ({ blocker, size = 11 }: { blocker: Blocker; size?: number }) =>
  blocker.kind === 'running' ? (
    <LiveDot className={s.dot} />
  ) : blocker.kind === 'resolving' ? (
    <Spinner size="small" />
  ) : (
    <Icon name={ICON[blocker.kind]} size={size} />
  )

/** An action on a card: above the card's own button, which covers the whole of it. */
const Act = ({ blocker, variant = 'signal' }: { blocker: Blocker; variant?: 'signal' | 'default' }) => (
  <Button size="small" variant={variant} className={s.act} onClick={(event) => event.stopPropagation()}>
    {blocker.action}
  </Button>
)

/** The kit's ready card's frame: kind, title, its pull request; what it says of what is in the way is the direction's. */
function Shell({
  props,
  kind,
  kindTone,
  middle,
  foot,
  className,
}: {
  props: AcceptCardProps
  kind?: ReactNode
  kindTone?: string
  middle?: ReactNode
  foot: ReactNode
  className?: string
}) {
  const { title, prs = [], host, branch, current, onOpen, text } = props
  return (
    <article className={cx(b.card, a.accept, className)} aria-current={current || undefined}>
      <div className={b.top}>
        <span className={cx(a.kind, kindTone)}>{kind ?? 'Ready to accept'}</span>
      </div>
      <CardTitle className={a.title} onOpen={onOpen}>
        {title}
      </CardTitle>
      <ul className={a.prs}>
        {prs.map((pr) => (
          <li key={`${pr.repo}${pr.number}`} className={a.pr}>
            {host?.brand && <BrandMark brand={host.brand} size={12} />}
            <span className={a.repo}>{pr.repo}</span>
            <span className={a.number}>{text?.number ? text.number(pr.number) : `#${pr.number}`}</span>
            {pr.add !== undefined && pr.del !== undefined && <Delta add={pr.add} del={pr.del} className={a.delta} />}
          </li>
        ))}
        {branch && (
          <li className={a.pr}>
            <Icon name="branch" size={12} />
            <span className={a.repo}>{branch.name}</span>
            <Delta add={branch.add} del={branch.del} className={a.delta} />
          </li>
        )}
      </ul>
      {middle}
      <div className={b.foot}>{foot}</div>
    </article>
  )
}

const Go = ({ quiet = false, label = words.review }: { quiet?: boolean; label?: string }) => (
  <span className={cx(b.go, quiet ? s.goQuiet : a.go)} aria-hidden="true">
    {label}
    <Icon name="arrow" size={11} />
  </span>
)

/* ---- A: a status line, and the next thing to do ---- */

const StatusLine = ({ r }: { r: Readiness }) => {
  const shown = r.blockers.filter((one) => one.kind !== 'behind' || r.blockers.length === 1)
  // Its checks are said too while nothing is wrong with them.
  const checksSaid = r.blockers.some((one) => one.kind === 'failing' || one.kind === 'running')
  return (
    <span className={s.status}>
      {!checksSaid && (
        <span className={cx(s.part, r.checks.total > 0 && s.ok)}>
          {r.checks.total > 0 && <Icon name="check" size={11} />}
          {r.blockers.length === 0 || shown.every((one) => one.tone === 'quiet') ? r.passed : `${r.checks.passed} passed`}
        </span>
      )}
      {shown.map((one) => (
        <span key={one.kind} className={cx(s.part, TONE[one.tone])}>
          <Mark blocker={one} />
          {one.short}
        </span>
      ))}
    </span>
  )
}

function CardA({ props, r }: { props: AcceptCardProps; r: Readiness }) {
  return (
    <Shell
      props={props}
      className={r.verdict === 'waiting' ? s.waitingA : undefined}
      foot={
        <>
          <StatusLine r={r} />
          {r.next ? <Act blocker={r.next} /> : <Go quiet={r.verdict === 'waiting'} />}
        </>
      }
    />
  )
}

/* ---- B: chips ---- */

interface Chip {
  readonly key: string
  readonly icon: ReactNode
  readonly count?: string
  readonly tone: Tone | 'ok'
  readonly says: string
}

const chipsOf = (r: Readiness): ReadonlyArray<Chip> => {
  const has = (kind: Blocker['kind']) => r.blockers.find((one) => one.kind === kind)
  const failing = has('failing')
  const running = has('running')
  const conflict = has('conflict') ?? has('resolving')
  const push = has('push')
  const chips: Chip[] = [
    failing
      ? { key: 'checks', icon: <Icon name="close" size={11} />, count: `${r.checks.failed}`, tone: 'danger', says: `${failing.short}` }
      : running
        ? {
            key: 'checks',
            icon: <LiveDot className={s.dot} />,
            count: `${r.checks.total - r.checks.running}/${r.checks.total}`,
            tone: 'live',
            says: running.says,
          }
        : { key: 'checks', icon: <Icon name="check" size={11} />, tone: 'ok', says: words.clear.checks(r.checks.passed) },
    conflict
      ? {
          key: 'conflict',
          icon: conflict.kind === 'resolving' ? <Spinner size="small" /> : <Icon name="branch" size={11} />,
          tone: conflict.tone,
          says: `${conflict.says} ${conflict.detail ?? ''}`,
        }
      : { key: 'conflict', icon: <Icon name="branch" size={11} />, tone: 'ok', says: words.clear.conflict },
    push
      ? { key: 'push', icon: <Icon name="up" size={11} />, count: `${r.unpushed}`, tone: 'signal', says: push.says }
      : { key: 'push', icon: <Icon name="up" size={11} />, tone: 'ok', says: words.clear.push },
  ]
  for (const kind of ['changes', 'draft', 'behind'] as const) {
    const one = has(kind)
    if (one)
      chips.push({
        key: kind,
        icon: <Icon name={ICON[kind]} size={11} />,
        tone: one.tone,
        says: one.says,
        ...(kind === 'behind' ? { count: `${one.short.split(' ')[0]}` } : {}),
      })
  }
  return chips
}

const Chips = ({ r }: { r: Readiness }) => (
  <span className={s.chips}>
    {chipsOf(r).map((chip) => (
      <Tooltip key={chip.key} label={chip.says}>
        <span tabIndex={0} className={cx(s.chip, chip.tone === 'ok' ? s.ok : TONE[chip.tone])} aria-label={chip.says}>
          {chip.icon}
          {chip.count !== undefined && <span className={s.count}>{chip.count}</span>}
        </span>
      </Tooltip>
    ))}
  </span>
)

function CardB({ props, r }: { props: AcceptCardProps; r: Readiness }) {
  return (
    <Shell
      props={props}
      foot={
        <>
          <Chips r={r} />
          <Go quiet={r.verdict === 'waiting'} />
        </>
      }
    />
  )
}

/* ---- C: sorted by readiness ---- */

const kindOfC = (r: Readiness) => {
  if (r.verdict === 'good') return { kind: words.good, tone: s.ok }
  if (r.verdict === 'waiting') return { kind: r.blockers.find((one) => one.tone === 'live')?.short ?? words.waiting, tone: s.live }
  const first = r.blockers.find((one) => one.tone === 'danger' || one.tone === 'signal')
  const more = r.blockers.filter((one) => one.tone === 'danger' || one.tone === 'signal').length - 1
  return { kind: `${first?.short ?? words.yours}${more > 0 ? ` +${more}` : ''}`, tone: first ? TONE[first.tone] : undefined }
}

const HEAD: Record<Verdict, string> = { good: words.good, yours: words.yours, waiting: words.waiting }

export function GroupHeading({ verdict, count }: { verdict: Verdict; count?: number }) {
  return (
    <div className={cx(s.group, verdict === 'waiting' && s.groupQuiet)}>
      <span className={cx(s.groupDot, verdict === 'good' ? s.ok : verdict === 'yours' ? s.signal : s.live)} />
      {HEAD[verdict]}
      {count !== undefined && <span className={s.groupCount}>{count}</span>}
    </div>
  )
}

function CardC({ props, r }: { props: AcceptCardProps; r: Readiness }) {
  const heads = useContext(GroupHeads)
  const counts = useContext(GroupCounts)
  const { kind, tone } = kindOfC(r)
  // The kind says the first thing in the way; the foot, what it concerns and anything else.
  const [first, ...rest] = r.blockers
  const checksSaid = r.blockers.some((one) => one.kind === 'failing' || one.kind === 'running')
  // Failing checks the kind names already; behind main blocks nothing, so it is said after the checks.
  const detail = first?.kind === 'failing' && r.checks.failed > 1 ? null : first?.detail
  const said =
    first === undefined || r.verdict === 'good'
      ? [r.passed, ...r.blockers.map((one) => one.short)].join(' · ')
      : [detail ?? (checksSaid ? null : r.passed), ...rest.map((one) => one.short)].filter((one) => one).join(' · ')
  return (
    <>
      {heads.has(props.task) && <GroupHeading verdict={r.verdict} count={counts[r.verdict]} />}
      <Shell
        props={props}
        kind={kind}
        kindTone={tone}
        className={r.verdict === 'waiting' ? s.faded : undefined}
        foot={
          <>
            <span className={a.checks}>{said}</span>
            <Go quiet={r.verdict === 'waiting'} />
          </>
        }
      />
    </>
  )
}

/* ---- D: good to merge, or a list of what's in the way ---- */

const BlockerRows = ({ r }: { r: Readiness }) => (
  <ul className={s.rows}>
    {r.blockers.map((one) => (
      <li key={one.kind} className={cx(s.row, TONE[one.tone])}>
        <span className={s.rowMark}>
          <Mark blocker={one} size={12} />
        </span>
        <span className={s.rowSays}>
          {one.says}
          {one.detail && <span className={s.rowDetail}> · {one.detail}</span>}
        </span>
      </li>
    ))}
  </ul>
)

function CardD({ props, r }: { props: AcceptCardProps; r: Readiness }) {
  const blocked = r.blockers.some((one) => one.kind !== 'behind')
  return (
    <Shell
      props={props}
      middle={r.blockers.length > 0 ? <BlockerRows r={r} /> : undefined}
      foot={
        blocked ? (
          <>
            <span className={a.checks}>
              {r.verdict === 'waiting'
                ? 'Nothing for you yet'
                : r.blockers.some((one) => one.kind === 'failing' || one.kind === 'running')
                  ? ''
                  : r.passed}
            </span>
            {r.next ? <Act blocker={r.next} /> : <Go quiet />}
          </>
        ) : (
          <>
            <span className={cx(s.part, s.ok, s.good)}>
              <Icon name="check" size={12} />
              {words.good}
              <span className={s.goodDetail}>· {r.passed}</span>
            </span>
            <Go />
          </>
        )
      }
    />
  )
}

/** The kit's ready card, as the page's direction has it. */
export function AcceptCard(props: AcceptCardProps) {
  const direction = useContext(DirectionContext)
  const task = taskOf(props.task)
  if (direction === 'today' || task === undefined) return <KitAcceptCard {...props} />
  const r = readinessOf(task)
  switch (direction) {
    case 'a':
      return <CardA props={props} r={r} />
    case 'b':
      return <CardB props={props} r={r} />
    case 'c':
      return <CardC props={props} r={r} />
    case 'd':
      return <CardD props={props} r={r} />
  }
}

/* ---- The home's line ---- */

const where = (task: BoardTask) => {
  const change = task.change
  return change === null
    ? (task.branch ?? '')
    : `${change.repository.slice(change.repository.lastIndexOf('/') + 1)} ${change.prefix}${change.number}`
}

const size = (task: BoardTask) =>
  task.change?.additions == null || task.change.deletions == null ? null : <Delta add={task.change.additions} del={task.change.deletions} />

/** The kit's NeedLine; a ready task's, as the page's direction has it. */
export function NeedLine(props: NeedLineProps) {
  const direction = useContext(DirectionContext)
  const task = props.kind === 'Ready to accept' ? taskOf(props.title) : undefined
  if (direction === 'today' || task === undefined) return <KitNeedLine {...props} />
  const r = readinessOf(task)
  const review = (
    <Button size="small" onClick={props.onOpen}>
      {words.review}
    </Button>
  )
  const next = r.next ? (
    <Button size="small" variant="signal">
      {r.next.action}
    </Button>
  ) : null
  switch (direction) {
    case 'a':
      return (
        <KitNeedLine
          {...props}
          className={r.verdict === 'waiting' ? s.waitingA : undefined}
          brief={
            <span className={s.lineBrief}>
              <span>{where(task)}</span>
              <StatusLine r={r} />
            </span>
          }
          actions={next ?? review}
        />
      )
    case 'b':
      return (
        <KitNeedLine
          {...props}
          brief={
            <span className={s.lineBrief}>
              <span>{where(task)}</span>
              <Chips r={r} />
              {size(task)}
            </span>
          }
          actions={review}
        />
      )
    case 'c': {
      const { kind, tone } = kindOfC(r)
      return (
        <KitNeedLine
          {...props}
          kind={kind}
          className={cx(s.lineC, tone, r.verdict === 'waiting' && s.faded)}
          actions={r.verdict === 'good' ? review : (next ?? review)}
        />
      )
    }
    case 'd':
      return (
        <KitNeedLine
          {...props}
          className={s.lineD}
          brief={
            r.blockers.some((one) => one.kind !== 'behind') ? (
              <span className={s.lineList}>
                {r.blockers.map((one) => (
                  <span key={one.kind} className={cx(s.part, TONE[one.tone])}>
                    <Mark blocker={one} />
                    {one.says}
                    {one.detail && <span className={s.rowDetail}> · {one.detail}</span>}
                  </span>
                ))}
              </span>
            ) : (
              <span className={cx(s.part, s.ok, s.good)}>
                <Icon name="check" size={12} />
                {words.good}
                <span className={s.goodDetail}>
                  · {where(task)} · {r.passed}
                </span>
              </span>
            )
          }
          actions={next ?? review}
        />
      )
  }
}

/** The ready tasks in C's order: good to merge, then what needs you, then what waits on checks. */
export const sortedC = (tasks: ReadonlyArray<BoardTask>) =>
  tasks.toSorted((x, y) => rank[readinessOf(x).verdict] - rank[readinessOf(y).verdict])

/** Where C's headings go, and how many each holds. */
export const groupsC = (tasks: ReadonlyArray<BoardTask>) => {
  const sorted = sortedC(tasks)
  const heads = new Set<string>()
  const counts: Record<Verdict, number> = { good: 0, waiting: 0, yours: 0 }
  let last: Verdict | null = null
  for (const one of sorted) {
    const verdict = readinessOf(one).verdict
    counts[verdict] += 1
    if (verdict !== last) heads.add(one.slug)
    last = verdict
  }
  return { sorted, heads, counts }
}
