import { Button, NeedLine, SinceRow } from '@althar/ui'
import { Home } from '@althar/ui/screens'
import { type ReactNode, useSyncExternalStore } from 'react'

import { cx } from '../../../lib/cx'
import { TwoLabReview } from '../kit/app'
import { Shot } from '../kit/Shot'
import { DECISION, PROJECT_LIST, PUBLISH, READY, RUNNING, SINCE } from '../kit/world'
import s from './Bento.module.css'
import { Automations, Conflicts, Workspaces, Worktrees } from './Drawn'
import { Fragment } from './Fragment'
import darkAccounts from './styled/d-accounts.html?raw'
import glossyAccounts from './styled/g-accounts.html?raw'

/*
 * What keeps you in flow: eight tiles on a six-column grid. Three hold a
 * piece of the app in its light (what happened while you were away, home, a
 * review);
 * five hold a feature drawn as a small object in 3D (several accounts for
 * one agent, automations, conflicts settled, tasks side by side in their own
 * worktrees, workspaces side by side).
 * Narrower, two columns, then one.
 */

const none = () => {}

const NEEDS = [
  {
    key: 'publish',
    project: PUBLISH.project,
    line: (
      <NeedLine
        kind={PUBLISH.kind}
        project={PUBLISH.project}
        task={PUBLISH.task}
        title={PUBLISH.title}
        command={PUBLISH.command}
        actions={
          <>
            <Button size="small">Deny</Button>
            <Button size="small" variant="signal">
              Allow once
            </Button>
          </>
        }
      />
    ),
  },
  {
    key: 'accept',
    project: READY.project,
    line: (
      <NeedLine
        kind={READY.kind}
        project={READY.project}
        task={READY.task}
        title={READY.title}
        brief={`${READY.change.repo} #${READY.change.number} · checks passed · +${READY.change.add} −${READY.change.del}`}
        actions={<Button size="small">Review</Button>}
      />
    ),
  },
  {
    key: 'decision',
    project: DECISION.project,
    line: (
      <NeedLine
        kind={DECISION.kind}
        project={DECISION.project}
        task={DECISION.task}
        title={DECISION.title}
        brief={DECISION.options.map((option) => option.label).join(' or ')}
        actions={<Button size="small">Decide</Button>}
      />
    ),
  },
]

interface Tile {
  id: string
  title: ReactNode
  lead: string
  /** How many of the six columns it takes. */
  span: 2 | 3 | 4
  piece: (style: Style) => ReactNode
  /** Drawn, not a piece of the app: it stands whole in the middle of its tile. */
  drawn?: boolean
  /** Drawn in the style being compared: its tile takes that style's ground. */
  styled?: boolean
  /** A small piece: whole in the middle of its tile, not running off its foot. */
  small?: boolean
}

