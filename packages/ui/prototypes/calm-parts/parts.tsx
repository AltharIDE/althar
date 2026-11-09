// Scrappy: the pieces the directions share, made of the kit's own: a change as a part, the task-wide parts, Add, a change's card, the
// outbox, a line under way, where a turn's time went, the Scratch list.
import { type ReactNode, useState } from 'react'

import { Brand } from '../../src/foundations/brands/brands'
import { Icon, type IconName } from '../../src/foundations/Icon/Icon'
import { Button } from '../../src/primitives/Button/Button'
import { KeyValues } from '../../src/primitives/KeyValues/KeyValues'
import { LinkButton } from '../../src/primitives/LinkButton/LinkButton'
import { LiveDot } from '../../src/primitives/LiveDot/LiveDot'
import { Menu, MenuItem } from '../../src/primitives/Menu/Menu'
import { Popover } from '../../src/primitives/Popover/Popover'
import type { PartAction, PartKind, PartTone, TaskPartModel } from '../../src/chrome/TaskParts/TaskParts'
import { BranchChip, PullChip } from '../../src/board/BoardCard/Chips'
import { type Case, caseOf, type Change, changeIn, type Stamp, type Timing } from './cases'
import { commits, nameOf, needOf, open, partsOfTime, prOf, said, waitsFor } from './need'
import {
  act as doAct,
  addChange,
  addCheckedBy,
  addReview,
  attachPr,
  checkedWhen,
  lineAct,
  postReview,
  removeCheckedBy,
  removeFolder,
  removeReview,
  reviewNow,
  runIt,
  stopHelper,
  stopRunning,
  takeWorktree,
  toLocal,
  toWorktree,
  trust,
  workOn,
} from './moves'
import css from './parts.module.css'
import { proto } from './state'

export { css }

/* ——— A change, in words ——— */

/** Where a change stands, in a few words, with its tone and its one press. */
export const standingOf = (c: Case, change: Change): { detail: string; tone?: PartTone; act?: string } => {
  if (change.state === 'merged')
    return {
      detail: change.found === undefined ? 'Merged' : `Merged · review found ${change.found}`,
      ...(change.found === undefined ? {} : { tone: 'you' as const, act: 'Fix it' }),
    }
  if (change.heldBy !== undefined) {
    const below = changeIn(c, change.heldBy)
    return {
      detail: `Held: ${commits(below?.waiting ?? 0)} waiting on ${below === undefined ? '' : nameOf(below)} below`,
      tone: 'you',
      act: 'Ship',
    }
  }
  if (change.shipping !== undefined) return { detail: change.shipping === 'review' ? 'Shipping: the review' : 'Shipping', tone: 'live' }
  const first = waitsFor(c, change)
  if (first !== undefined && (change.waiting ?? 0) === 0) return { detail: `Waits for ${nameOf(first)} to merge` }
  if (c.moving?.change === change.id && c.moving.to === 'local' && c.moving.waitsOn === undefined)
    return { detail: 'Moving to your checkout: it asks first', tone: 'you' }
  if (c.moving?.change === change.id && c.moving.waitsOn !== undefined)
    return { detail: `Moves to a worktree once ${c.moving.waitsOn} is committed`, act: 'Call it off' }
  if (change.helper !== undefined) return { detail: `A helper on it: ${change.helper}`, tone: 'live' }
  if ((change.waiting ?? 0) > 0)
    return {
      detail: `${commits(change.waiting ?? 0)} not shipped${change.toward === undefined ? '' : `, toward ${change.toward}`}${change.checks === 'failed' ? ` · ${change.failing?.[0] ?? 'a check'} fails on the pushed head` : ''}${(change.replies ?? 0) > 0 ? ' · 1 reply' : ''}`,
      tone: 'you',
      act: 'Ship',
    }
  if (change.checks === 'failed') return { detail: `${change.failing?.join(', ') ?? 'A check'} failing`, tone: 'bad', act: 'Fix it' }
  if (change.ready === true) return { detail: 'Ready to merge', tone: 'you', act: 'Merge' }
  if (change.checks === 'running') return { detail: 'Checks running', tone: 'live' }
  if (change.pr === undefined) return { detail: change.came === 'git' ? 'Made with git, no pull request' : 'No pull request yet' }
  return { detail: change.state === 'draft' ? 'Draft' : 'Open · checks pass' }
}

