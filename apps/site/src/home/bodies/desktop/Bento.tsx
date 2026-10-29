import { Button, CallCard, ListPeek, NeedLine } from '@althar/ui'
import { Home } from '@althar/ui/screens'
import { type ReactNode, useSyncExternalStore } from 'react'

import { cx } from '../../../lib/cx'
import { TwoLabReview } from '../kit/app'
import { Shot } from '../kit/Shot'
import { CALLS, DECISION, NOTES_KEPT, NOTES_SEEN, PROJECT_LIST, PUBLISH, READY, RUNNING, SINCE } from '../kit/world'
import s from './Bento.module.css'
import { Accounts, Automations, Conflicts, type Skin, Workspaces } from './Drawn'

/*
 * What keeps you in flow: eight tiles on a six-column grid. Four hold a
 * piece of the app in its light (a decision, home, a review, the notes);
 * four hold a feature drawn as a small object in 3D (several accounts for
 * one agent, automations, conflicts settled, workspaces side by side).
 * Narrower, two columns, then one.
 */

const none = () => {}

const DECIDE = CALLS.find((c) => c.kind === 'Decision') ?? CALLS[0]!

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
  piece: (finish: Skin) => ReactNode
  /** Drawn, not a piece of the app: it stands whole in the middle of its tile. */
  drawn?: boolean
  /** A small piece: whole in the middle of its tile, not running off its foot. */
  small?: boolean
}

const TILES: Tile[] = [
  {
    id: 'accounts',
    span: 4,
    drawn: true,
    title: (
      <>
        Every plan you have. <b>One agent.</b>
      </>
    ),
    lead: 'Sign Codex or Claude Code in once for each plan you pay for: yours, work’s, a client’s, a key. When one runs out, the work goes on with the next.',
    piece: (finish) => <Accounts skin={finish} />,
  },
  {
    id: 'calls',
    span: 2,
    small: true,
    title: (
      <>
        You make <b>the calls.</b>
      </>
    ),
    lead: 'Only real decisions reach you, as one card with the options laid out. Everything else goes ahead.',
    piece: () => (
      <Shot w={400} maxScale={1.2} label={`A decision for you: ${DECIDE.title}`} frame={s.card}>
        <div className={s.pad}>
          <CallCard {...DECIDE} />
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
    piece: (finish) => <Automations skin={finish} />,
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
    piece: (finish) => <Conflicts skin={finish} />,
  },
  {
    id: 'change',
    span: 3,
    title: (
      <>
        The change <b>comes back to you.</b>
      </>
    ),
    lead: 'Finished: a pull request, its checks run, a second lab’s review, and what wasn’t verified. Merging stays yours.',
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
    id: 'notes',
    span: 2,
    title: (
      <>
        Never explain it <b>twice.</b>
      </>
    ),
    lead: 'What the project knows outlasts every chat, agent and model. Each task starts with its notes, and adds what it saw.',
    piece: () => (
      <Shot
        w={400}
        maxScale={1}
        label="Tally’s notes: conventions and decisions every task starts with, and what tasks have seen"
        frame={s.card}
      >
        <div className={s.pad}>
          <ListPeek
            about="Held by the project. Every task starts with its notes, and adds what it saw."
            sections={[
              { label: 'Notes', entries: NOTES_KEPT },
              { label: 'Seen in tasks', entries: NOTES_SEEN },
            ]}
          />
        </div>
      </Shot>
    ),
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
    piece: (finish) => <Workspaces skin={finish} />,
  },
]

const SPAN = { 2: s.span2, 3: s.span3, 4: s.span4 } as const

// While the two finishes are compared: engraved, or glass with ?finish=glass. Engraved when prerendered.
const finishAsked = (): Skin => (new URLSearchParams(window.location.search).get('finish') === 'glass' ? 'glass' : 'ink')
const unchanging = () => none

export function Bento() {
  const finish = useSyncExternalStore(unchanging, finishAsked, (): Skin => 'ink')
  return (
    <ul className={s.bento}>
      {TILES.map((tile) => (
        <li key={tile.id} className={cx(s.tile, SPAN[tile.span], tile.drawn && s.drawn, tile.small && s.small)}>
          <div className={s.head}>
            <h3 className={s.title}>{tile.title}</h3>
            <p className={s.lead}>{tile.lead}</p>
          </div>
          <div className={s.pic}>{tile.piece(finish)}</div>
        </li>
      ))}
    </ul>
  )
}
