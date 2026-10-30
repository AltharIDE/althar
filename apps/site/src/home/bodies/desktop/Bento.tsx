import { Button, NeedLine, SinceRow } from '@althar/ui'
import { Home } from '@althar/ui/screens'
import { type ReactNode, useSyncExternalStore } from 'react'

import { cx } from '../../../lib/cx'
import { Shot } from '../kit/Shot'
import { DECISION, PROJECT_LIST, PUBLISH, READY, RUNNING, SINCE } from '../kit/world'
import s from './Bento.module.css'
import { Fragment } from './Fragment'
import accounts from './styled/d-accounts.html?raw'
import automations from './styled/d-automations.html?raw'
import conflicts from './styled/d-conflicts.html?raw'
import workspaces from './styled/d-workspaces.html?raw'
import worktrees from './styled/d-worktrees.html?raw'

/*
 * What keeps you in flow: seven tiles on a six-column grid, each drawing at
 * least half its row. Two hold a piece of the app in its light (what
 * happened while you were away, and home across a whole row); five hold a feature drawn
 * as an interface lit by one light, dark or light (Althar fed by each of
 * your accounts in turn, automations, conflicts settled, tasks side by side
 * in worktrees of their own, trackers bound to their projects).
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
  span: 2 | 3 | 4 | 6
  piece: (tone: Tone) => ReactNode
  /** Drawn, not a piece of the app: it stands whole in the middle of its tile. */
  drawn?: boolean
  /** Drawn as an interface lit by one light, dark or light: its tile takes the drawing's ground. */
  tone?: Tone
  /** A small piece: whole in the middle of its tile, not running off its foot. */
  small?: boolean
}

const TILES: Tile[] = [
  {
    id: 'accounts',
    span: 4,
    drawn: true,
    tone: 'dark',
    title: (
      <>
        Every plan you have. <b>One agent.</b>
      </>
    ),
    lead: 'Sign Claude Code, Codex or OpenCode in once for each plan you pay for. When one runs out, Althar goes on with the next, in the order you set.',
    piece: (tone) => <Fragment key={tone} source={accounts} tone={tone} className={s.stage} />,
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
    span: 3,
    drawn: true,
    tone: 'light',
    title: (
      <>
        Work that <b>starts itself.</b>
      </>
    ),
    lead: 'Ask once, for a time or for when something happens. It runs on your computer while Althar is open, and not until you turn it on.',
    piece: (tone) => <Fragment key={tone} source={automations} tone={tone} className={s.stage} />,
  },
  {
    id: 'conflicts',
    span: 3,
    drawn: true,
    tone: 'dark',
    title: (
      <>
        Conflicts, <b>settled.</b>
      </>
    ),
    lead: 'Agents work fast, and merging shouldn’t be what holds them up. Each lead settles its own conflicts; only the odd one needs you.',
    piece: (tone) => <Fragment key={tone} source={conflicts} tone={tone} className={s.stage} />,
  },
  {
    id: 'home',
    span: 6,
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
    id: 'worktrees',
    span: 3,
    drawn: true,
    tone: 'light',
    title: (
      <>
        Ten at once. <b>None in each other’s way.</b>
      </>
    ),
    lead: 'Run as many tasks as you like side by side. Each gets a worktree of its own, so no two agents ever work in the same files.',
    piece: (tone) => <Fragment key={tone} source={worktrees} tone={tone} className={s.stage} />,
  },
  {
    id: 'workspaces',
    span: 3,
    drawn: true,
    tone: 'dark',
    title: (
      <>
        Every workspace, <b>side by side.</b>
      </>
    ),
    lead: 'Day job on Linear, a client on Jira, side projects on GitHub? Plug them all in, and every issue lands in the right project.',
    piece: (tone) => <Fragment key={tone} source={workspaces} tone={tone} className={s.stage} />,
  },
]

const SPAN = { 2: s.span2, 3: s.span3, 4: s.span4, 6: s.span6 } as const

/** A drawing's tone: dark or light. Each tile has its own; ?tone=dark or ?tone=light shows every one in that tone, while the mix is chosen. */
type Tone = 'dark' | 'light'
const toneAsked = (): Tone | null => {
  const asked = new URLSearchParams(window.location.search).get('tone')
  return asked === 'dark' || asked === 'light' ? asked : null
}
const unchanging = () => none

export function Bento() {
  const asked = useSyncExternalStore(unchanging, toneAsked, () => null)
  return (
    <ul className={s.bento}>
      {TILES.map((tile) => (
        <li
          key={tile.id}
          className={cx(s.tile, SPAN[tile.span], tile.drawn && s.drawn, tile.small && s.small)}
          data-tone={(tile.tone && (asked ?? tile.tone)) || undefined}
        >
          <div className={s.head}>
            <h3 className={s.title}>{tile.title}</h3>
            <p className={s.lead}>{tile.lead}</p>
          </div>
          <div className={s.pic}>{tile.piece(asked ?? tile.tone ?? 'light')}</div>
        </li>
      ))}
    </ul>
  )
}