const placeWords = (c: Case, change: Change) =>
  change.place === 'local' ? 'Your checkout' : change.place === 'none' || change.state === 'merged' ? 'No folder' : 'Its own worktree'

const towardOf = (c: Case, change: Change): ReactNode => {
  const below = change.on === undefined ? undefined : changeIn(c, change.on)
  return below === undefined ? (
    <code>{change.toward ?? 'main'}</code>
  ) : (
    <>
      <code>{below.branch}</code> (stacked on {nameOf(below)})
    </>
  )
}

/** A change's facts, as a part or its card shows them when open. */
export const factsOf = (
  c: Case,
  change: Change,
  { mark = false }: { mark?: boolean } = {},
): ReadonlyArray<readonly [string, ReactNode]> => [
  ...(change.pr === undefined ? [] : [['Pull request', `#${change.pr} · ${change.title}`] as const]),
  ['Branch', <code key="b">{change.branch}</code>],
  ['Toward', towardOf(c, change)],
  ['Where', placeWords(c, change)],
  ...(change.helper === undefined ? [] : [['Helper', change.helper] as const]),
  ...(change.closes === undefined ? [] : [['Closes', change.closes.join(', ')] as const]),
  ...(mark && change.state !== 'merged'
    ? [['Reviewed', (change.waiting ?? 0) > 0 ? `up to ${commits(change.waiting ?? 0)} ago` : 'up to its head'] as const]
    : []),
]

/** What can be done to a change, from its part or its card: its one press first. */
export const actionsOf = (c: Case, change: Change, act?: string): ReadonlyArray<PartAction> => {
  const done = change.state === 'merged' || change.state === 'closed'
  return [
    ...(act === undefined ? [] : [{ label: act, variant: 'signal' as const, onClick: doAct(act, change.id) }]),
    ...(done || change.place === 'none'
      ? []
      : change.place === 'local'
        ? [
            {
              label: 'Move to a worktree',
              onClick: () => toWorktree(change.id),
            },
          ]
        : [{ label: 'Move to your checkout', onClick: () => toLocal(change.id) }]),
    ...(change.helper === undefined
      ? []
      : [
          {
            label: 'Stop the helper',
            variant: 'quiet' as const,
            onClick: () => stopHelper(change.id),
          },
        ]),
    ...(change.pr === undefined
      ? []
      : [{ label: 'On GitHub', variant: 'quiet' as const, icon: 'external' as const, onClick: () => undefined }]),
    ...(done
      ? []
      : [
          {
            label: 'Remove',
            variant: 'quiet' as const,
            end: true,
            confirm: {
              says: `Its folder goes. ${change.branch}${change.pr === undefined ? '' : ` and #${change.pr}`} stay.`,
              keep: 'Keep it',
              go: 'Remove',
            },
            onClick: () => removeFolder(change.id),
          },
        ]),
  ]
}

/** A change as one of the task's parts. */
export const changePart = (c: Case, change: Change, { mark = false }: { mark?: boolean } = {}): TaskPartModel => {
  const stands = standingOf(c, change)
  return {
    id: `change:${change.id}`,
    icon: change.pr === undefined ? 'branch' : 'pr',
    name: nameOf(change),
    detail: stands.detail,
    ...(stands.tone === undefined ? {} : { tone: stands.tone }),
    ...(stands.act === undefined ? {} : { act: { label: stands.act, onClick: doAct(stands.act, change.id) } }),
    facts: factsOf(c, change, { mark }),
    actions: actionsOf(c, change, stands.act),
  }
}

/* ——— The task-wide parts: a copy, Checked by, Reviewing, Access, Outputs ——— */

export const accessWords = { read: 'Read only', safe: 'Runs safely', full: 'Trusted' } as const

