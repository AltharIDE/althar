import { EdgeSheet } from '@althar/ui'

// Prototype: the kit's demo world, read from its source.
import { EDGE_NEEDS, EDGE_WORK, edgeRowOf } from '../../../../../../packages/ui/src/fixtures/edge'
import { IslandOpen } from './app'
import { BrowserWindow, Desktop, EditorWindow, TerminalWindow } from './Mac'
import { Reel, type ReelMoment } from './Reel'
import { Shot } from './Shot'
import s from './EdgeTour.module.css'

/*
 * Althar at the edge of the screen, wherever you are: round the notch over
 * your editor, saying what just came in while you read in the browser, in
 * the menu bar over a terminal, and quiet on an empty desktop with what
 * waits counted. One screen, the places one after another.
 */

const none = () => {}

const MENU_SHEET = (
  <EdgeSheet
    tone="paper"
    waiting={EDGE_NEEDS.length}
    working={EDGE_WORK.length}
    needs={EDGE_NEEDS.map((row) => edgeRowOf(row, none))}
    work={EDGE_WORK.map((row) => edgeRowOf(row, none))}
    onOpenApp={none}
  />
)

const ISLAND = { x: 450, y: 0, w: 540, h: 600 }

export const EDGE_MOMENTS: ReelMoment[] = [
  {
    at: 'Round the notch',
    label: 'In your editor',
    stays: 5200,
    render: () => (
      <Shot w={1440} h={900} phone={ISLAND} label="The island round the notch, dropped open over a code editor" frame={s.screen}>
        <Desktop wallpaper="dark" app="Code" island={<IslandOpen />}>
          <EditorWindow style={{ left: 120, top: 50, width: 1200, height: 780 }} />
        </Desktop>
      </Shot>
    ),
  },
  {
    at: 'Round the notch',
    label: 'In the browser',
    stays: 4400,
    render: () => (
      <Shot
        w={1440}
        h={900}
        phone={{ x: 380, y: 0, w: 680, h: 520 }}
        label="A pull request ready for you, said round the notch over a browser"
        frame={s.screen}
      >
        <Desktop
          wallpaper="light"
          app="Chrome"
          island={<IslandOpen open={false} saying={{ project: 'Meridian', kind: 'Ready to accept' }} />}
        >
          <BrowserWindow style={{ left: 90, top: 40, width: 1260, height: 800 }} />
        </Desktop>
      </Shot>
    ),
  },
  {
    at: 'In the menu bar',
    label: 'In the terminal',
    stays: 5200,
    render: () => (
      <Shot w={1440} h={900} phone={{ x: 880, y: 0, w: 540, h: 600 }} label="Althar in the menu bar, open over a terminal" frame={s.screen}>
        <Desktop wallpaper="dark" app="Terminal" menu={{ open: MENU_SHEET, waiting: EDGE_NEEDS.length }}>
          <TerminalWindow style={{ left: 120, top: 60, width: 1000, height: 700 }} />
        </Desktop>
      </Shot>
    ),
  },
  {
    at: 'Round the notch',
    label: 'Away from it',
    stays: 4000,
    render: () => (
      <Shot
        w={1440}
        h={900}
        phone={{ x: 360, y: 0, w: 720, h: 560 }}
        label="An empty desktop, the island counting what waits"
        frame={s.screen}
      >
        <Desktop wallpaper="light" app="Finder" island={<IslandOpen open={false} />} />
      </Shot>
    ),
  },
]

export function EdgeTour({ tone = 'ink' }: { tone?: 'paper' | 'ink' }) {
  return (
    <div className={s.tour}>
      <div className={s.bezel}>
        <Reel moments={EDGE_MOMENTS} tone={tone} />
      </div>
    </div>
  )
}
