// Scrappy: the pieces the directions share, made of the kit's own: a change as a part, the task-wide parts, Add, a change's card, the
// outbox, a line under way, where a turn's time went, the Scratch list.
import { type ReactNode, useState } from 'react'

import { Brand } from '../../src/foundations/brands/brands'
import { Icon, type IconName } from '../../src/foundations/Icon/Icon'
import { Button } from '../../src/primitives/Button/Button'
import { KeyValues } from '../../src/primitives/KeyValues/KeyValues'
import { LinkButton } from '../../src/primitives/LinkButton/LinkButton'
import { LiveDot } from '../../src/primitives/LiveDot/LiveDot'
import { Popover } from '../../src/primitives/Popover/Popover'
import type { PartAction, PartKind, PartTone, TaskPartModel } from '../../src/chrome/TaskParts/TaskParts'
import { BranchChip, PullChip } from '../../src/board/BoardCard/Chips'
import { type Beat, type Case, type Change, changeIn, type Timing } from './cases'
import { commits, nameOf, open, partsOfTime, said } from './need'
import { proto } from './state'
import css from './parts.module.css'

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
  ...(mark && change.state !== 'merged'
    ? [['Reviewed', (change.waiting ?? 0) > 0 ? `up to ${commits(change.waiting ?? 0)} ago` : 'up to its head'] as const]
    : []),
]

/* ——— What a press does here: the line it writes, or the case it leads to ——— */

const LEADS: Partial<Record<string, string>> = {
  Ship: 'shipping',
  'Move to your checkout': 'to-local',
  'Move to a worktree': 'local-waits',
  'Call it off': 'move-off',
  'Run it': 'run-it',
  'Run safely': 'runs-safely',
}

export const press = (label: string, line?: Omit<Extract<Beat, { kind: 'part' }>, 'kind'>) => () => {
  if (line !== undefined) proto.say({ kind: 'part', ...line })
  const next = LEADS[label]
  if (next !== undefined && next !== proto.get().key) window.setTimeout(() => proto.go(next), line === undefined ? 0 : 500)
}