export const taskWide = (c: Case, { workspace = true }: { workspace?: boolean } = {}): ReadonlyArray<TaskPartModel> => [
  ...(workspace && c.copy !== undefined
    ? [
        {
          id: 'copy',
          icon: 'folder' as const,
          name: c.copy.pr === undefined ? 'A copy of main' : `A copy at #${c.copy.pr}’s head`,
          detail: 'Keeps nothing',
          facts: [['Where', c.copy.pr === undefined ? 'main, as it is now' : `#${c.copy.pr}’s head`] as const],
          actions:
            c.copy.pr === undefined
              ? [
                  {
                    label: 'Take a worktree',
                    onClick: takeWorktree,
                  },
                ]
              : [],
        },
      ]
    : []),
  ...(c.access === undefined
    ? []
    : [
        {
          id: 'access',
          icon: 'lock' as const,
          name: accessWords[c.access],
          detail: `#${c.reviewing?.pr ?? ''} is ${c.reviewing?.by ?? ''}’s, from outside the team`,
          ...(c.access === 'read' ? { act: { label: 'Run it', onClick: runIt } } : {}),
          facts: [
            ['Author', `${c.reviewing?.by ?? ''}, outside the team`] as const,
            [
              'It may',
              c.access === 'read'
                ? 'Read the code only'
                : c.access === 'safe'
                  ? 'Run offline, install scripts off'
                  : 'Run as the team’s code does',
            ] as const,
          ],
          actions:
            c.access === 'read'
              ? [{ label: 'Run it', variant: 'signal' as const, onClick: runIt }]
              : [
                  ...(c.access === 'safe'
                    ? [
                        {
                          label: 'Trust fully',
                          onClick: trust,
                        },
                      ]
                    : []),
                  {
                    label: 'Stop running it',
                    variant: 'quiet' as const,
                    end: true,
                    onClick: stopRunning,
                  },
                ],
        },
      ]),
  ...(c.reviewer == null
    ? []
    : [
        {
          id: 'checked',
          icon: 'answer' as const,
          name: 'Checked by',
          detail: `${c.reviewer.who}, ${c.reviewer.when === 'before' ? 'before it ships' : 'after it merges'}`,
          facts: [
            ['Who', c.reviewer.who] as const,
            ['When', c.reviewer.when === 'before' ? 'Before it ships' : 'After it merges'] as const,
          ],
          actions: [
            {
              label: 'Review now',
              onClick: reviewNow,
            },
            {
              label: c.reviewer.when === 'before' ? 'After it merges' : 'Before it ships',
              variant: 'quiet' as const,
              onClick: checkedWhen,
            },
            {
              label: 'Remove',
              variant: 'quiet' as const,
              end: true,
              onClick: removeCheckedBy,
            },
          ],
        },
      ]),
  ...(c.reviewing === undefined || (c.access !== undefined && c.reviewing.draft === undefined)
    ? []
    : [
        {
          id: 'reviewing',
          icon: 'comment' as const,
          name: `#${c.reviewing.pr}`,
          detail: c.reviewing.draft === undefined ? `Reviewing, ${c.reviewing.by}’s` : `${c.reviewing.draft} comments drafted, not posted`,
          ...(c.reviewing.draft === undefined
            ? {}
            : {
                tone: 'you' as const,
                act: { label: 'Post it', onClick: postReview },
              }),
          facts: [
            ['Title', c.reviewing.title] as const,
            ['By', `${c.reviewing.by}${c.reviewing.outside === true ? ', outside the team' : ''}`] as const,
            ...(c.reviewing.copy === true ? [['Where', `A copy at #${c.reviewing.pr}’s head, beside this change`] as const] : []),
          ],
          actions: [
            ...(c.reviewing.draft === undefined
              ? []
              : [{ label: `Post it on #${c.reviewing.pr}`, variant: 'signal' as const, onClick: postReview }]),
            { label: 'Remove', variant: 'quiet' as const, end: true, onClick: removeReview },
          ],
        },
      ]),
  ...(c.shots === undefined ? [] : [{ id: 'shots', icon: 'image' as const, name: `${c.shots} screenshots`, detail: 'In Outputs' }]),
  ...(c.kind === 'change' && c.preset === 'Change' ? issuesOf(c) : []),
]

