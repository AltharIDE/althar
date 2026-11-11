import { type ReactNode, useSyncExternalStore } from 'react'

import { cx } from '../../../lib/cx'
import s from './Bento.module.css'
import { CanvasDrawing, LoadDrawing, QueueDrawing, ServersDrawing, SkillsDrawing, StorageDrawing, VoiceDrawing } from './Drawings'
import { Fragment } from './Fragment'
import accounts from './styled/d-accounts.html?raw'
import automations from './styled/d-automations.html?raw'
import conflicts from './styled/d-conflicts.html?raw'
import workspaces from './styled/d-workspaces.html?raw'
import worktrees from './styled/d-worktrees.html?raw'

/*
 * What keeps you in flow: twelve tiles on a six-column grid. The first five
 * each hold a feature drawn as an interface lit by one light, dark or light:
 * Althar fed by each of your accounts in turn, across the whole row, then two
 * to a row automations, conflicts settled, tasks side by side in worktrees of
 * their own, trackers bound to their projects. The seven after them are
 * smaller, each drawn (Drawings.tsx): the canvas, voice and merge queues three
 * to a row, then two to a row skills and MCP servers, the machine's load and
 * disk space.
 * Narrower, two to a row, the canvas across its own; then one.
 */

const none = () => {}

export interface Tile {
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
  /** One of the smaller features after the first six: its words and its drawing a size down. */
  compact?: boolean
}

/** A smaller feature, a third of a row or half of one, drawn in the console's dark. */
const compact = (id: string, title: ReactNode, lead: string, draw: () => ReactNode, span: 2 | 3 = 2): Tile => ({
  id,
  span,
  drawn: true,
  tone: 'dark',
  compact: true,
  title,
  lead,
  piece: draw,
})

export const TILES: Tile[] = [
  {
    id: 'accounts',
    span: 6,
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
  compact(
    'canvas',
    <>
      It draws it out. <b>You mark it up.</b>
    </>,
    'Leads draw pages and diagrams on the canvas; comment, and the next version answers.',
    () => <CanvasDrawing />,
  ),
  compact(
    'voice',
    <>
      Say it. <b>Don’t type it.</b>
    </>,
    'Dictate to the coordinator or any task, transcribed on your computer.',
    () => <VoiceDrawing />,
  ),
  compact(
    'queue',
    <>
      Merge queues, <b>in order.</b>
    </>,
    'Stacked changes merge bottom-up, through your host’s merge queue.',
    () => <QueueDrawing />,
  ),
  compact(
    'skills',
    <>
      One set of skills. <b>Every agent.</b>
    </>,
    'Add a skill once; Claude Code, Codex and OpenCode all get it.',
    () => <SkillsDrawing />,
    3,
  ),
  compact(
    'servers',
    <>
      MCP servers, <b>set up once.</b>
    </>,
    'Add a server once, and it’s written into every agent’s own config.',
    () => <ServersDrawing />,
    3,
  ),
  compact(
    'load',
    <>
      Your machine, <b>at a glance.</b>
    </>,
    'What each task takes of your CPU and memory, live.',
    () => <LoadDrawing />,
    3,
  ),
  compact(
    'storage',
    <>
      Disk space, <b>looked after.</b>
    </>,
    'Finished tasks’ folders go when they’re done; anything unpushed stays.',
    () => <StorageDrawing />,
    3,
  ),
]

/** What isn't drawn, as words alone under the console. */
export const ALSO = [
  'A browser built in',
  'Tasks as a graph',
  'Run any branch',
  'Work in your own checkout',
  'Leads update your issues',
  'Diagrams in threads',
  'Usage per task',
  'Warm dark mode',
] as const

const SPAN = { 2: s.span2, 3: s.span3, 4: s.span4, 6: s.span6 } as const

/** A drawing's tone: dark or light. Each tile has its own; ?tone=dark or ?tone=light shows every one in that tone, while the mix is chosen. */
export type Tone = 'dark' | 'light'
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
          className={cx(s.tile, SPAN[tile.span], tile.drawn && s.drawn)}
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
