import { DesktopBody, type Trial } from '../home/bodies/desktop/DesktopBody'
import { RunsOn } from '../home/bodies/RunsOn'
import { Hero } from '../home/Hero'
import home from '../home/Home.module.css'
import { Footer } from '../shared/footer/Footer'
import { Nav, NavSpace } from '../shared/Nav'
import { Bar, type Group, usePicks } from './Bar'
import { BOARD } from './board'
import { FLOW } from './flow'
import { LINKS } from './links'

/*
 * The developer page, with the parts being chosen swapped in place: the
 * board's words, the flow's features, and a part for everything Althar
 * connects to. In development only, at /proto; nothing here ships. Delete
 * this folder, and DesktopBody's `trial`, once a direction is picked.
 */

const GROUPS: Group[] = [
  { id: 'board', label: 'Board copy', target: 'independent', directions: BOARD },
  { id: 'flow', label: 'Flow', target: 'flow', directions: FLOW },
  { id: 'links', label: 'Connects to', target: 'links', directions: LINKS },
]

export function Proto() {
  const [picks, pick] = usePicks(GROUPS)
  const board = BOARD.find((d) => d.key === picks.board)!.value
  const flow = FLOW.find((d) => d.key === picks.flow)!.value
  const links = LINKS.find((d) => d.key === picks.links)!.value
  // What follows the flow: a station a flow direction brings, then the connections, if they stand there.
  const afterFlow = (
    <>
      {flow.after}
      {links.where === 'flow' && links.node}
    </>
  )
  const trial: Trial = {
    board,
    flow,
    after: { flow: afterFlow, ...(links.where === 'band' || links.where === 'flow' ? {} : { [links.where]: links.node }) },
  }
  return (
    <div className={home.page} id="top">
      <Nav opening />
      <Hero nav={<NavSpace />} />
      <div className={home.night}>
        <RunsOn />
        {links.where === 'band' && links.node}
      </div>
      <DesktopBody key={`${picks.flow}-${picks.links}`} trial={trial} />
      <Footer />
      <Bar groups={GROUPS} picks={picks} pick={pick} />
    </div>
  )
}