/** What a task can take on from Add, at any time: each says what it does, and does it, here. */
export const kindsOf = (c: Case): ReadonlyArray<PartKind> => {
  const form = (note: string, button: string, apply: () => void) => (done: () => void) => (
    <div className={css.form}>
      <p className={css.note}>{note}</p>
      <div>
        <Button
          size="small"
          variant="signal"
          onClick={() => {
            apply()
            done()
          }}
        >
          {button}
        </Button>
      </div>
    </div>
  )
  return [
    {
      kind: 'change',
      icon: 'branch',
      name: 'A change',
      about: 'A branch and pull request of its own',
      form: form('A branch from main, in a worktree beside the others.', 'Start one', addChange),
    },
    ...(c.reviewer == null
      ? [
          {
            kind: 'checked',
            icon: 'answer' as IconName,
            name: 'Checked by',
            about: 'A reviewer, before it ships or after it merges',
            form: form('GPT-6.1 Sol, before it ships.', 'Add', addCheckedBy),
          },
        ]
      : []),
    ...(c.reviewing === undefined
      ? [
          {
            kind: 'review',
            icon: 'comment' as IconName,
            name: 'A review',
            about: 'Of any pull request, drafted for you to post',
            form: form('In a copy at its head, beside this task’s own work.', 'Review #698', addReview),
          },
        ]
      : []),
    ...(c.changes.some((one) => one.pr === 718)
      ? []
      : [
          {
            kind: 'pr',
            icon: 'pr' as IconName,
            name: 'A pull request',
            about: 'One that exists, as a change of its own',
            form: form('It becomes a change of this task’s, followed on its own.', 'Attach #718', () => attachPr()),
          },
        ]),
  ]
}

/** The issues it came from or took in: one by its key and title; two by their keys; more counted. */
const issuesOf = (c: Case): ReadonlyArray<TaskPartModel> => {
  const issues = c.issues ?? [{ key: 'DEV-214', title: 'The board jumps as cards move' }]
  if (issues.length === 0) return []
  return [
    {
      id: 'issue',
      icon: Brand.Linear,
      name: issues.length <= 2 ? issues.map((one) => one.key).join(', ') : `${issues.length} issues`,
      detail: issues.length === 1 ? issues[0]!.title : 'In Progress',
      facts: issues.length === 1 ? [['Status', 'In Progress'] as const] : issues.map((one) => [one.key, one.title] as const),
    },
  ]
}

/* ——— A pull request or a branch, as a card's card in the card ——— */

export const chipOf = (change: Change | undefined) =>
  change === undefined ? null : change.pr === undefined ? (
    <BranchChip name={change.branch} {...(change.add === undefined ? {} : { add: change.add, del: change.del ?? 0 })} />
  ) : (
    <PullChip
      host={{ name: 'GitHub', brand: Brand.GitHub }}
      repo="althar"
      number={change.pr}
      {...(change.add === undefined ? {} : { add: change.add, del: change.del ?? 0 })}
    />
  )

/* ——— B: a change's mark, its track on the card, its strip under the bar ——— */

type Mark = 'bad' | 'you' | 'ready' | 'live' | 'ok' | 'quiet' | 'merged' | 'waits'
export const markOf = (c: Case, change: Change): Mark => {
  if (change.state === 'merged') return change.found === undefined ? 'merged' : 'you'
  const stands = standingOf(c, change)
  const tone = stands.tone
  if (tone === 'bad') return 'bad'
  // Ready to merge waits on the person as much as commits held for Ship: both violet, told apart by their mark.
  if (tone === 'you' && stands.act === 'Merge') return 'ready'
  if (tone === 'you') return 'you'
  if (tone === 'live') return 'live'
  // It goes after another: a clock, until that one merges.
  if (waitsFor(c, change) !== undefined) return 'waits'
  return change.checks === 'passed' ? 'ok' : 'quiet'
}

/**
 * One thing asks at a time: a change that waits on you (ready, or commits held), but isn't the one the task's fact is about, is
 * marked in ink, not violet. Inside the task's chip they all stay its colour: the chip is the one ask.
 */
export const asideOf = (c: Case, change: Change) => {
  const about = needOf(c, proto.get().answered).change
  return about !== undefined && about.id !== change.id
}

export function ChangeMark({ mark, aside = false }: { mark: Mark; aside?: boolean }) {
  if (mark === 'live')
    return (
      <span className={css.mark} data-mark="live">
        <LiveDot />
      </span>
    )
  const icon: IconName =
    mark === 'bad'
      ? 'close'
      : mark === 'ok' || mark === 'ready'
        ? 'check'
        : mark === 'you'
          ? 'after'
          : mark === 'merged'
            ? 'pr'
            : mark === 'waits'
              ? 'clock'
              : 'branch'
  return (
    <span className={css.mark} data-mark={mark} {...(aside ? { 'data-aside': '' } : {})}>
      <Icon name={icon} size={11} />
    </span>
  )
}

