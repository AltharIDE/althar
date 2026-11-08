// Scrappy: a task's Outputs, as the direction has it, once the task has changes of its own. Today's page reads a second pull request
// in one repository as one that came before; phase 5's changes are each their own. Made of the kit's WhatItMade and ChangeSet, in the
// real page's layout. A task with no change of its own (a chat, a review) keeps today's page.
import { type ComponentProps, useState } from 'react'

import * as real from '../../../../../apps/desktop/src/renderer/features/task/Outputs'
import s from '../../../../../apps/desktop/src/renderer/features/task/Task.module.css'
import { Brand } from '../../../src/foundations/brands/brands'
import { Icon } from '../../../src/foundations/Icon/Icon'
import { ChangeState, CheckState } from '../../../src/foundations/vocabulary'
import { ChangeSet } from '../../../src/outputs/ChangeSet/ChangeSet'
import { WhatItMade } from '../../../src/outputs/WhatItMade/WhatItMade'
import { Button } from '../../../src/primitives/Button/Button'
import type { ChangeCheck } from '../../../src/primitives/Checks/Checks'
import { type Case, type Change, changeIn } from '../cases'
import { VIEWS } from '../directions'
import { act } from '../moves'
import { commits, nameOf, needOf, open } from '../need'
import { ChangeMark, css, markOf, standingOf } from '../parts'
import { proto, useProto } from '../state'
import { SOL } from '../team'

export { conflictsOf, hasOutputs, hasOutputsToShow, latestOf } from '../../../../../apps/desktop/src/renderer/features/task/Outputs'

const GITHUB = { name: 'GitHub', brand: Brand.GitHub }

/** What each change touched, as its diff would list it. */
const FILES: Record<string, ReadonlyArray<{ path: string; add: number; del: number }>> = {
  still: [
    { path: 'packages/ui/src/board/Board/Board.tsx', add: 52, del: 19 },
    { path: 'packages/ui/src/board/Board/Board.module.css', add: 14, del: 6 },
    { path: 'apps/desktop/e2e/board.spec.ts', add: 18, del: 6 },
  ],
  later: [
    { path: 'packages/ui/src/board/Board/Board.tsx', add: 4, del: 4 },
    { path: 'packages/ui/src/chrome/TaskMenu/TaskMenu.tsx', add: 4, del: 4 },
    { path: 'docs/glossary.md', add: 4, del: 4 },
  ],
  motion: [
    { path: 'packages/ui/src/board/BoardCard/BoardCard.tsx', add: 31, del: 5 },
    { path: 'packages/ui/src/board/BoardCard/BoardCard.module.css', add: 15, del: 3 },
  ],
}
const filesOf = (change: Change) =>
  FILES[change.id] ?? [{ path: 'packages/ui/src/board/Board/Board.tsx', add: change.add ?? 12, del: change.del ?? 4 }]

/** What each change is, in the words its pull request says it. */
const STORIES: Record<string, { lede: string; rest: string }> = {
  still: {
    lede: 'The board no longer jumps when a card changes lanes: each lane holds its height until the card lands.',
    rest: 'Lanes measured themselves again the moment a card left, so everything under it moved up a frame early. The hold starts when the card lifts and ends when it lands; a resize mid-move takes the new height.',
  },
  later: {
    lede: '“Keep for later” is “Later” everywhere: the board, the task menu, the edge’s menu and the glossary.',
    rest: 'A rename only; nothing moves.',
  },
  motion: {
    lede: 'A card slides to its new lane instead of jumping there.',
    rest: 'Built on the held heights of #714, so the lanes stay still while it moves.',
  },
}
const storyOf = (change: Change) => STORIES[change.id] ?? { lede: change.title, rest: '' }

