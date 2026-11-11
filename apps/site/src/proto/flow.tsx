import { Icon } from '@althar/ui'
import type { ReactNode } from 'react'

import { type Tile, TILES } from '../home/bodies/desktop/Bento'
import { Console, type Scene, Station } from '../home/bodies/desktop/DesktopBody'
import { cx } from '../lib/cx'
import type { Direction } from './board'
import s from './flow.module.css'
import { BROWSER, CANVAS, type Piece, SMALL } from './pieces'

/*
 * What keeps you in flow, with the features it doesn't show yet: One home
 * for everything is gone in each; the canvas and the browser come in as big
 * ones, and voice, the merge queue, skills, MCP servers, the machine's load
 * and disk space as small ones. Each direction shows them another way.
 */

export interface Flow {
  scene?: Scene
  body: ReactNode
  /** A station of its own after the flow, where a direction gives one. */
  after?: ReactNode
}

const tile = (piece: Piece, span: Tile['span'], small = false): Tile => ({
  id: piece.id,
  span,
  small,
  title: piece.title,
  lead: piece.lead,
  piece: () => piece.piece,
})

const OLD = Object.fromEntries(TILES.filter((t) => t.id !== 'home').map((t) => [t.id, t])) as Record<string, Tile>
const big = (...ids: string[]) => ids.map((id) => OLD[id]!)

/** The console as it is, without home, the canvas and the browser in its second row. */
const BIG: Tile[] = [
  ...big('accounts', 'away'),
  tile(CANVAS, 3),
  tile(BROWSER, 3),
  ...big('automations', 'conflicts', 'worktrees', 'workspaces'),
]

/** The small ones on a panel of their own under the console: three across, each with its piece. */
function SmallPanel({ items = SMALL, title }: { items?: Piece[]; title: ReactNode }) {
  return (
    <div className={s.after}>
      <h3 className={s.subhead}>{title}</h3>
      <ol className={s.panel} data-light="">
        {items.map((p, i) => (
          <li key={p.id} className={s.small}>
            <span className={s.plate}>
              <b>{String(i + 1).padStart(2, '0')}</b>
              <i className={s.led} />
            </span>
            <h4 className={s.smallTitle}>{p.title}</h4>
            <p className={s.smallLead}>{p.lead}</p>
            <div className={s.smallPiece}>{p.piece}</div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** The small ones as a compact list: their icon, their claim and a line, no pictures. */
function SmallList({ title }: { title: ReactNode }) {
  return (
    <div className={s.after}>
      <h3 className={s.subhead}>{title}</h3>
      <ul className={s.list}>
        {SMALL.map((p) => (
          <li key={p.id}>
            <span className={s.icon}>
              <Icon name={p.icon} size={18} />
            </span>
            <div>
              <h4 className={s.listTitle}>{p.title}</h4>
              <p className={s.listLead}>{p.lead}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

const AND = (
  <>
    And the small things, <b>done right.</b>
  </>
)

/** D: the canvas and the browser, a station of their own after the flow, side by side. */
function Making() {
  return (
    <Station
      id="making"
      layout="bank"
      stamp={{ no: '05', name: 'Canvas', km: 10 }}
      scene={{
        title: (
          <>
            See what it’s making.
            <br />
            <b>Before it’s merged.</b>
          </>
        ),
        lead: 'Plans and diagrams on the project’s canvas, the page it’s building in a browser beside the task. Comment on either, and the lead picks it up.',
      }}
    >
      <ol className={cx(s.pair)} data-light="">
        {[CANVAS, BROWSER].map((p) => (
          <li key={p.id} className={s.pairItem}>
            <h3 className={s.pairTitle}>{p.title}</h3>
            <div className={s.pairPiece}>{p.piece}</div>
          </li>
        ))}
      </ol>
    </Station>
  )
}

export const FLOW: Direction<Flow>[] = [
  {
    key: 'a',
    name: 'The console, then a panel of small ones with their pictures',
    value: {
      body: (
        <>
          <Console tiles={BIG} className={s.eight} />
          <SmallPanel title={AND} />
        </>
      ),
    },
  },
  {
    key: 'b',
    name: 'Everything in one console (crowded)',
    value: {
      body: (
        <Console
          className={s.fourteen}
          tiles={[
            ...big('accounts', 'away'),
            tile(CANVAS, 3),
            tile(BROWSER, 3),
            tile(SMALL[0]!, 2, true),
            tile(SMALL[1]!, 2, true),
            tile(SMALL[4]!, 2, true),
            ...big('automations', 'conflicts'),
            tile(SMALL[2]!, 3),
            tile(SMALL[3]!, 3),
            { ...OLD.worktrees!, span: 2 },
            { ...OLD.workspaces!, span: 2 },
            tile(SMALL[5]!, 2, true),
          ]}
        />
      ),
    },
  },
  {
    key: 'c',
    name: 'The console, then the small ones as a compact list',
    value: {
      body: (
        <>
          <Console tiles={BIG} className={s.eight} />
          <SmallList title={AND} />
        </>
      ),
    },
  },
  {
    key: 'd',
    name: 'Canvas and browser a station of their own; small ones on a panel',
    value: {
      body: (
        <>
          <Console tiles={big('accounts', 'away', 'automations', 'conflicts', 'worktrees', 'workspaces')} className={s.six} />
          <SmallPanel title={AND} />
        </>
      ),
      after: <Making />,
    },
  },
]