/** B's card foot: each change a mark, by where it stands, and how many apart from them. */
export function ChangeTrack({ c }: { c: Case }) {
  if (c.changes.length < 2) return null
  return (
    <span
      className={css.track}
      role="img"
      aria-label={`${c.changes.length} changes: ${c.changes.map((change) => `${nameOf(change)}, ${standingOf(c, change).detail}`).join('; ')}`}
    >
      {c.changes.slice(0, 8).map((change) => (
        <ChangeMark key={change.id} mark={markOf(c, change)} aside={asideOf(c, change)} />
      ))}
      <span className={css.count}>{c.changes.length} changes</span>
    </span>
  )
}

/** B: one change, as its card opens from the strip. */
export function ChangeCard({ c, change }: { c: Case; change: Change }) {
  const stands = standingOf(c, change)
  const [sure, setSure] = useState<PartAction | null>(null)
  return (
    <div className={css.card}>
      <div className={css.cardHead}>
        <ChangeMark mark={markOf(c, change)} />
        <span className={css.cardName}>{nameOf(change)}</span>
        <span className={css.cardDetail} data-tone={stands.tone}>
          {stands.detail}
        </span>
      </div>
      <KeyValues items={factsOf(c, change, { mark: true })} keyWidth={84} />
      {sure?.confirm !== undefined ? (
        <div className={css.acts}>
          <span className={css.note}>{sure.confirm.says}</span>
          <Button size="small" variant="quiet" onClick={() => setSure(null)}>
            {sure.confirm.keep}
          </Button>
          <Button
            size="small"
            variant="danger"
            onClick={() => {
              setSure(null)
              sure.onClick()
            }}
          >
            {sure.confirm.go}
          </Button>
        </div>
      ) : (
        <div className={css.acts}>
          {actionsOf(c, change, stands.act).map((action) => (
            <Button
              key={action.label}
              size="small"
              {...(action.variant === undefined || action.variant === 'default' ? {} : { variant: action.variant })}
              {...(action.icon === undefined ? {} : { icon: action.icon })}
              className={action.end === true ? css.end : undefined}
              onClick={() => (action.confirm === undefined ? action.onClick() : setSure(action))}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

/** B: the task's changes, a segment each, under the bar; there only once it has two, or one with something to say. */
export function ChangesStrip({ c, opened }: { c: Case; opened: string | null }) {
  const shown = c.changes
  const waiting = shown.filter((one) => open(one) && (one.waiting ?? 0) > 0)
  return (
    <section className={css.strip} aria-label="This task’s changes">
      {shown.map((change) => {
        const stands = standingOf(c, change)
        return (
          <Popover
            key={change.id}
            label={nameOf(change)}
            placement="below"
            align="start"
            width={380}
            padded={false}
            defaultOpen={opened === change.id}
            trigger={
              <button type="button" className={css.segment} data-tone={stands.tone}>
                <ChangeMark mark={markOf(c, change)} />
                <span className={change.pr === undefined ? css.segmentBranch : css.segmentName}>{nameOf(change)}</span>
                <span className={css.segmentDetail}>{stands.detail}</span>
              </button>
            }
          >
            <ChangeCard c={c} change={change} />
          </Popover>
        )
      })}
      <span className={css.grow} />
      {waiting.length > 1 && (
        <Button size="small" variant="signal" onClick={doAct('Ship them all')}>
          Ship them all
        </Button>
      )}
    </section>
  )
}

/* ——— The change the window is about ——— */

/** Where the lead's last turn worked, else the first open one. */
export const workingOf = (c: Case): Change | undefined => {
  for (const beat of [...c.thread].reverse()) {
    const one = changeIn(
      c,
      beat.kind === 'lead' ? (beat.commits?.change ?? beat.part?.change) : beat.kind === 'part' ? beat.change : undefined,
    )
    if (one !== undefined && open(one)) return one
  }
  return c.changes.find(open)
}

/**
 * The change the window is about: the one the person picked; else the one that most needed them when they opened the task (as
 * Needs you opens it), so it doesn't move while agents work; else where the lead last worked.
 */
export const focusOf = (c: Case): Change | undefined => {
  const picked = changeIn(c, c.working)
  if (picked !== undefined && open(picked)) return picked
  const first = changeIn(c, needOf(caseOf(c.key), {}).change?.id)
  if (first !== undefined && open(first)) return first
  return workingOf(c)
}

/** Another change than the one in view needs the person: the violet dot on the way to it. */
const othersNeed = (c: Case, now: Change | undefined) =>
  c.changes.some((one) => one !== now && open(one) && (standingOf(c, one).tone === 'you' || standingOf(c, one).tone === 'bad'))

/* ——— As one: the changes as one piece of work, a mark each, opening to the list ——— */

/** Each of the task's changes, a row: its mark, its name, its pull request and branch, where it stands, and its quiet press. */
export function ChangesList({ c, onPick }: { c: Case; onPick?: (id: string) => void }) {
  const about = needOf(c, proto.get().answered).change
  return (
    <ul className={css.outRows}>
      {c.changes.map((change) => {
        const stands = standingOf(c, change)
        // One thing asks at a time: violet only on the change the task's one fact is about; a failure stays red.
        const tone = stands.tone === 'you' && about !== undefined && about.id !== change.id ? 'quiet' : stands.tone
        const row = (
          <>
            <ChangeMark mark={markOf(c, change)} aside={asideOf(c, change)} />
            <span className={css.outName}>{nameOf(change)}</span>
            <code className={css.outRowBranch}>{change.pr === undefined ? change.branch : `#${change.pr} · ${change.branch}`}</code>
            <span className={css.outDetail} data-tone={tone}>
              {stands.detail}
              {change.place === 'local' ? ' · in your checkout' : ''}
            </span>
          </>
        )
        return (
          <li key={change.id} className={css.outRow}>
            {onPick === undefined ? (
              <span className={css.outPick}>{row}</span>
            ) : (
              <button type="button" className={css.outPick} onClick={() => onPick(change.id)}>
                {row}
              </button>
            )}
            {stands.act !== undefined && (
              <Button size="small" onClick={doAct(stands.act, change.id)}>
                {stands.act}
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** As one: the changes' marks inside the task's chip, before its sentence; they open to every change. */
export function SetMarks({ c, says }: { c: Case; says: string }) {
  return (
    <Popover
      label="This task’s changes"
      placement="below"
      align="start"
      width={460}
      trigger={
        <button type="button" className={css.setChip} aria-label={`${c.changes.length} changes: ${says}`}>
          <span className={css.setMarks}>
            {c.changes.map((change) => (
              <ChangeMark key={change.id} mark={markOf(c, change)} />
            ))}
          </span>
          <span className={css.chipWords}>{says}</span>
        </button>
      }
    >
      <ChangesList c={c} />
    </Popover>
  )
}

/* ——— One at a time: the change in view, after the task's title ——— */

/** After the title: the change the window is about, and the way to another. A violet dot where another needs the person. */
export function ChangeSwitch({ c }: { c: Case }) {
  const now = focusOf(c)
  if (c.changes.length < 2 || now === undefined) return null
  const live = c.changes.filter(open)
  const done = c.changes.filter((one) => !open(one))
  return (
    <span className={css.crumb}>
      <span className={css.crumbSep} aria-hidden="true">
        /
      </span>
      <Menu
        label="This task’s changes"
        align="start"
        width={380}
        {...(done.length === 0 ? {} : { note: `${done.map(nameOf).join(', ')} merged.` })}
        trigger={
          <button type="button" className={css.crumbButton} aria-label={`Showing ${nameOf(now)}`}>
            <ChangeMark mark={markOf(c, now)} />
            <span>{nameOf(now)}</span>
            <span className={css.crumbCount}>{`${live.indexOf(now) + 1} of ${live.length}`}</span>
            {othersNeed(c, now) && <span className={css.crumbDot} aria-label="Another needs you" />}
            <Icon name="chevronD" size={10} />
          </button>
        }
      >
        {live.map((one) => (
          <MenuItem
            key={one.id}
            {...(one.id === now.id ? { icon: 'check' as const } : {})}
            hint={prOf(one)}
            description={standingOf(c, one).detail}
            onSelect={() => workOn(one.id)}
          >
            {nameOf(one)}
          </MenuItem>
        ))}
      </Menu>
    </span>
  )
}

/* ——— Where you talk: the changes as tabs over the composer ——— */

/** Over the composer, a tab each: the one picked is what you say next goes to, and says where it stands; pressed again, its card. */
export function ChangeDock({ c, opened, card = true }: { c: Case; opened: boolean; card?: boolean }) {
  const now = focusOf(c)
  if (c.changes.length < 2 || now === undefined) return null
  const live = c.changes.filter(open)
  const done = c.changes.filter((one) => !open(one))
  return (
    <section className={css.dock} aria-label="This task’s changes">
      {live.map((one) => {
        const stands = standingOf(c, one)
        if (one !== now || !card)
          return (
            <button
              key={one.id}
              type="button"
              className={css.tab}
              onClick={() => workOn(one.id)}
              aria-pressed={one === now}
              {...(one === now ? { 'data-on': '' } : {})}
            >
              <ChangeMark mark={markOf(c, one)} />
              <span>{nameOf(one)}</span>
              {one === now && (
                <span className={css.tabDetail} data-tone={stands.tone}>
                  {stands.detail}
                </span>
              )}
            </button>
          )
        return (
          <Popover
            key={one.id}
            label={nameOf(one)}
            placement="above"
            align="start"
            width={380}
            padded={false}
            defaultOpen={opened}
            trigger={
              <button type="button" className={css.tab} data-on="" aria-pressed="true">
                <ChangeMark mark={markOf(c, one)} />
                <span>{nameOf(one)}</span>
                <span className={css.tabDetail} data-tone={stands.tone}>
                  {stands.detail}
                </span>
                <Icon name="chevronU" size={10} />
              </button>
            }
          >
            <ChangeCard c={c} change={one} />
          </Popover>
        )
      })}
      {done.length > 0 && <span className={css.dockDone}>{`${done.map(nameOf).join(', ')} merged`}</span>}
    </section>
  )
}

/** A line's words, each change named in them a way to it. */
export function Linked({ c, text }: { c: Case; text: string }) {
  const names = c.changes
    .filter(open)
    .map((one) => [one.short, one.id] as const)
    .filter((one): one is readonly [string, string] => one[0] !== undefined)
  if (names.length < 2) return <>{text}</>
  const pattern = new RegExp(`(${names.map(([name]) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`)
  return (
    <>
      {text.split(pattern).map((bit, at) => {
        const id = names.find(([name]) => name === bit)?.[1]
        return id === undefined ? (
          bit
        ) : (
          <LinkButton key={`${bit}${at}`} onClick={() => workOn(id)}>
            {bit}
          </LinkButton>
        )
      })}
    </>
  )
}

/* ——— A step in the work, stamped ——— */

const STAMPS: Record<Stamp, { readonly word: string; readonly icon: IconName }> = {
  shipped: { word: 'Shipped', icon: 'up' },
  merged: { word: 'Merged', icon: 'pr' },
  change: { word: 'New change', icon: 'branch' },
}

/** What a step in the work is, before its line: Shipped and Merged in green, a new change in cobalt, as work under way. */
export function StampOf({ stamp }: { stamp: Stamp }) {
  const { word, icon } = STAMPS[stamp]
  return (
    <span className={css.stamp} data-stamp={stamp}>
      <Icon name={icon} size={11} />
      {word}
    </span>
  )
}

/**
 * An Althar line's words: branches always as code; in a stamped line, a step in the work, the changes it names and pull requests
 * by number in ink as well.
 */
export function Marked({ c, text, names: inked = true }: { c: Case; text: string; names?: boolean }) {
  const names = c.changes.map((one) => one.short).filter((one): one is string => one !== undefined)
  const escape = (one: string) => one.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `(${[...names.map(escape), '#\\d+', '\\b[a-z0-9][a-z0-9.-]*/[a-z0-9./-]*[a-z0-9]', '\\brelease-\\d[\\d.]*\\d'].join('|')})`,
  )
  return (
    <>
      {text.split(pattern).map((bit, at) =>
        at % 2 === 0 ? (
          bit
        ) : names.includes(bit) || bit.startsWith('#') ? (
          !inked ? (
            bit
          ) : (
            <span key={`${bit}${at}`} className={css.lineName}>
              {bit}
            </span>
          )
        ) : (
          <code key={`${bit}${at}`} className={css.lineCode}>
            {bit}
          </code>
        ),
      )}
    </>
  )
}

/* ——— C: the outbox over the composer, and a line under way ——— */

/** What waits for the person's word to go up: each change's commits, replies and what fails on its pushed head; Ship. */
export function Outbox({ c, opened }: { c: Case; opened: boolean }) {
  const waiting = c.changes.filter((one) => open(one) && (one.waiting ?? 0) > 0)
  if (waiting.length === 0) return null
  const n = waiting.reduce((sum, one) => sum + (one.waiting ?? 0), 0)
  const first = waiting[0]!
  return (
    <Popover
      label="Not shipped"
      placement="above"
      align="start"
      width={400}
      padded={false}
      defaultOpen={opened}
      trigger={
        <button type="button" className={css.outbox}>
          <Icon name="after" size={12} />
          <span>
            {commits(n)} not shipped{waiting.length > 1 ? `, on ${waiting.length} changes` : `, on ${nameOf(first)}`}
          </span>
          <span className={css.outboxShip}>Ship</span>
        </button>
      }
    >
      <div className={css.card}>
        <ul className={css.rows}>
          {waiting.map((change) => (
            <li key={change.id} className={css.row}>
              <span className={css.rowName}>{nameOf(change)}</span>
              <ul className={css.rowWhat}>
                <li>{commits(change.waiting ?? 0)}</li>
                {(change.replies ?? 0) > 0 && <li>What a reply on it asked for</li>}
                {change.checks === 'failed' && (
                  <li className={css.rowBad}>{change.failing?.[0] ?? 'A check'} fails on what’s up now. Ship replaces it.</li>
                )}
              </ul>
              <Button size="small" variant={waiting.length === 1 ? 'signal' : 'default'} onClick={doAct('Ship', change.id)}>
                Ship
              </Button>
            </li>
          ))}
        </ul>
        <p className={css.note}>
          {c.reviewer == null ? 'Goes up at once.' : `${c.reviewer.who} reviews what changed since its last review, then it goes up.`}
        </p>
        {waiting.length > 1 && (
          <div className={css.acts}>
            <Button size="small" variant="signal" onClick={doAct('Ship them all')}>
              Ship them all
            </Button>
          </div>
        )}
      </div>
    </Popover>
  )
}

/** Something under way, at the thread's end: it changes in place, and goes once it's over. */
export function LiveLine({ text, act, name }: { text: string; act?: string; name?: string }) {
  return (
    <p className={css.live}>
      <LiveDot pulse />
      {name !== undefined && <span className={css.lineName}>{name}</span>}
      <span>{text}</span>
      {act !== undefined && <LinkButton onClick={() => lineAct(act)}>{act}</LinkButton>}
    </p>
  )
}

/** Where a turn's time went, as its line opens to it, the largest first. */
export function TimeParts({ t }: { t: Timing }) {
  return <p className={css.time}>{partsOfTime(t).map(said).join(' · ')}</p>
}

/** A change's name, small, at a line's start: B names the change every line is about. */
export function Named({ change }: { change: Change | undefined }) {
  if (change === undefined) return null
  return <span className={change.pr === undefined ? css.namedBranch : css.named}>{nameOf(change)}</span>
}

/* ——— Scratch: chats by their latest exchange ——— */

export const CHATS = [
  {
    id: 'c1',
    title: 'What does ADR-087 say about helpers?',
    last: 'A lead can start helpers on any agent, each in a copy…',
    at: '2m',
    unseen: true,
  },
  { id: 'c2', title: 'Why is the e2e run slow on Windows?', last: 'Most of it is the installer step: it builds twice.', at: '1h' },
  { id: 'c3', title: 'Which Bun does CI pin?', last: '1.3.5, in .bun-version.', at: 'Yesterday' },
  { id: 'c4', title: 'Name for the shelf of chats', last: 'Scratch reads well beside Settled.', at: '3d' },
]

export function ScratchList({ onOpen }: { onOpen?: () => void }) {
  return (
    <ul className={css.chats}>
      {CHATS.map((chat) => (
        <li key={chat.id}>
          <button type="button" className={css.chat} onClick={onOpen}>
            <span className={css.chatTitle}>
              {chat.unseen === true && <span className={css.unseen} aria-label="Reply not seen" />}
              {chat.title}
            </span>
            <span className={css.chatLast}>{chat.last}</span>
            <span className={css.chatAt}>{chat.at}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