/** A picture of the board, drawn, so the page needs no file. */
const board = (title: string, note: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900" viewBox="0 0 1440 900">` +
      `<rect width="1440" height="900" fill="#f3f1ec"/><rect width="1440" height="64" fill="#ffffff"/>` +
      `<text x="40" y="40" font-family="Helvetica, Arial" font-size="18" fill="#26262b">althar · Board</text>` +
      ['Running', 'Needs you', 'Up next']
        .map(
          (lane, i) =>
            `<text x="${48 + i * 460}" y="116" font-family="Helvetica, Arial" font-size="17" font-weight="600" fill="#45454c">${lane}</text>` +
            [0, 1, 2]
              .map(
                (n) => `<rect x="${40 + i * 460}" y="${136 + n * 132}" width="420" height="112" rx="10" fill="#ffffff" stroke="#e4e2dc"/>`,
              )
              .join(''),
        )
        .join('') +
      `<rect x="40" y="560" width="1340" height="64" rx="8" fill="#ecebf9"/>` +
      `<text x="64" y="600" font-family="Helvetica, Arial" font-size="19" fill="#26262b">${title}: ${note}</text>` +
      `</svg>`,
  )}`

const SHOTS: Record<string, ReadonlyArray<readonly [string, string]>> = {
  still: [
    ['A card leaving Running', 'the lanes under it hold still'],
    ['The card landing in Needs you', 'the lanes settle once'],
  ],
  later: [['The task menu', 'Later, not Keep for later']],
  motion: [['A card mid-slide', 'between Running and Needs you']],
}
const shotsOf = (change: Change) =>
  (SHOTS[change.id] ?? []).map(([caption, note], n) => ({
    id: `${change.id}-${n}`,
    name: `${change.id}-${n + 1}.png`,
    caption,
    alt: `${caption}: ${note}`,
    src: board(caption, note),
    width: 1440,
    height: 900,
  }))

/** Its checks, as its host has them. */
const checksOf = (change: Change): ReadonlyArray<ChangeCheck> => {
  if (change.state === 'merged' || change.pr === undefined || change.checks === undefined || change.checks === 'none') return []
  if (change.checks === 'failed')
    return [
      { id: 'unit', name: 'Unit', state: CheckState.Passed, detail: '1,204 passed' },
      { id: 'failing', name: change.failing?.[0] ?? 'A check', state: CheckState.Failed, detail: 'Times out on CI only' },
    ]
  if (change.checks === 'running')
    return [
      { id: 'unit', name: 'Unit', state: CheckState.Running, detail: 'running · 2m' },
      { id: 'e2e', name: 'e2e', state: CheckState.Queued, detail: 'after Unit' },
    ]
  return [
    { id: 'unit', name: 'Unit', state: CheckState.Passed, detail: '1,204 passed' },
    { id: 'e2e', name: 'e2e', state: CheckState.Passed, detail: '41 passed' },
  ]
}

const stateOf = (change: Change) =>
  change.state === 'merged'
    ? ChangeState.Merged
    : change.pr === undefined
      ? ChangeState.Branch
      : change.state === 'draft'
        ? ChangeState.Draft
        : ChangeState.Ready

/** Where it is and where it goes, which today's card says only for work with no pull request: its branch, toward what, where it lives. */
function Where({ c, change, ship }: { c: Case; change: Change; ship: boolean }) {
  const below = changeIn(c, change.on)
  const waiting = change.waiting ?? 0
  return (
    <span className={css.outWhere}>
      <span className={css.outBranch}>
        <Icon name="branch" size={12} />
        <code>{change.branch}</code>
        <span className={css.note}>→</span>
        <code>{below === undefined ? (change.toward ?? 'main') : below.branch}</code>
      </span>
      {change.helper !== undefined && <span>A helper is on it: {change.helper}</span>}
      {ship && waiting > 0 && change.pr !== undefined && (
        <span className={css.outWaiting}>
          {commits(waiting)} not shipped{change.checks === 'failed' ? `: ${change.failing?.[0] ?? 'a check'} fails on what’s up now` : ''}
        </span>
      )}
    </span>
  )
}

/** One change, as the kit's card: its pull request or branch, where it goes, its checks and review, and its one press. */
function ChangeCard({ c, change, ship = true }: { c: Case; change: Change; ship?: boolean }) {
  const stands = standingOf(c, change)
  const press = stands.act === undefined || (!ship && stands.act === 'Ship') ? undefined : stands.act
  const reviewed = c.reviewer != null && (change.waiting ?? 0) === 0 && change.pr !== undefined && change.state !== 'merged'
  return (
    <ChangeSet
      state={stateOf(change)}
      host={GITHUB}
      prs={[
        {
          repo: 'AltharIDE/althar',
          ...(change.pr === undefined ? {} : { number: change.pr, url: `https://github.com/AltharIDE/althar/pull/${change.pr}` }),
          files: filesOf(change),
        },
      ]}
      {...(change.pr === undefined ? { branch: change.branch, remote: { name: 'origin', pushed: false, ahead: change.waiting ?? 0 } } : {})}
      note={<Where c={c} change={change} ship={ship} />}
      checks={checksOf(change)}
      {...(reviewed ? { review: { state: CheckState.Passed, by: [SOL] } } : {})}
      {...(press === undefined
        ? {}
        : {
            actions: (
              <Button variant={stands.tone === 'you' || stands.tone === 'bad' ? 'signal' : 'default'} onClick={act(press, change.id)}>
                {press}
              </Button>
            ),
          })}
      text={{ label: nameOf(change), unpushed: (n) => `${commits(n)} not shipped` }}
    />
  )
}