/** What can be done to a change, from its part or its card: its one press first. */
export const actionsOf = (c: Case, change: Change, act?: string): ReadonlyArray<PartAction> => {
  const name = nameOf(change)
  const done = change.state === 'merged' || change.state === 'closed'
  return [
    ...(act === undefined ? [] : [{ label: act, variant: 'signal' as const, onClick: press(act) }]),
    ...(done || change.place === 'none'
      ? []
      : change.place === 'local'
        ? [
            {
              label: 'Move to a worktree',
              onClick: press('Move to a worktree', { who: 'you', text: `You moved ${change.branch} to a worktree.`, change: change.id }),
            },
          ]
        : [{ label: 'Move to your checkout', onClick: press('Move to your checkout') }]),
    ...(change.helper === undefined
      ? []
      : [
          {
            label: 'Stop the helper',
            variant: 'quiet' as const,
            onClick: press('Stop', { who: 'you', text: `You stopped the helper on ${name}. What it committed stays.`, change: change.id }),
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
            onClick: press('Remove', {
              who: 'you',
              text: `You removed ${name}’s worktree. ${change.branch} stays, here and on GitHub.`,
              change: change.id,
            }),
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
    ...(stands.act === undefined ? {} : { act: { label: stands.act, onClick: press(stands.act) } }),
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
                    onClick: press('Take a worktree', { who: 'you', text: 'You gave it a worktree. It’s on the board now.' }),
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
          ...(c.access === 'read' ? { act: { label: 'Run it', onClick: press('Run it') } } : {}),
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
              ? [{ label: 'Run it', variant: 'signal' as const, onClick: press('Run it') }]
              : [
                  ...(c.access === 'safe'
                    ? [
                        {
                          label: 'Trust fully',
                          onClick: press('Trust fully', {
                            who: 'you',
                            text: `You trusted #${c.reviewing?.pr ?? ''} fully: install scripts and the network.`,
                          }),
                        },
                      ]
                    : []),
                  {
                    label: 'Stop running it',
                    variant: 'quiet' as const,
                    end: true,
                    onClick: press('Stop running it', { who: 'you', text: 'What ran stopped. Read only again.' }),
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
              onClick: press('Review now', { who: 'you', text: 'You asked for a review of everything since the last one.' }),
            },
            {
              label: c.reviewer.when === 'before' ? 'After it merges' : 'Before it ships',
              variant: 'quiet' as const,
              onClick: press('when', {
                who: 'you',
                text: `You moved Checked by to ${c.reviewer.when === 'before' ? 'after it merges' : 'before it ships'}.`,
              }),
            },
            {
              label: 'Remove',
              variant: 'quiet' as const,
              end: true,
              onClick: press('Remove', { who: 'you', text: 'You removed Checked by. Its findings stay in the thread.' }),
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
                act: { label: 'Post it', onClick: press('Post it', { who: 'you', text: `You posted the review on #${c.reviewing.pr}.` }) },
              }),
          facts: [
            ['Title', c.reviewing.title] as const,
            ['By', `${c.reviewing.by}${c.reviewing.outside === true ? ', outside the team' : ''}`] as const,
            ...(c.reviewing.copy === true ? [['Where', `A copy at #${c.reviewing.pr}’s head, beside this change`] as const] : []),
          ],
          actions: [
            ...(c.reviewing.draft === undefined
              ? []
              : [{ label: `Post it on #${c.reviewing.pr}`, variant: 'signal' as const, onClick: press('Post it') }]),
            { label: 'Remove', variant: 'quiet' as const, end: true, onClick: () => proto.go('removed') },
          ],
        },
      ]),
  ...(c.shots === undefined ? [] : [{ id: 'shots', icon: 'image' as const, name: `${c.shots} screenshots`, detail: 'In Outputs' }]),
  ...(c.kind === 'change' && c.preset === 'Change'
    ? [
        {
          id: 'issue',
          icon: Brand.Linear,
          name: 'DEV-214',
          detail: 'The board jumps as cards move',
          facts: [['Status', 'In Progress'] as const],
        },
      ]
    : []),
]

/** What a task can take on from Add, at any time: each says what it does, and does it. */
export const kindsOf = (c: Case): ReadonlyArray<PartKind> => {
  const form = (note: string, button: string, line: string) => (done: () => void) => (
    <div className={css.form}>
      <p className={css.note}>{note}</p>
      <div>
        <Button
          size="small"
          variant="signal"
          onClick={() => {
            proto.say({ kind: 'part', who: 'you', text: line })
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
      form: form(
        'A branch from main, in a worktree beside the others.',
        'Start one',
        'You started a change, althar/board-still-tests, toward main.',
      ),
    },
    ...(c.reviewer == null
      ? [
          {
            kind: 'checked',
            icon: 'answer' as IconName,
            name: 'Checked by',
            about: 'A reviewer, before it ships or after it merges',
            form: form('GPT-6.1 Sol, before it ships.', 'Add', 'You added Checked by: GPT-6.1 Sol, before it ships.'),
          },
        ]
      : []),
    {
      kind: 'review',
      icon: 'comment',
      name: 'A review',
      about: 'Of any pull request, drafted for you to post',
      form: form('In a copy at its head, beside this task’s own work.', 'Review #698', 'You added a review of #698.'),
    },
    {
      kind: 'pr',
      icon: 'pr',
      name: 'A pull request',
      about: 'One that exists, as a change of its own',
      form: form('It becomes a change of this task’s, followed on its own.', 'Attach #718', 'You attached #718, as a change of its own.'),
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

type Mark = 'bad' | 'you' | 'live' | 'ok' | 'quiet' | 'merged'
export const markOf = (c: Case, change: Change): Mark => {
  if (change.state === 'merged') return change.found === undefined ? 'merged' : 'you'
  const tone = standingOf(c, change).tone
  if (tone === 'bad') return 'bad'
  if (tone === 'you') return 'you'
  if (tone === 'live') return 'live'
  return change.checks === 'passed' ? 'ok' : 'quiet'
}

export function ChangeMark({ mark }: { mark: Mark }) {
  if (mark === 'live')
    return (
      <span className={css.mark} data-mark="live">
        <LiveDot />
      </span>
    )
  const icon: IconName = mark === 'bad' ? 'close' : mark === 'ok' ? 'check' : mark === 'you' ? 'after' : mark === 'merged' ? 'pr' : 'branch'
  return (
    <span className={css.mark} data-mark={mark}>
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
        <ChangeMark key={change.id} mark={markOf(c, change)} />
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
        <Button size="small" variant="signal" onClick={press('Ship')}>
          Ship them all
        </Button>
      )}
    </section>
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
              <Button size="small" variant={waiting.length === 1 ? 'signal' : 'default'} onClick={press('Ship')}>
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
            <Button size="small" variant="signal" onClick={press('Ship')}>
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
      {act !== undefined && <LinkButton onClick={press(act, act === 'Call it off' ? undefined : undefined)}>{act}</LinkButton>}
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