const TILES: Tile[] = [
  {
    id: 'accounts',
    span: 4,
    drawn: true,
    styled: true,
    title: (
      <>
        Every plan you have. <b>One agent.</b>
      </>
    ),
    lead: 'Sign Codex or Claude Code in once for each plan you pay for: yours, work’s, a client’s, a key. When one runs out, the work goes on with the next.',
    piece: (style) => <Fragment key={style} source={style === 'dark' ? darkAccounts : glossyAccounts} className={s.stage} />,
  },
  {
    id: 'away',
    span: 2,
    small: true,
    title: (
      <>
        It keeps going <b>while you’re away.</b>
      </>
    ),
    lead: 'Usage limits, stalled turns, review rounds: it handles them and carries on. You only hear what needs you.',
    piece: () => (
      <Shot
        w={400}
        maxScale={1.2}
        label="While you were away: a pull request opened after a second review, review moved to Codex at Claude Code’s limit, two issues found and fixed, a stalled step started afresh"
        frame={s.card}
      >
        <div className={s.since}>
          {SINCE.slice(0, 4).map(({ id, ...event }) => (
            <SinceRow key={id} {...event} />
          ))}
        </div>
      </Shot>
    ),
  },
  {
    id: 'automations',
    span: 2,
    drawn: true,
    title: (
      <>
        Work that <b>starts itself.</b>
      </>
    ),
    lead: 'Ask once, for a time or for when something happens. It runs on your computer while Althar is open, and not until you turn it on.',
    piece: () => <Automations skin="ink" />,
  },
  {
    id: 'home',
    span: 4,
    title: (
      <>
        One home <b>for everything.</b>
      </>
    ),
    lead: 'What needs you, across every project, in one place, answered where it is. And what happened since you looked.',
    piece: () => (
      <Shot
        w={980}
        h={600}
        maxScale={1}
        label="Althar’s home: three things that need you, across Halyard and Tally, and every project beside them"
        frame={s.window}
      >
        <div className={s.home}>
          <Home
            waiting={3}
            needs={NEEDS}
            running={RUNNING}
            since={SINCE}
            looked="3 h ago"
            projects={PROJECT_LIST}
            onOpenEvent={none}
            onOpenProject={none}
            onTalk={none}
            onNewProject={none}
          />
        </div>
      </Shot>
    ),
  },
  {
    id: 'conflicts',
    span: 3,
    drawn: true,
    title: (
      <>
        Conflicts, <b>settled.</b>
      </>
    ),
    lead: 'When a task’s change and the default branch disagree, Althar asks its lead to settle it. Only one it can’t settle comes to you.',
    piece: () => <Conflicts skin="ink" />,
  },
  {
    id: 'change',
    span: 3,
    title: (
      <>
        Nothing reaches you <b>half done.</b>
      </>
    ),
    lead: 'By the time you see it, it’s planned, built, reviewed by another lab, fixed, reviewed again, and open as a pull request with its checks run.',
    piece: () => (
      <Shot
        w={740}
        maxScale={1}
        label="A review by Sonnet 5 and Gemini 3 Pro: three findings, two fixed by the lead, one waiting for your call"
        frame={s.card}
      >
        <div className={s.pad}>
          <TwoLabReview />
        </div>
      </Shot>
    ),
  },
  {
    id: 'worktrees',
    span: 2,
    drawn: true,
    title: (
      <>
        Ten at once. <b>None in each other’s way.</b>
      </>
    ),
    lead: 'Run as many tasks as you like side by side. Each gets a worktree of its own, so no two agents ever work in the same files.',
    piece: () => <Worktrees skin="ink" />,
  },
  {
    id: 'workspaces',
    span: 4,
    drawn: true,
    title: (
      <>
        Every workspace, <b>side by side.</b>
      </>
    ),
    lead: 'Connect each Linear workspace you work in, one per company or client, and bind each project to its own. Issues come in from Linear, Jira, Trello or GitHub; pull requests go out to GitHub, GitLab or Bitbucket.',
    piece: () => <Workspaces skin="ink" />,
  },
]

const SPAN = { 2: s.span2, 3: s.span3, 4: s.span4 } as const

/** The two drawing styles being compared: a glossy object, or a dark interface with ?style=dark. Glossy when prerendered. */
type Style = 'glossy' | 'dark'
const styleAsked = (): Style => (new URLSearchParams(window.location.search).get('style') === 'dark' ? 'dark' : 'glossy')
const unchanging = () => none

export function Bento() {
  const style = useSyncExternalStore(unchanging, styleAsked, (): Style => 'glossy')
  return (
    <ul className={s.bento}>
      {TILES.map((tile) => (
        <li
          key={tile.id}
          className={cx(s.tile, SPAN[tile.span], tile.drawn && s.drawn, tile.small && s.small)}
          data-style={(tile.styled && style) || undefined}
        >
          <div className={s.head}>
            <h3 className={s.title}>{tile.title}</h3>
            <p className={s.lead}>{tile.lead}</p>
          </div>
          <div className={s.pic}>{tile.piece(style)}</div>
        </li>
      ))}
    </ul>
  )
}