/** The other changes, a line each: its mark, its name and branch, where it stands, and its one press; pressing the line shows it. */
function Others({ c, others, onPick }: { c: Case; others: ReadonlyArray<Change>; onPick: (id: string) => void }) {
  if (others.length === 0) return null
  return (
    <section className={css.outOthers} aria-label="This task’s other changes">
      <span className={css.outOthersHead}>{others.length === 1 ? '1 more change' : `${others.length} more changes`}</span>
      <ul className={css.outRows}>
        {others.map((change) => {
          const stands = standingOf(c, change)
          return (
            <li key={change.id} className={css.outRow}>
              <button type="button" className={css.outPick} onClick={() => onPick(change.id)}>
                <ChangeMark mark={markOf(c, change)} />
                <span className={css.outName}>{nameOf(change)}</span>
                {change.pr !== undefined && <code className={css.outRowBranch}>{change.branch}</code>}
                <span className={css.outDetail} data-tone={stands.tone}>
                  {stands.detail}
                </span>
              </button>
              {stands.act !== undefined && (
                // One thing asks at a time: the card above has the violet press; these are quiet.
                <Button size="small" onClick={act(stands.act, change.id)}>
                  {stands.act}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** C: what waits for Ship, first, as one card: each change's commits, and Ship. */
function NotShipped({ c }: { c: Case }) {
  const waiting = c.changes.filter((one) => open(one) && (one.waiting ?? 0) > 0)
  if (waiting.length === 0) return null
  return (
    <section className={css.outShip} aria-label="Not shipped">
      <span className={css.outOthersHead}>Not shipped</span>
      <ul className={css.outRows}>
        {waiting.map((change) => (
          <li key={change.id} className={css.outRow}>
            <span className={css.outPick}>
              <span className={css.outName}>{nameOf(change)}</span>
              <span className={css.outDetail}>{commits(change.waiting ?? 0)}</span>
            </span>
            <Button size="small" variant="signal" onClick={act('Ship', change.id)}>
              Ship
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function Outputs(props: ComponentProps<typeof real.Outputs>) {
  const p = useProto()
  const c = proto.current()
  const [picked, setPicked] = useState<string | null>(null)
  if (c.changes.length === 0) return <real.Outputs {...props} />
  const view = VIEWS[p.direction].outputs
  const need = needOf(c, p.answered)
  // A: one change at a time, the one that most needs the person first (ADR § the task's diff); the rest a line each.
  const shown = changeIn(c, picked ?? undefined) ?? need.change ?? c.changes.find(open) ?? c.changes[0]!
  const merged = c.changes.filter((one) => !open(one) && (view !== 'one' || one !== shown))
  const others = c.changes.filter((one) => open(one) && one !== shown)
  const lead = view === 'one' ? shown : (need.change ?? c.changes.find(open) ?? c.changes[0]!)
  return (
    <div className={s.outputs}>
      <div className={s.outputsWide}>
        <WhatItMade
          story={storyOf(lead)}
          shots={shotsOf(lead)}
          checked={[]}
          unverified={[]}
          text={{ story: c.changes.length > 1 ? `What ${nameOf(lead)} changes` : 'What changed' }}
        />
        <aside className={s.side}>
          {view === 'one' ? (
            <>
              <ChangeCard c={c} change={shown} />
              <Others c={c} others={others} onPick={setPicked} />
            </>
          ) : (
            <>
              {view === 'outbox' && <NotShipped c={c} />}
              {c.changes.filter(open).map((change) => (
                <ChangeCard key={change.id} c={c} change={change} ship={view === 'all'} />
              ))}
            </>
          )}
          {merged.length > 0 && (
            <p className={s.quiet}>
              {merged.map((one) => `${nameOf(one)} ${one.state === 'merged' ? 'merged' : 'closed'}`).join(' · ')}
              {merged.some((one) => one.found !== undefined) ? '. Its review after the merge found something.' : '.'}
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}
